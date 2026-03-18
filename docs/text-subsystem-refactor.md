# Text subsystem refactor (frontend ↔ backend)

## Цель

Зафиксировать целевую архитектуру текстовой подсистемы после clean break от legacy-термина `labels` к единой модели `texts` в:
- editor model;
- workspace snapshot;
- export DTO;
- DXF-пайплайне backend.

Документ описывает уже целевое состояние: runtime использует только `texts[]`, legacy `labels[]` и отдельный label-manager в UI больше не участвуют.

---

## 1) Editor model: text object

Канонический editor-object на canvas (Fabric `IText`) имеет поля:

- `isTextObject: true` — типовой маркер текстового объекта;
- `kind: 'attached' | 'free'` — режим жизненного цикла;
- `role: 'default-text' | 'user-text' | <future>` — функциональная роль;
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
6. У одного owner-контура может быть несколько `attached`-текстов.

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
- Все attached-тексты owner'а синхронизируются как единый набор, а не как одиночный follower.

### 2.3 Default text
- Частный случай `attached` с `role='default-text'`.
- Создаётся автоматически из метаданных контура (`defaultLabel`) только если для placement ещё нет default-text.
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
   - `ActionExecutor` собирает follower-пары для всех attached-text owner'а, а не только для первого найденного текста;
   - затем `clampTextToContourBounds()` и повторная фиксация якоря `updateAttachedTextAnchorFromAbsolute()`.

4. **Duplicate contour**
   - дублируется сам contour;
   - затем дублируются все attached-text owner'а с переносом semantic metadata и локальных offset/angle.

5. **Delete contour**
   - удаляются все `attached` с данным `ownerPlacementId`.

6. **Persist/restore**
   - snapshot строится из `textManager.getWorkspaceTextsData()`;
   - restore идёт через `normalizeWorkspaceTexts()` и фабрики `createFreeText()/createAttachedText()`.

Ключевой принцип: нет отдельного label-flow — только единый text-flow.

---

## 4) Workspace snapshot (`texts[]`, versioning, clean break)

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
      "role": "default-text",
      "ownerPlacementId": 12,
      "text": "T15",
      "fontSizeMm": 4,
      "localOffsetX": 10,
      "localOffsetY": -6,
      "localAngle": 0,
      "x": 140,
      "y": 80
    },
    {
      "kind": "attached",
      "role": "user-text",
      "ownerPlacementId": 12,
      "text": "LOT-7",
      "fontSizeMm": 4,
      "localOffsetX": 12,
      "localOffsetY": 8,
      "localAngle": 0,
      "x": 142,
      "y": 94
    }
  ]
}
```

### Versioning

- Поддерживается только `schemaVersion=3`.
- Snapshot с другими версиями считаются неподдерживаемыми и не загружаются.
- Legacy payload с `labels[]` не мигрируется на клиенте в runtime.

### Clean break

- `labels[]` удалён из workspace-снимка полностью.
- Любая обратная совместимость по `labels[]` допускается только как отдельный offline-скрипт миграции данных (не в UI runtime).
- Runtime не хранит параллельные `labels`-коллекции и не использует отдельный `labelManager`.

---

## 5) Export DTO (`texts[]`) и граница builder-слоя

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
    },
    {
      "kind": "free",
      "text": "Проверить ориентацию",
      "x": 40,
      "y": 30,
      "angle": 0,
      "fontSizeMm": 4,
      "ownerContourId": null
    }
  ]
}
```

### Граница builder-слоя (frontend)

Builder-слой заканчивается на методах:
- `buildExportContours()`;
- `buildExportPrimitives()`;
- `textManager.buildExportTexts()` / `app.buildExportTexts()`.

Требования к builder-слою:
1. Не интерпретирует производство (никакого G-code/DXF-расчёта на frontend).
2. Отдаёт только геометрию и метаданные текста в мм.
3. Для `attached` вычисляет абсолютные координаты через `textManager.computeAbsoluteTextPosition()`.
4. Сериализует `ownerContourId` как строку placement-id.
5. Не возвращает никакой fallback-структуры `labels[]`.

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

## 7) Что удалено в рамках clean break

Из runtime и актуального frontend-кода удалены:

- файл `frontend/js/labelManager.js`;
- legacy export-метод `getExportTextsData()` со старым форматом `contourId/text/x/y`;
- label-oriented naming в executor (`sourceLabel`, `duplicatedLabel` и т.п.);
- single-attached-text assumption в duplicate/follower paths;
- любые runtime fallback-ветки по `labels[]`.

Допускаются только:
- исторические упоминания `labels[]` в документации как описание удалённого legacy;
- каноническое имя артефакта `<orderNumber>_labels.dxf`, если это часть производственного naming-конвеншена.

---

## 8) Инженерный критерий готовности

1. `textManager.texts[]` остаётся единственным runtime source of truth.
2. У одного owner-контура поддерживается несколько attached-text объектов.
3. `delete`, `duplicate` и follower-update paths работают со всем набором attached-text owner'а.
4. Workspace snapshot и export используют только `texts[]`.
5. Любая историческая миграция legacy-data допускается только как offline script, не как UI runtime.
