# Text subsystem refactor (frontend ↔ backend)

## Цель

Зафиксировать целевую архитектуру текстовой подсистемы после перехода от legacy-термина `labels` к единой модели `texts` в:
- editor model;
- workspace snapshot;
- export DTO;
- backend-пайплайне DXF.

Документ задаёт «clean break»: новый контракт и новые внутренние точки расширения без поддержки старых веток и хуков в runtime.

---

## 1) Editor model: text object

Канонический editor-object на canvas (Fabric `IText`) имеет поля:

- `isTextObject: true` — типовой маркер текстового объекта;
- `kind: 'attached' | 'free'` — режим жизненного цикла;
- `role: 'default-label' | 'custom' | <future>` — функциональная роль;
- `ownerPlacementId: number | null` — связь с placement контура (только для `attached`);
- `text: string` — нормализованный текст;
- `fontSizeMm: number` — размер шрифта в мм;
- `left/top/angle` — абсолютная позиция на canvas;
- `localOffsetX/localOffsetY/localAngle` — локальные параметры относительно центра owner-контура (только для `attached`);
- `excludeFromExport: true` — исключение из стандартного Fabric-export (экспорт строится только builder-слоем);
- `lockRotation: boolean` — `true` для `attached`, `false` для `free`.

### Инварианты editor model

1. `1 px == 1 mm` всегда, без скрытых пересчётов.
2. Для `attached` обязательно:
   - `ownerPlacementId` валиден и существует в `contours[]`;
   - `localOffset*` и `localAngle` актуальны относительно текущего положения owner-контура.
3. Для `free` обязательно:
   - `ownerPlacementId === null`;
   - `localOffsetX/localOffsetY/localAngle === 0`.
4. Все persist/export операции выполняются только при `scale=1`.
5. Источник истины для текста в рантайме — `textManager.texts[]`, а не прямой обход canvas.

---

## 2) Lifecycle: attached / free / default

### 2.1 Free text
- Создаётся пользователем как автономный текстовый объект.
- Не зависит от контура, перемещается/вращается свободно.
- В snapshot/export передаётся как `kind='free'`.

### 2.2 Attached text
- Привязывается к `ownerPlacementId`.
- Хранит локальный offset/angle относительно центра контура.
- При трансформации owner-контура переходит в новое абсолютное положение через пересчёт `local -> absolute`.
- Ограничивается рамкой `allowedRect` вокруг контура (с `boundsPadMm`).

### 2.3 Default text
- Частный случай `attached` с `role='default-label'`.
- Создаётся автоматически из метаданных контура (`defaultLabel`) только если отсутствует existing default text для placement.
- Может быть отредактирован как обычный текст, но сохраняет связь с owner-контуром.

---

## 3) Единый event flow трансформаций

Единый поток событий для текста и контуров:

1. **Создание/редактирование текста**
   - `buildTextObject()` инициализирует объект;
   - событие `modified` нормализует `text/fontSizeMm`;
   - `scheduleWorkspaceSave()` ставит autosave.

2. **Move/rotate текста**
   - для `free`: обновляются абсолютные координаты;
   - для `attached`: после перемещения пересчитываются `localOffset*`, затем применяется clamp в допустимые границы.

3. **Transform owner-контура**
   - `syncAttachedTextsForContour()` пересчитывает все `attached` через `computeAbsoluteTextPosition()`;
   - затем `clampTextToContourBounds()` и повторная фиксация якоря `updateAttachedTextAnchorFromAbsolute()`.

4. **Delete contour**
   - удаляются все `attached` с данным `ownerPlacementId`.

5. **Persist/restore**
   - snapshot строится из `textManager.getWorkspaceTextsData()`;
   - restore идёт через `normalizeWorkspaceTexts()` и фабрики `createFreeText()/createAttachedText()`.

Ключевой принцип: нет «особого» event-flow для legacy labels — только единый text-flow.

---

## 4) Новый workspace snapshot (`texts[]`, versioning, clean break)

### Канонический формат

```json
{
  "schemaVersion": 3,
  "savedAt": "ISO-8601",
  "layment": { "width": 565, "height": 375, "offset": 32 },
  "workspaceScale": 1,
  "contours": [],
  "primitives": [],
  "texts": [
    {
      "kind": "attached",
      "role": "default-label",
      "ownerPlacementId": 12,
      "text": "T15",
      "fontSizeMm": 4,
      "localOffsetX": 10,
      "localOffsetY": -6,
      "localAngle": 0,
      "x": 140,
      "y": 80
    }
  ]
}
```

