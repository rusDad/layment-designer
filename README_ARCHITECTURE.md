# Layment Designer — обзор архитектуры

## Назначение

Layment Designer — производственно-ориентированный сервис для формирования раскладки
инструментов в ложементе и детерминированной генерации производственных артефактов.

**Важно:** `.nc` / `.dxf` — внутренние производственные артефакты. Продукт сервиса — физически изготовленный ложемент.

---

## Компоненты

### 1) Frontend (plain JS + fabric.js)

Отвечает за:
- визуализацию и UX редактора;
- работу редактора раскладки (catalog UI/state живёт в shell-слое);
- frontend validation (границы/пересечения) для UX;
- формирование стабильного export payload для backend.

Текущая frontend-структура:
- `app.js` — основной orchestration/runtime hub (всё ещё крупный);
- `objectMeta` + `interactionPolicy` + `actionExecutor` — semantic/policy/execution каркас;
- `selectionPointerController` — pointer/selection boundary;
- `editorFacade` — command/query boundary;
- `shell/*` — UI integration слой (`catalog`, `controls`, `orderFlow`, `bootstrap`).

### 2) Backend (FastAPI)

- Читает каталог из `domain/contours/manifest.json`.
- Принимает экспорт (`POST /api/export-layment`).
- Валидирует payload и создаёт заказ.
- Генерирует G-code и DXF артефакты детерминированно.
- Хранит заказ и связанные артефакты на ФС.

### 3) Domain (файловый каталог)

Источник истины для каталога:
- `domain/contours/manifest.json`
- `domain/contours/svg/*.svg`
- `domain/contours/nc/*`
- `domain/contours/preview/*`
- `domain/contours/geometry/*.json` (pipeline артефакты)

---

## Координаты и инварианты

- `1 px == 1 mm`.
- Origin frontend: левый верхний угол ложемента (`x -> вправо`, `y -> вниз`).
- Для contour export используются координаты `obj.aCoords.tl`.
- Все проверки/экспорт выполняются при `scale=1` (`performWithScaleOne()`).

---

## Orders

Единица хранения: `orders/<orderId>/`.

Два идентификатора:
- `orderId` — технический FS-safe id;
- `orderNumber` — человекочитаемый номер (`K-00001`).

Текущие обязательные файлы заказа:
- `order.json`;
- `meta.json`;
- `status.json`;
- `<orderNumber>.nc`.

Текущие визуальные/документные артефакты (если переданы/сгенерированы):
- `<orderNumber>.png`;
- `<orderNumber>.svg`;
- `<orderNumber>.dxf`;
- `<orderNumber>_minimal.dxf`.

---

## Text subsystem (clean break)

- Runtime source of truth: `textManager.texts[]`.
- Workspace snapshot и export используют только `texts[]`.
- `attached`-тексты связаны через `ownerPlacementId` и экспортируются как `ownerContourId`.
- Поддерживается несколько attached-text для одного owner-контура.

---

## API / URL неймспейсы

- Public API: `/api/*`
- Admin API: `/admin/api/*`
- Admin UI: `/admin`
- Domain static: `/contours/*`

---

## Принципы проектирования

- frontend «тупой», backend «умный»;
- стабильные id важнее ad-hoc удобства;
- separation of concerns важнее временных workaround-ов;
- нельзя тихо менять контракты и path/naming semantics.
