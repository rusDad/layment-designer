# Конструктор ложементов — актуальные правила проекта

## Назначение проекта
Веб-сервис производственного класса для проектирования ложементов из EVA-foam под инструмент.

Пайплайн в текущем виде:
- клиент собирает раскладку в браузерном конструкторе;
- frontend валидирует пользовательскую раскладку на уровне editor semantics;
- backend принимает стабильный JSON-контракт заказа;
- backend рассчитывает цену и создаёт заказ;
- backend детерминированно генерирует производственные артефакты;
- производство получает данные заказа и артефакты на изготовление.

## Что является продуктом сервиса
- `.nc` и `.dxf` — внутренние производственные артефакты.
- Они не являются конечной пользовательской ценностью сами по себе.
- Конечный продукт сервиса — физически изготовленный ложемент.

## Предзапускный режим
Проект находится в режиме pre-launch / pre-internal-rollout.

Следствия:
- допустимы короткие простои;
- допустимы breaking changes, если они упрощают архитектуру;
- не нужно сохранять обратную совместимость ради старых PoC-решений;
- не нужно вводить временные адаптеры, legacy-shims и transitional layers без явной необходимости.

При выборе между чистым разрывом и временной совместимостью по умолчанию предпочтителен чистый разрыв.

## Жёсткие инварианты

### 1. Frontend «тупой», backend «умный»
Frontend отвечает за визуализацию, UX и сбор данных редактора.

Backend отвечает за:
- производственные преобразования;
- интерпретацию раскладки для изготовления;
- расчёт цены;
- генерацию G-code;
- генерацию DXF;
- файловую фиксацию заказа.

### 2. Единицы измерения
- `1 px == 1 mm` всегда.
- Любые скрытые пересчёты, «логические единицы», внутренние scale-факторы для геометрии и прочая магия запрещены.
- Масштабирование на frontend допустимо только как визуальное представление viewport.

### 3. Стабильные идентификаторы важнее удобства
- `id` должен быть FS-safe.
- `id` создаётся один раз и далее используется как:
  - имя файлов каталога;
  - ключ JSON-данных;
  - идентификатор в manifest;
  - идентификатор для G-code / geometry-пайплайна.
- Нельзя переизобретать локальные alias/id на отдельных слоях без явной причины.

### 4. Domain — источник истины по каталогу
Канонический каталог лежит в `domain/contours/`.

Структура доменных артефактов:
- `manifest.json`
- `svg/`
- `nc/`
- `preview/`
- `geometry/`

Назначение:
- `svg/` — frontend rendering assets;
- `nc/` — эталонные производственные фрагменты для backend;
- `preview/` — превью каталога;
- `geometry/` — геометрия для DXF-генерации заказа.

### 5. Координатная семантика frontend
- Origin на frontend: левый верхний угол ложемента.
- `x` растёт вправо.
- `y` растёт вниз.
- Для contour export используются координаты `obj.aCoords.tl`.
- Это не случайность и не workaround, а каноническая семантика опорной точки.

### 6. Все проверки и экспорт выполняются при масштабе 1:1
- Все проверки границ, пересечений, построение export DTO, workspace snapshot и preview payload должны выполняться при `scale = 1`.
- Канонический паттерн: `performWithScaleOne()`.

## Текущая архитектура проекта

### Backend
Текущая рабочая реализация — FastAPI backend.

Ключевые факты текущего состояния:
- `backend/main.py` всё ещё содержит значительную часть orchestration-логики заказа;
- `backend/admin_api/api.py` остаётся толстым роутером админ-пайплайна;
- генерация G-code и DXF выполняется на backend;
- файловое хранение заказа и каталога остаётся канонической инфраструктурой.

Архитектурное направление для новых PR:
- двигаться к явному разделению `transport -> application/use-cases -> domain -> infrastructure`;
- не протаскивать новые FS-операции и доменную логику прямо в роутеры;
- не усиливать монолитность `main.py` и `admin_api/api.py`.

