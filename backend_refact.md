# Архитектурное ревью backend Layment Designer

## Executive summary
1. `backend/main.py` перегружен: в одном модуле смешаны transport/API, валидация payload, генерация артефактов, оркестрация файловой системы и логика статусов заказа.
2. В проекте нет явного application-слоя (use-cases), поэтому доменные правила «протекают» в роутеры (`export-layment`, upload и статусные endpoint’ы).
3. Работа с файловой системой расползлась по нескольким местам (`main.py`, `admin_api/api.py`, `manifest_service.py`, `file_service.py`) и реализована разными стилями (частично атомарно, частично нет).
4. Есть дубли и расхождения в путях/хелперах: в `domain_store.py` два определения `contour_geometry_path`, а логика путей заказа размазана по `main.py`.
5. Ошибки неконсистентны: где-то `HTTPException` бросается из инфраструктуры/сервисов (`pricing.py`, `file_validation.py`), где-то из роутера, где-то через кастомный `GCodeEngineError`.
6. Генерация производственных артефактов реализована корректно по назначению (G-code/DXF на backend), но orchestration в `export_layment` слишком монолитен и плохо тестируется точечно.
7. В `admin_api/api.py` накопилась «бизнес-логика админ-пайплайна» (валидация, staging, rollback, обновление manifest, конвертация DXF), что усложняет поддержку и увеличивает риск регрессий.
8. Есть признаки технического долга по качеству кода: неиспользуемые функции (`save_file`, `_update_order_status`, `_notify_production`) и потенциально избыточные вызовы (`validate_nc` вызывается повторно).
9. Для остановки «расползания» нужен слой application + инфраструктурные репозитории/хранилища + единый error mapping на уровне API без изменения публичных контрактов.

## Current state map (файл/модуль → ответственность)

| Модуль | Текущая роль | Замечания |
|---|---|---|
| `backend/main.py` | Инициализация FastAPI, public/admin роутинг, export заказа, генерация файлов заказа, чтение/листинг заказов, выдача артефактов, смена статусов | Сильное смешение слоёв (API + use-case + FS + часть домена)
| `backend/admin_api/api.py` | Админ API каталога: categories/items, загрузка SVG/NC/preview, DXF->SVG, обновление manifest, ротация NC | Очень «толстый» роутер, много инфраструктурных деталей
| `backend/services/gcode_engine.py` | Сборка итогового G-code, вставка контуров/примитивов, шаблоны start/end | Зависит от FS через `domain_store`, содержит доменные проверки примитивов
| `backend/services/order_dxf.py` | Генерация DXF (minimal/cad), геометрия контуров, labels | Смешаны формирование DXF, загрузка geometry из FS и трансформации
| `backend/services/pricing.py` | Расчёт `pricePreview` по заказу и manifest + конфигу | Сервис бросает `HTTPException` (transport-тип ошибки в сервисном коде)
| `backend/gcode_rotator.py` | Парсинг/валидация/смещение/поворот G-code, генерация rotated fragments | Инфра+алгоритмы в одном модуле; используется и runtime, и admin
| `backend/domain_store.py` | Базовые пути domain-каталога и gcode-шаблонов | Дублируется функция `contour_geometry_path`
| `backend/admin_api/manifest_service.py` | Чтение/атомарная запись manifest | Функциональность полезная, но не централизована для остальных JSON-хранилищ
| `backend/admin_api/file_service.py` | Сохранение upload-файлов | Частично дублирует операции в `admin_api/api.py`
| `backend/admin_api/file_validation.py` | Валидация SVG/NC/preview | Ошибки напрямую HTTP-ориентированные
| `backend/admin_api/dxf_to_svg.py` | Конвертер DXF → SVG + geometry payload | Инженерный utility; хорошо вынести в infra-конвертеры
| `backend/admin_api/id_utils.py` | Генерация FS-safe id из article | Доменное правило, сейчас лежит в admin_api
| `backend/admin_rotate.py` | CLI-обёртка для ротации NC | Операционный скрипт, не интегрирован в общую архитектуру

## Problem list (точечные проблемы)