### Versioning

- Поддерживается только `schemaVersion=3`.
- Snapshot с другими версиями считаются неподдерживаемыми и не загружаются.
- Legacy payload с `labels[]` не мигрируется на клиенте в runtime.

### Clean break

- `labels[]` удаляется из workspace-снимка полностью.
- Любая обратная совместимость по `labels[]` допускается только как отдельный offline-скрипт миграции данных (не в UI runtime).

---

## 5) Новый export DTO (`texts[]`) и граница builder-слоя

## Контракт frontend -> backend

```json
{
  "orderMeta": { "width": 565, "height": 375, "units": "mm", "coordinateSystem": "origin-top-left" },
  "contours": [
    { "id": "tool-a", "x": 10, "y": 20, "angle": 0, "scaleOverride": 1 }
  ],
  "primitives": [],
  "texts": [
    {
      "kind": "attached",
      "text": "T15",
      "x": 140,
      "y": 80,
      "angle": 0,
      "fontSizeMm": 4,
      "ownerContourId": "12"
    }
  ]
}
```

### Граница builder-слоя (frontend)

Builder-слой заканчивается на методах:
- `buildExportContours()`;
- `buildExportPrimitives()`;
- `buildExportTexts()`.

Требования к builder-слою:
1. Не интерпретирует производство (никакого G-code/DXF-расчёта на frontend).
2. Отдаёт только геометрию и метаданные текста в мм.
3. Для `attached` вычисляет абсолютные координаты через `textManager.computeAbsoluteTextPosition()`.
4. Сериализует `ownerContourId` как строку placement-id.

---

## 6) Backend `TextPlacement` и DXF pipeline

### Backend DTO

`TextPlacement` (FastAPI/Pydantic):
- `kind: str`;
- `text: str`;
- `x: float`;
- `y: float`;
- `angle: Optional[float]`;
- `fontSizeMm: Optional[float]`;
- `ownerContourId: Optional[str]`.

`ExportRequest` принимает `texts: Optional[List[TextPlacement]]`.

### DXF pipeline

1. Export endpoint принимает заказ с `texts[]`.
2. Сервис DXF читает `order_data.texts`.
3. Для каждой записи:
   - sanitize текста (`\n`, `\t` -> пробел);
   - нормализация `fontSizeMm` (fallback `4.0`);
   - применение `angle` (fallback `0.0`).
4. Текст эмитится как DXF `TEXT` в слой `TEXTS`.
5. Выходные артефакты:
   - минимальный DXF (без текстов) для техконтроля;
   - CAD DXF (с `TEXTS`) для маркировки/лазера.

Принцип: backend интерпретирует `texts[]` как производственный вход, frontend не знает о DXF-деталях.

---

## 7) Удалённые legacy hooks/special-cases

Ниже перечислены legacy-узлы, которые должны быть удалены в рамках clean break и не использоваться в новых фичах:

### UI hooks
- `syncLabelControlsFromSelection()`
- `applyLabelTextFromInput()`
- `addLabelForSelection()`
- `deleteLabelForSelection()`
- привязка `UIDom.labels.*` обработчиков в `initUIEvents()`

### Legacy manager / API
- файл `frontend/js/labelManager.js` целиком;
- методы legacy-экспорта `getExportTextsData()` в стиле `contourId/text/x/y` без `kind/angle/ownerContourId`;
- любые обращения к свойству `labelForPlacementId`.

### Special-cases в ветвлениях
- ветки вида `if (obj.isTextObject) ... // labels`;
- логика «запрет поворота для labels» как отдельный кейс (тексты обрабатываются единообразно по `kind`);
- fallback-парсинг входных payload по ключу `labels`.

### Документация/контракт
- примеры JSON с `labels[]` в публичном export-контракте;
- формулировки, где `labels` описаны как единственный источник данных для DXF-маркировки.

---

## 8) План внедрения (коротко)

1. Зафиксировать docs (`texts[]`, clean break, versioning).
2. Удалить UI/manager legacy hooks и старые ветки.
3. Проверить export + создание заказа + генерацию DXF с текстом.
4. Обновить smoke-тесты и примеры curl.
5. Отдельно (при необходимости): offline-миграция исторических workspace-файлов.
