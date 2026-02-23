# Layment Designer — обзор архитектуры

## Назначение

Layment Designer — производственно-ориентированный сервис для формирования раскладки
инструментов в ложементе и детерминированной генерации CNC G-code.

**Важно:** `<orderNumber>.nc` / итоговый G-code — внутренний артефакт производства. Продукт сервиса — физически изготовленный ложемент.

---

## Компоненты

### 1) Frontend (plain JS + fabric.js)
- Визуализация и управление раскладкой.
- Рендер SVG-контуров инструментов.
- Размещение/повороты/снап/выемки (primitives).
- Валидирует раскладку перед экспортом (границы/пересечения).
- Экспорт стабильного JSON-контракта на backend.
- Экспорт превью (SVG/PNG) всего ложемента как “снимок” заказа.

### 2) Backend (FastAPI)
- Читает каталог инструментов из `domain/contours/manifest.json`.
- Принимает экспорт от frontend (`POST /api/export-layment`).
- Сохраняет заказ: входной JSON + превью.
- Генерирует итоговый G-code детерминированно из подготовленных NC-фрагментов домена.
- Генерирует DXF артефакты заказа (контуры/примитивы + отдельный DXF под labels).

### 3) Domain (файловый каталог)
Хранит “истину” о доступных инструментах и их производственных ассетах:
- `domain/contours/manifest.json`
- `domain/contours/svg/*.svg` — контуры для фронта
- `domain/contours/nc/*` — NC-фрагменты для бэкенда
- `domain/contours/preview/*` — опциональные превью
- дополнительно могут существовать служебные артефакты пайплайна (например `geometry/*.json`)

---

## Координаты и семантика

- Origin фронта: левый верхний угол ложемента; `x → вправо`, `y → вниз`.
- Для контуров на экспорт берётся `obj.aCoords.tl` (опорный угол bbox).
- Это важно для согласования с тем, как backend применяет offset/rotation к NC-фрагментам.
- Все проверки/экспорт выполняются при масштабе `1:1` (паттерн `performWithScaleOne()`).

---

## API / URL неймспейсы

- Public API: `/api/*`
- Admin API: `/admin/api/*`
- Admin UI: `/admin` (static)
- Domain static: `/contours/*` (раздача `domain/contours`)

---

## Orders

Единица хранения заказа: папка `orders/<orderId>` (в корне репозитория).

В заказе есть два идентификатора:
- `orderId` — технический идентификатор папки (FS-safe, используется в URL и как ключ доступа).
- `orderNumber` — человекочитаемый номер вида `K-00001`, используется как префикс имён производственных файлов.

Состав файлов заказа (актуальный канон):
- `order.json` — исходные данные заказа (экспорт с frontend + бизнес-контекст);
- `meta.json` — технические метаданные заказа (временные метки, версии, параметры обработки);
- `status.json` — текущее состояние заказа в жизненном цикле;
- `<orderNumber>.nc` — внутренний артефакт производства для ЧПУ (основной G-code);
- `<orderNumber>.png` / `<orderNumber>.svg` — визуальный слепок раскладки для контроля и документооборота;
- `<orderNumber>.dxf` — DXF раскладки (контуры/примитивы);
- `<orderNumber>_labels.dxf` — DXF с включёнными `labels` (для лазерной маркировки).


Канонический flow:
- `export` → создание заказа и `orderId` (`created`);
- переход к оплате (точка интеграции);
- после оплаты: `confirm` (`confirmed`);
- производство (`production`);
- завершение изготовления: `produced`.

После создания заказа должна существовать точка интеграции:
- переход на оплату;
- передача данных заказа в 1С/документооборот.

На текущем этапе эта интеграция фиксируется архитектурно, без реализации.

---

## Конфигурация и деплой

Backend разворачивается как systemd-сервис и не зависит от `cwd`.
Nginx используется как reverse proxy и сервер статических файлов.

---

## Smoke test (ручной)

Предполагается, что FastAPI запущен локально на `http://localhost:8001`.

1) Manifest и статический SVG:

```bash
curl -s http://localhost:8001/api/contours/manifest
curl -I http://localhost:8001/contours/svg/<id>.svg

2) Публичный export:

curl -sS -X POST http://localhost:8001/api/export-layment \
  -H "Content-Type: application/json" \
  -d '{
    "orderMeta": { "width": 565, "height": 375, "units": "mm", "coordinateSystem": "origin-top-left" },
    "contours": [ { "id": "<id>", "x": 10, "y": 10, "angle": 0, "scaleOverride": 1 } ],
    "primitives": [],
    "labels": []
  }' | jq

 Экспорт возвращает JSON (в т.ч. orderId и orderNumber). Скачивание производственных файлов — через admin endpoints:

3)  Admin: создание item + загрузка файлов + формат manifest.assets:

curl -X POST http://localhost:8001/admin/api/items \
  -H "Content-Type: application/json" \
  -d '{
    "article": "ART-001",
    "name": "Demo tool",
    "brand": "Demo",
    "category": "demo",
    "scaleOverride": 1,
    "cuttingLengthMeters": 0.5,
    "enabled": true
  }'

curl -X POST "http://localhost:8001/admin/api/items/<id>/files" \
  -F "svg=@domain/contours/svg/<id>.svg" \
  -F "nc=@domain/contours/nc/<id>.nc" \
  -F "preview=@domain/contours/preview/<id>.png"

curl -s http://localhost:8001/api/contours/manifest | grep -n "\"assets\""



## Принципы проектирования

- стабильные идентификаторы важнее удобства;
- frontend «тупой», backend «умный»;
- никаких неявных преобразований координат;
- все данные domain должны быть FS-safe;

---