1. **Монолитный use-case в роутере export**  
   `main.py::export_layment` одновременно делает валидацию входа, pricing, gcode/dxf генерацию, staging/rollback, сохранение payload/meta/status и формирование ответа. Это затрудняет локальные тесты и увеличивает связность.

2. **Дубли/расслоение операций с JSON и статусами заказа**  
   В `main.py` есть `_write_json`, `_write_status`, `_load_order_status`, `_mark_order_status`, `_update_order_status`; часть функций дублирует семантику, часть не используется.

3. **Дублирующийся путь geometry**  
   В `domain_store.py` функция `contour_geometry_path` определена дважды. Это индикатор отсутствия owner-модуля для путей/стора.

4. **FS-операции размазаны и несогласованы**  
   - staging+rollback для orders реализован в `main.py`;  
   - staging+backup+rollback для admin upload — в `admin_api/api.py`;  
   - manifest atomic write — отдельно в `manifest_service.py`.  
   Нет общего безопасного примитива «atomic transaction on FS».

5. **Утечка transport-ошибок в сервисы**  
   `pricing.py` и `file_validation.py` выбрасывают `HTTPException`, что связывает доменно/инфраструктурный код с FastAPI transport-слоем.

6. **Неконсистентный стиль ошибок и кодов**  
   Используются разные подходы: `HTTPException(detail=str(e))`, `GCodeEngineError(status_code, message)`, `RuntimeError`, `ValueError` + ручной mapping. Итог — неединый контракт ошибок и сложность поддержки.

7. **Переиспользование логики ограничено**  
   `admin_api/api.py` содержит в одном файле категории, items, upload, dxf-конвертацию, preview URL derivation, manifest updates, rotate trigger. Это усложняет обзор изменений и code ownership.

8. **Подозрительные/лишние вызовы**  
   В `upload_files` для NC есть повторный `validate_nc(nc)` после веток с sanitization; возможно избыточно и может ломать ожидаемое позиционирование stream при будущих правках.

9. **Смешение доменной логики и инфраструктуры в генераторах**  
   `order_dxf.py` читает geometry из FS (`contour_geometry_path`) внутри генератора, что затрудняет тестирование без диска и мешает инверсии зависимостей.

10. **Риск гонок при выдаче orderNumber**  
   `_next_order_number` сканирует каталог без блокировок; параллельные запросы теоретически могут выдать одинаковый номер до commit в FS.

11. **Неконсистентность артефактов заказа**  
   Канон указывает `<orderNumber>_labels.dxf`, а текущее сохранение в `export_layment` пишет `<orderNumber>.dxf` + `<orderNumber>_minimal.dxf`; это стоит зафиксировать как явное правило в одном месте (не менять сейчас, но унифицировать source of truth).

12. **Большие import-шапки и слабая модульность**  
   В `main.py` и `admin_api/api.py` импортируется широкий набор зависимостей, что обычно коррелирует с нарушением SRP и затрудняет эволюцию.

## Target architecture (без изменения поведения)

Принцип: оставить FastAPI и текущие URL/контракты, но разделить код на слои и явные границы.

### 1) Transport/API слой
- Только HTTP-вход/выход, маппинг ошибок, сериализация response.
- Никаких прямых FS-операций и доменной математики.
- Содержит:
  - public routers (`/api/*`)
  - admin routers (`/admin/api/*`)

### 2) Application/use-cases слой
- Оркестрация сценариев: `create_order`, `list_orders`, `mark_order_confirmed`, `create_catalog_item`, `upload_item_files`, `convert_dxf_to_svg`.
- Работает через абстракции репозиториев/сервисов.
- Возвращает DTO/результаты + domain/app exceptions.

### 3) Domain слой
- Модели/инварианты: Order, OrderStatus, CatalogItem, Category, ArtifactNamingRules.
- Доменная валидация (например, корректность статусов, правила именования артефактов, FS-safe id как policy).
- Не знает о FastAPI, Path, UploadFile.

### 4) Infrastructure слой
- Реализация репозиториев и утилит:
  - `ManifestRepository` (load/save versioned)
  - `OrderRepository` (meta/order/status/artifacts, orderNumber allocator)
  - `ContourRepository` (svg/nc/geometry access)
  - `FsTransaction` (staging, atomic move, rollback)
  - G-code/DXF builders adapters
  - file validators/converters