Важно: это именно **направление развития**, а не утверждение, что кодовая база уже полностью приведена к этой схеме.

### Frontend editor
Frontend остаётся на plain JS + Fabric.js.

Текущее состояние frontend:
- `app.js` остаётся orchestration hub и содержит значительный runtime-state;
- уже выделены важные модули: `objectMeta`, `interactionPolicy`, `actionExecutor`, `textManager`, `ui.dom`;
- архитектурное направление — изоляция **Editor Core**, а не бессмысленная «абстракция от Fabric любой ценой».

Каноническое направление frontend-архитектуры:
- **Canvas Adapter / Fabric Runtime** — low-level canvas mechanics;
- **Editor Core** — semantic object state, policy, executor, selection/group/lock/text semantics, workspace/export rules;
- **App Shell / Integration Layer** — DOM wiring, catalog UI, modal flow, API calls, embedding.

### SVG3D viewer / preview service
В проекте есть отдельный сервис 3D preview.

Его роль:
- не заменяет backend заказа;
- не является источником истины для manufacturing semantics;
- используется для customer-facing preview и вспомогательной визуализации.

В текущем коде viewer умеет:
- открываться в `debug` и `preview` mode;
- загружать SVG payload по `payloadKey` из `localStorage`;
- принимать визуальные параметры `baseMaterialColor`, `laymentThicknessMm`, `texts`;
- отдельно поддерживать STL preview flow.

## Manifest — канон каталога

### Структура manifest
`manifest.json` в текущей кодовой базе хранит:
- `version`
- `items`
- `categories`
- `sets` (если используются)

### Каноническая структура item
Ключевые поля item:
- `id`
- `article`
- `name`
- `brand`
- `category`
- `enabled`
- `scaleOverride`
- `cuttingLengthMeters`
- `defaultLabel` (optional)
- `poseKey` (optional)
- `poseLabel` (optional)
- `machining.basePocketDepthMm` (optional)
- `assets.svg`
- `assets.nc`
- `assets.preview`

### Правила по assets
В `manifest.assets.*` всегда хранятся **относительные пути без ведущего `/`**.

Канонический формат:
- `svg/<id>.svg`
- `nc/<id>.nc`
- `preview/<id>.<ext>`

### Categories
Категории являются частью manifest и управляются через admin API.

Правила:
- slug категории должен быть стабильным;
- slug — lowercase latin + digits + dashes;
- frontend должен опираться на manifest/API, а не на локально прошитый список категорий.

### Sets
`manifest.sets` поддерживается backend/admin API и является частью текущей кодовой базы.

Если фича использует наборы, она должна:
- читать их из manifest/API;
- не вводить параллельную структуру хранения set-ов вне manifest.

## Admin pipeline

### Добавление артикула — два явных шага
1. Создание/обновление metadata и получение/подтверждение канонического `id`.
2. Загрузка файлов только для существующего item.

### Что происходит до runtime
Преобразования геометрии должны происходить на admin-этапе, а не при оформлении заказа.

Текущий канон:
- DXF загружается через admin API;
- DXF конвертируется в `svg/<id>.svg`;
- одновременно формируется `geometry/<id>.json`;
- runtime-заказ не должен заниматься DXF->SVG/geometry-конверсией «по требованию».

### NC pipeline
При загрузке NC backend:
- валидирует входной файл;
- при необходимости прогоняет sanitizer для Fusion NC;
- сохраняет канонический `nc/<id>.nc`;
- генерирует rotated versions в `domain/contours/nc/<id>/rotated_*.nc`.

Следствие:
- повороты contour-фрагментов — часть подготовленного доменного пайплайна;
- нельзя переносить генерацию rotated NC в frontend или в runtime заказа.

## Orders

### Два идентификатора заказа
- `orderId` — технический FS-safe идентификатор папки заказа;
- `orderNumber` — человекочитаемый номер вида `K-00001`.

