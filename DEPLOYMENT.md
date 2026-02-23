```md
# DEPLOYMENT.md — Layment Designer (VDS Runbook)

Этот документ описывает текущий production-деплой на VDS: пути, systemd/uvicorn, nginx-маршрутизацию и стандартный цикл выката.

---

## 1) Production paths (VDS)

Корневая директория проекта на сервере:

- `/var/www/layment-designer/`

Структура:

- `/var/www/layment-designer/frontend/` — публичный UI (static)
- `/var/www/layment-designer/admin/` — админ UI (static)
- `/var/www/layment-designer/backend/` — backend (FastAPI/uvicorn + venv)
- `/var/www/layment-designer/domain/contours/` — Domain data (single source of truth)
  - `manifest.json`
  - `svg/`
  - `nc/`
  - `preview/`
- `/var/www/layment-designer/orders` — Orders (runtime):
---

## 2) Backend service (systemd + uvicorn)

### systemd unit
- Unit name: `layment-backend.service`
- Enabled: `enabled`
- Runs: `uvicorn`
- Port: `8001`

Фактический ExecStart (по status):

- `/var/www/layment-designer/backend/venv/bin/python3 /var/www/layment-designer/backend/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8001`

### Useful commands
Статус:
```bash
sudo systemctl status layment-backend.service
````

Рестарт:

```bash
sudo systemctl restart layment-backend.service
```

Логи:

```bash
sudo journalctl -u layment-backend.service -n 200 --no-pager
sudo journalctl -u layment-backend.service -f
```

---

## 3) Nginx

### Site config

* `/etc/nginx/sites-available/layment-designer`
* Обычно подключён через symlink в `/etc/nginx/sites-enabled/`

Проверка конфига:

```bash
sudo nginx -t
```

Reload (без разрыва соединений, если меняли только конфиг):

```bash
sudo systemctl reload nginx
```

Restart (если нужно полностью перезапустить):

```bash
sudo systemctl restart nginx
```

### Current routing (важное поведение)

#### Public UI (frontend)

* `root /var/www/layment-designer/frontend;`
* `/` → static, `try_files $uri $uri/ =404;`

#### Admin UI

* `location /admin/ { root /var/www/layment-designer; try_files $uri $uri/ /admin/index.html; }`
* Admin UI живёт по URL: `/admin/`

#### Domain assets (contours)

* `location /contours/ { alias /var/www/layment-designer/domain/contours/; try_files $uri $uri/ =404; }`

**ВАЖНО:** это только раздача ассетов (svg/nc/preview).

#### Запрет прямого доступа к manifest (оставляем намеренно)

* `location = /contours/manifest.json { return 404; }`

**Правило:** manifest должен запрашиваться только через backend API:
`GET /api/contours/manifest`

#### Public API

* `location /api/ { proxy_pass http://127.0.0.1:8001/api/; ... }`

То есть URL вида `/api/...` на nginx проксируются на backend с префиксом `/api/...`.

#### Admin API

* `location /admin/api/ { proxy_pass http://127.0.0.1:8001; ... }`

Backend должен предоставлять админ-эндпоинты под `/admin/api/*` (или nginx должен быть скорректирован под фактические пути).

#### Default server (drop)

Есть default server, который возвращает `444` для всех доменов, не совпадающих с указанными в `server_name`.

---

## 4) Canonical API endpoints (prod expectations)

Manifest:

* Frontend загружает каталог инструментов через:

  * `GET /api/contours/manifest`

Export:

* Frontend отправляет заказ:

  * `POST /api/export-layment`

Admin API:

* Все админ-эндпоинты живут под:

  * `/admin/api/*`

---

## 5) Standard deploy workflow (current)

### На локальной машине

* Разработка в VSCode
* Commit + push в `main`

### На VDS

```bash
cd /var/www/layment-designer
git pull origin main

sudo systemctl restart layment-backend.service
sudo systemctl reload nginx
```

Если менялся nginx-конфиг:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 6) Smoke checks (после выката)

### Backend health / manifest via API

```bash
curl -sS http://127.0.0.1/api/contours/manifest | head
# или снаружи (по IP/домену):
# curl -sS http://195.133.13.84/api/contours/manifest | head
```

### Проверка запрета прямого доступа к manifest

```bash
curl -i http://127.0.0.1/contours/manifest.json
# ожидаем 404
```

### Проверка доступности ассетов (пример)

```bash
# подставь реальный путь из manifest.assets.svg
curl -I http://127.0.0.1/contours/svg/<some-id>.svg
```

### Export (ручной)

Выполни экспорт из UI или отправь JSON (если есть sample_order.json):

```bash
curl -sS -X POST http://127.0.0.1/api/export-layment \
  -H "Content-Type: application/json" \
  -d @sample_order.json \
  -o out.nc
```

---

## 7) Notes / gotchas

* `/contours/` раздаёт файлы напрямую с диска, поэтому любые изменения в `domain/contours` видны сразу (без рестарта backend/nginx).
* `manifest.json` намеренно НЕ доступен как статический файл: доступ только через `/api/contours/manifest`.
* Если на backend меняются URL-пути, нужно синхронизировать:

  * `frontend/config.js`
  * `backend routes`
  * `nginx locations`