### 5) Core слой
- Конфиг (`settings`), общие типы ошибок, логирование, общие util.

### Предложенная структура директорий

```text
backend/
  api/
    public/
      orders.py
      contours.py
    admin/
      catalog_items.py
      categories.py
      orders.py
  app/
    use_cases/
      create_order.py
      list_orders.py
      get_order_details.py
      mark_order_status.py
      create_catalog_item.py
      upload_catalog_files.py
      convert_dxf_item.py
    dto/
      order_dto.py
      catalog_dto.py
  domain/
    models/
      order.py
      catalog.py
    services/
      pricing_policy.py
      artifact_naming.py
    errors.py
  infra/
    fs/
      paths.py
      transaction.py
      atomic_json.py
    repositories/
      manifest_repo.py
      order_repo.py
      contour_repo.py
    production/
      gcode_engine.py
      gcode_rotator.py
      order_dxf_builder.py
      dxf_to_svg_converter.py
    validation/
      file_validation.py
  core/
    settings.py
    logging.py
    errors.py
  main.py
```

Почему так удобнее:
- Явные границы уменьшают «протекание» IO в роутеры.
- Проще тестировать use-cases без HTTP.
- Проще менять инфраструктуру (форматы хранения/FS-детали) без переписывания API.
- Снижается риск дублирования путей и naming rules.

## Конкретные предложения по рефакторингу

### A. Централизация работы с FS
1. Вынести `paths.py` с каноничными функциями для:
   - domain assets (`svg/nc/preview/geometry`),
   - orders (`orders/<orderId>/*`, артефакты по `orderNumber`).
2. Ввести `FsTransaction` (staging dir + commit/rollback) и переиспользовать в:
   - `create_order` (сейчас в `main.py`),
   - `upload_item_files` и `dxf_to_svg` (сейчас в `admin_api/api.py`).
3. Унифицировать atomic write JSON (`manifest`, `meta`, `status`, `order`).

### B. Разгрузка роутеров
1. `main.py` разделить на:
   - `api/public/orders.py`,
   - `api/public/contours.py`,
   - `api/admin/orders.py`.
2. `admin_api/api.py` разделить минимум на:
   - `categories_router.py`,
   - `items_router.py`,
   - `item_files_router.py`.
3. В роутерах оставить только:
   - parse request,
   - вызов use-case,
   - mapping ошибок в HTTP.

### C. Единая модель ошибок
1. В domain/app слоях использовать `DomainError`, `ValidationError`, `NotFoundError`, `ConflictError`, `InfrastructureError`.
2. На уровне API сделать единый mapper (`exception_handlers.py`) в текущий совместимый формат ответа (`detail`), без ломки клиентов.
3. Постепенно убрать `HTTPException` из сервисов/инфры.

### D. Стабилизация правил именования и контрактов
1. Вынести единый модуль `artifact_naming.py`:
   - функции для имён `nc/png/svg/dxf/*` по `orderNumber`.
2. Зафиксировать различие между minimal/cad DXF как explicit policy (или привести к канону в отдельной задаче с обновлением docs).
3. Вынести проверки `orderMeta.width/height` и инварианты `1px=1mm` в domain validator, вызывать из use-case.

### E. Снятие дублирования/долга
1. Удалить дубликат `contour_geometry_path` и определить owner для path API.
2. Убрать неиспользуемые функции (`save_file`, `_update_order_status`, `_notify_production`) после подтверждения через статический анализ.
3. Привести проверки NC/SVG/preview к одному интерфейсу (валидация без HTTP-типа исключений).
4. Вынести маппинг manifest item → order contents из `main.py` в отдельный query service.

### F. Проверка unused imports и dead code
- Рекомендуемые команды (опционально, без немедленного внедрения):
  - `ruff check backend --select F401,F841`
  - `python -m pyflakes backend`
  - `vulture backend`
- Если инструменты не установлены, минимум: локальный grep + `python -m compileall backend` для smoke.

## Refactor plan (атомарные PR)