### Каноническое хранилище заказа
Единица хранения — папка `orders/<orderId>/`.

Текущие обязательные файлы заказа:
- `order.json`
- `meta.json`
- `status.json`
- `<orderNumber>.nc`

Текущие визуальные/документные артефакты, если были переданы/сгенерированы:
- `<orderNumber>.png`
- `<orderNumber>.svg`
- `<orderNumber>.dxf`
- `<orderNumber>_minimal.dxf`

Важно:
- в старой документации фигурировал `<orderNumber>_labels.dxf` как канон;
- текущая runtime-реализация пишет `<orderNumber>.dxf` и `<orderNumber>_minimal.dxf`;
- новые документы и решения должны опираться на фактическую реализацию, пока naming policy не будет осознанно унифицирована отдельной задачей.

### Жизненный цикл заказа
Канонические статусы:
- `created`
- `confirmed`
- `produced`

После создания заказа предусмотрена точка интеграции:
- переход на оплату;
- передача данных в 1С / документооборот.

Эта интеграция архитектурно предполагается, но в текущем этапе не является полностью реализованным продуктовым контуром.

## Контракт frontend -> backend

### Общая форма export request
Канонический transport-контракт строится вокруг:
- `orderMeta`
- `contours`
- `primitives`
- `texts`
- `customer`

### orderMeta
Текущие поддерживаемые backend-поля:
- `width`
- `height`
- `units`
- `coordinateSystem`
- `baseMaterialColor`
- `laymentType`
- `laymentThicknessMm`
- `pricePreview` (optional, transport/meta)
- `workspaceSnapshot` (optional)
- `canvasPng` (optional)

Правила:
- backend читает `orderMeta.width` и `orderMeta.height` как канонические размеры заказа;
- нельзя возвращаться к ширине/высоте на верхнем уровне DTO;
- `baseMaterialColor` и `laymentThicknessMm` считаются частью заказа, а не только UI-состояния.

### contours[]
Канонические поля placement:
- `id`
- `x`
- `y`
- `angle`
- `scaleOverride` (optional)
- `article` (optional)
- `name` (optional)
- `poseKey` (optional)
- `poseLabel` (optional)
- `depthOverrideMm` (reserved seam)

Правила:
- `x/y` экспортируются в frontend-coordinate system;
- backend сам интерпретирует эти координаты для machining semantics;
- поворот и offset применяются только на backend.

### primitives[]
Текущие поддерживаемые типы:
- `rect`
- `circle`

Текущие поля:
- `type`
- `x`
- `y`
- `width` / `height` для `rect`
- `radius` для `circle`
- `pocketDepthMm` (reserved seam)

Backend-ограничения текущей реализации:
- примитивов не больше `128` на заказ;
- backend валидирует размеры, тип и нахождение в пределах ложемента;
- frontend-ограничения сами по себе не считаются достаточной защитой.

Семантика primitives:
- это editor/runtime entities, поддерживаемые в export;
- они не являются частью каталога `manifest.items`.

### texts[]
Текущие export-поля:
- `kind`
- `text`
- `x`
- `y`
- `angle`
- `fontSizeMm`
- `ownerContourId` (optional)

Семантика:
- поддерживаются `free` и `attached` тексты;
- attached text остаётся editor-semantic сущностью до экспорта;
- backend использует `texts[]` для DXF-маркировки.

### customer
Текущие поля:
- `name`
- `contact`

Это часть заказа, а не editor-state.

### Preview / snapshot поля
Текущее состояние кодовой базы смешанное:
- frontend кладёт `canvasPng` и `workspaceSnapshot` внутрь `orderMeta`;
- frontend также всё ещё отправляет top-level `layoutPng` и `layoutSvg`;
- backend сохраняет top-level `layoutPng/layoutSvg`, если они пришли;
- backend-модель при этом канонически описана вокруг `orderMeta`.

