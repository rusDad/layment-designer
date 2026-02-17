# Layment Designer — обзор архитектуры

## Назначение

Layment Designer — производственно-ориентированный сервис для формирования раскладки
инструментов в ложементе и детерминированной генерации CNC G-code для производства.

Важно:
- `final.nc` — внутренний технологический артефакт производства;
- `final.nc` не является продуктом сервиса и не является тем, что передаётся клиенту как конечный результат;
- конечный продукт сервиса — физически изготовленный ложемент.

Система спроектирована с жёстким разделением ответственности:
- frontend — слой визуализации и сбора данных;
- backend — детерминированная обработка заказа и генерация производственных артефактов;
- domain — единственный источник истины по данным инструментов.

---

## Высокоуровневая архитектура

Browser
  → Nginx
    → Backend (FastAPI)
      → Domain (файловые данные)

---

## Domain

Каталог `domain/` содержит все данные по инструментам и контурам.
Это единый источник истины, которым не владеют frontend/backend как кодовые модули.
`domain` хранится файлово на VDS и может отсутствовать в репозитории (в репозитории — только код).

```text
domain/contours/
├── manifest.json
├── svg/      # контуры инструментов для визуализации на frontend
├── preview/  # превью инструментов (опционально)
└── nc/       # эталонные CNC-программы (используются backend)
```

Правила:
- `domain` read-only для public runtime; изменения только через admin pipeline;
- frontend не получает manifest и метаданные из `/contours/` напрямую;
- manifest доступен только через `GET /api/contours/manifest`;
- frontend может загружать ассеты (`svg/preview`) по публичным URL `/contours/...`;
- backend читает файлы `domain` напрямую из файловой системы.

---

## Backend (FastAPI)

Зона ответственности:
- чтение `domain/contours/manifest.json`;
- валидация и обработка заказов;
- генерация CNC G-code как производственного артефакта;
- предоставление стабильных API-контрактов.

Ключевые endpoint'ы:
- `GET /api/contours/manifest`;
- `POST /api/export-layment`.

Backend разворачивается как systemd-сервис и не зависит от `cwd`.

---

## Orders

Единица хранения заказа: папка `backend/orders/<orderId>`.

Состав файлов заказа:
- `order.json` — исходные данные заказа (экспорт с frontend + бизнес-контекст);
- `meta.json` — технические метаданные заказа (временные метки, версии, параметры обработки);
- `status.json` — текущее состояние заказа в жизненном цикле;
- `final.nc` — внутренний артефакт производства для ЧПУ;
- `layout.png` / `layout.svg` — визуальный слепок раскладки для контроля и документооборота.

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

## Frontend

Зона ответственности frontend:
- загрузка manifest через API;
- рендер SVG-контуров;
- сбор данных раскладки;
- отправка заказа на backend.

Frontend:
- не знает о CNC, G-code и NC-файлах;
- не работает с файловыми путями на сервере;
- работает только через HTTP API.

---

## Nginx

Nginx используется как reverse proxy и сервер статических файлов.

Правила маршрутизации:
- `/` → frontend;
- `/api/*` → backend (FastAPI);
- `/contours/*` → статика из `domain/contours/`.

Прямой доступ к `manifest.json` через `/contours/manifest.json` запрещён.

---

## Принципы проектирования

- стабильные идентификаторы важнее удобства;
- frontend «тупой», backend «умный»;
- никаких неявных преобразований координат;
- все данные domain должны быть FS-safe;
- MVP без технического долга.

---

## Smoke test (ручной)

Предполагается, что FastAPI запущен локально на `http://localhost:8001`.

1) Manifest и статический SVG:

```bash
curl -s http://localhost:8001/api/contours/manifest
curl -I http://localhost:8001/contours/svg/<id>.svg
```

2) Публичный export:

```bash
curl -X POST http://localhost:8001/api/export-layment \
  -H "Content-Type: application/json" \
  -o /tmp/final_layment.nc \
  -d '{
    "orderMeta": { "width": 565, "height": 375, "units": "mm", "coordinateSystem": "origin-top-left" },
    "contours": [ { "id": "<id>", "x": 10, "y": 10, "angle": 0, "scaleOverride": 1 } ],
    "primitives": []
  }'
```

3) Admin: создание item + загрузка файлов + формат `manifest.assets`:

```bash
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
```