### Шаг 1. Каркас слоёв и перенос роутеров без изменения логики
- **Что меняем:** создать `backend/api/*`, перенести endpoints из `main.py` и `admin_api/api.py` по файлам, оставить старые вызовы функций.
- **Риск:** ошибки импортов/регистрации роутеров.
- **Проверка (smoke):**
  - запуск backend,
  - `GET /api/contours/manifest`,
  - `POST /api/export-layment` на тестовом payload,
  - `GET /admin/api/items`, `GET /admin/api/orders`.

### Шаг 2. Централизация paths
- **Что меняем:** новый `infra/fs/paths.py`; заменить прямые `Path`-конкатенации на функции paths.
- **Риск:** опечатки путей, ломка relative assets.
- **Проверка:**
  - upload item files,
  - export order,
  - проверка имён файлов в `orders/<orderId>/` и `domain/contours/*`.

### Шаг 3. FsTransaction и atomic json
- **Что меняем:** общий transaction helper + atomic write helper; применить в order export и admin upload.
- **Риск:** неполный rollback при исключении.
- **Проверка:**
  - искусственно бросать исключение между шагами swap,
  - проверять отсутствие «полусостояний» и восстановление backups.

### Шаг 4. Application use-cases
- **Что меняем:** вынести из роутеров сценарии:
  - `CreateOrderUseCase`,
  - `UploadItemFilesUseCase`,
  - `ConvertDxfUseCase`,
  - `MarkOrderStatusUseCase`.
- **Риск:** изменение формата ответа.
- **Проверка:** snapshot JSON response до/после (должен совпадать по контракту).

### Шаг 5. Единый error mapping
- **Что меняем:** типы ошибок в domain/app + единый mapper в API.
- **Риск:** изменение HTTP-кодов/`detail`.
- **Проверка:** таблица кейсов ошибок (invalid NC, missing item, conflict upload, missing contour rotation) и сравнение ответов с текущими.

### Шаг 6. Дедупликация и cleanup
- **Что меняем:** удалить дубли и dead code; локально упростить imports.
- **Риск:** удаление «скрыто используемого» кода.
- **Проверка:** статический анализ + smoke всех основных endpoint’ов.

### Шаг 7. Локальные тесты на инварианты
- **Что меняем:** добавить минимальные unit/integration тесты для:
  - детерминизма G-code,
  - 1 px = 1 mm,
  - order status lifecycle,
  - relative assets paths в manifest.
- **Риск:** флак/зависимость от файлового окружения.
- **Проверка:** запуск тестов на чистом temporary FS.

## Checklist проверок после каждого шага
- Контракты URL сохранены: `/api/*`, `/admin/api/*`.
- `export-layment` читает `orderMeta.width/height`.
- `orderId` и `orderNumber` всегда возвращаются в response.
- Имена артефактов в заказе соответствуют действующей политике проекта.
- `manifest.assets.*` остаются относительными путями без ведущего `/`.
- G-code сборка остаётся детерминированной.
- Преобразования/генерация производственных артефактов остаются только на backend.

## Risks & invariants (что нельзя сломать)
1. Публичные endpoint’ы и payload-формат (особенно export contract) — без breaking changes.
2. Инвариант `1 px = 1 mm` — без скрытых масштабов.
3. Domain/manifest как source of truth (`domain/contours/manifest.json` + assets paths).
4. Детерминированная сборка итогового G-code из шаблонов/фрагментов/примитивов.
5. Статусы заказа только `created -> confirmed -> produced`.
6. `orderId` как имя папки заказа; `orderNumber` как префикс артефактов.
7. Разделение namespace: public `/api/*`, admin `/admin/api/*`.

## Quick wins (1–2 часа)
1. Удалить дубликат `contour_geometry_path` и добавить простой тест на paths API.
2. Вынести `_orders_dir/_order_dir/_artifact_path` в отдельный модуль paths и переиспользовать в `main.py`.
3. Убрать явный dead code/unused imports через `ruff/pyflakes` (без функциональных изменений).
4. Разделить `admin_api/api.py` хотя бы на 2 файла: metadata endpoints и file upload endpoints.

## Дальше по мере роста
1. Ввести контрактные тесты API (snapshot ответов) перед крупными переносами.
2. Добавить file-lock/allocator для `orderNumber` против гонок в параллельной нагрузке.
3. Перевести инфраструктурные операции на интерфейсы репозиториев для упрощения unit-тестов use-cases.