Правило для новых изменений:
- не плодить новые дублирующие preview/snapshot поля;
- считать `orderMeta.workspaceSnapshot` и `orderMeta.canvasPng` основным направлением;
- любые изменения preview DTO делать осознанно и синхронно на обеих сторонах.

## Frontend editor rules

### Базовые runtime-модули
Новые PR не должны игнорировать существующий каркас:
- `objectMeta`
- `interactionPolicy`
- `actionExecutor`
- `textManager`
- `ui.dom`

### Правила для новых editor features
1. Нельзя добавлять новый инструмент просто локальным handler-ом в `app.js`, если он затрагивает editor semantics.
2. Любая meaningful mutation должна проходить через semantic слой и предсказуемый execution path.
3. Multi-object actions не должны плодить отдельные ad-hoc ветки без явной причины.
4. Workspace state и export state должны разделяться явно.
5. Editor-only state не должен утекать в export случайно.

### Что запрещено
- переносить semantic rules в DOM handlers;
- дублировать eligibility rules в нескольких местах;
- патчить Fabric objects напрямую из UI shell как основной способ реализации фичи;
- вводить тяжёлые фреймворки или сборщики без очень веской причины;
- переписывать editor под Vue/Nuxt как native-canvas feature.

## Интеграция в storefront / внешний shell
Если editor встраивается в сайт или storefront, целевая модель такая:
- внешний shell владеет route/page composition/commercial UX;
- editor core владеет editor semantics;
- backend владеет производственной семантикой и финальной обработкой заказа.

Каноническое направление интеграции:
- command/query boundary;
- явный init/destroy lifecycle;
- явный import/export payload;
- явные high-level events.

Анти-цель:
- растворить editor semantics во внешнем UI/store и тем самым воспроизвести `app.js`-хаос на другом слое.

## Validation and safety rules
- Frontend validation важна для UX, но не считается достаточной защитой.
- Backend обязан валидировать входной payload до расчётов и генерации артефактов.
- Любые поля, доступные через прямой POST, считаются недоверенными.
- Если появляются новые expensive entities, для них сразу нужны backend-лимиты и размерные проверки.

## Deployment and environment
Deployment-детали не являются частью ядра продуктового канона, если не влияют напрямую на модель данных или поведение продукта.

Следствия:
- `nginx`, `systemd`, URL-prefix deployment topology, shared venv и server layout должны жить в `DEPLOYMENT.md`;
- root `AGENTS.md` не должен фиксировать случайные детали текущего хостинга как архитектурную истину проекта;
- при изменении деплоя core project rules не должны переписываться без необходимости.

## Стиль инженерных изменений
- Изменения должны быть небольшими, атомарными и проверяемыми.
- Перед правками нужно найти все места использования и зависимые контракты.
- Нельзя менять публичные пути, JSON-форматы и файловые соглашения «по-тихому».
- Если контракт меняется, это должно быть синхронно отражено:
  - в frontend;
  - в backend;
  - в docs;
  - в admin/runtime смежных местах, где это нужно.

## Что считать подозрительным
Следующие вещи нужно явно замечать, а не замалчивать:
- расхождение между docs и runtime;
- дубли полей в DTO;
- дубли path/naming-логики;
- backend-валидация, зависящая только от frontend;
- новые bypass-path вокруг `actionExecutor` / policy;
- попытки тащить deployment specifics в core canon;
- сохранение PoC-ограничений без проверки, являются ли они ещё фундаментальными.

## Короткое резюме
Проектовый канон сейчас такой:
- editor работает в `1 px == 1 mm`;
- каталог живёт в `domain/contours` и управляется через backend/admin API;
- frontend собирает semantic layout data, но не выполняет manufacturing transforms;
- backend создаёт заказ и производственные артефакты детерминированно;
- новые изменения должны усиливать separation of concerns, а не размывать её.
