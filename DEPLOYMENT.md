# DEPLOYMENT.md — Layment Designer (Prod + Dev Runbook)

Этот документ фиксирует текущую схему деплоя с двумя контурами (`prod` и `dev`) на одном сервере, с общим каталогом `domain/contours`, общим Python-окружением backend и отдельными директориями заказов.

---

## 1) Deployment Overview

На сервере одновременно развернуты два контура:

- **Production (Prod)** — основной публичный контур
- **Development (Dev)** — контур для разработки и внутренних проверок

Оба контура:

- используют **общий каталог** `domain/contours`
- используют **общее backend virtual environment**
- имеют **раздельные codebase directories**
- имеют **раздельные orders directories**
- обслуживаются **разными systemd-сервисами**
- разделяются на уровне **nginx routing**

Дополнительно на сервере поднят отдельный прототип сервиса **SVG3D**, который строит 3D-визуализацию ложемента из SVG с помощью `three.js`.

---

## 2) Directory Structure

### Production (Prod)

- **Codebase:** `/var/www/layment-designer-prod`
- **Backend Service:** `layment-backend.service`
- **Port:** `8001`
- **Public Frontend:** `/`
- **Admin Frontend:** `/admin/`
- **Orders Directory:** `/var/www/layment-designer-prod/orders`

### Development (Dev)

- **Codebase:** `/var/www/layment-designer-dev`
- **Backend Service:** `layment-backend-dev.service`
- **Port:** `8002`
- **Public Frontend:** `/dev/`
- **Admin Frontend:** `/dev/admin/`
- **Orders Directory:** `/var/www/layment-designer-dev/orders`

### Shared Resources

- **Catalog (Contoured Items):** `/var/www/layment-shared/domain/contours`
- **Virtual Environment:** `/var/www/layment-shared/venv/backend`

### Order Directories

- **Prod Orders:** `/var/www/layment-designer-prod/orders`
- **Dev Orders:** `/var/www/layment-designer-dev/orders`

---

## 3) Backend Services

Оба backend-сервиса запускаются из собственных codebase-директорий, но используют общий Python environment.

### Prod Service (`layment-backend.service`)

- **Working Directory:** `/var/www/layment-designer-prod/backend`
- **Python Environment:** `/var/www/layment-shared/venv/backend`
- **Backend Port:** `8001`

**Service Command:**

```bash
/var/www/layment-shared/venv/backend/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8001
```

### Dev Service (`layment-backend-dev.service`)

- **Working Directory:** `/var/www/layment-designer-dev/backend`
- **Python Environment:** `/var/www/layment-shared/venv/backend`
- **Backend Port:** `8002`

**Service Command:**

```bash
/var/www/layment-shared/venv/backend/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8002
```

### Useful systemd commands

#### Prod

```bash
sudo systemctl status layment-backend.service --no-pager
sudo systemctl restart layment-backend.service
sudo journalctl -u layment-backend.service -n 200 --no-pager
sudo journalctl -u layment-backend.service -f
```

#### Dev

```bash
sudo systemctl status layment-backend-dev.service --no-pager
sudo systemctl restart layment-backend-dev.service
sudo journalctl -u layment-backend-dev.service -n 200 --no-pager
sudo journalctl -u layment-backend-dev.service -f
```

---

## 4) Nginx Configuration

Основной nginx site config расположен в:

- `/etc/nginx/sites-available/layment-designer`
- symlink: `/etc/nginx/sites-enabled/layment-designer`

### Static Directories

- **Prod Frontend:** `/var/www/layment-designer-prod/frontend`
- **Dev Frontend:** `/var/www/layment-designer-dev/frontend`

### Nginx validation / reload

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Полный restart — только если действительно нужен:

```bash
sudo systemctl restart nginx
```

### Nginx Config Snippets

#### Prod API

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8001/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

#### Dev API

```nginx
location /dev/api/ {
    proxy_pass http://127.0.0.1:8002/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

#### Prod Admin

```nginx
location /admin/ {
    auth_basic "Admin area";
    auth_basic_user_file /etc/nginx/.htpasswd-layment-admin;
    root /var/www/layment-designer-prod;
    try_files $uri $uri/ /admin/index.html;
}
```

#### Dev Admin

```nginx
location /dev/admin/ {
    auth_basic "Admin area";
    auth_basic_user_file /etc/nginx/.htpasswd-layment-admin;
    alias /var/www/layment-designer-dev/admin/;
    try_files $uri $uri/ /dev/admin/index.html;
}
```

#### Contours (Shared Catalog)

```nginx
location /contours/ {
    alias /var/www/layment-shared/domain/contours/;
    try_files $uri $uri/ =404;
}
```

#### Dev Static Files

```nginx
location /dev/ {
    alias /var/www/layment-designer-dev/frontend/;
    try_files $uri $uri/ /dev/index.html;
}
```

---

## 5) SVG3D Prototype Service

На сервере также доступен отдельный сервис-прототип для 3D-визуализации ложемента из SVG при помощи `three.js`.

Этот сервис проксируется nginx на локальный порт `3000`.

### SVG3D API

```nginx
location ^~ /svg3d-api/ {
    client_max_body_size 10m;

    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

### SVG3D Frontend

```nginx
location ^~ /svg3d/ {
    proxy_pass http://127.0.0.1:3000/;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

### Notes on SVG3D routing

- Для `location ^~ /svg3d/` в `proxy_pass` используется trailing slash: `http://127.0.0.1:3000/`
- Это важно, чтобы nginx **срезал префикс** `/svg3d/` перед передачей запроса приложению
- Конфигурация рассчитана на поддержку WebSocket / upgrade-соединений
- `client_max_body_size 10m` задан для API-маршрута на случай загрузки достаточно крупных SVG

---

## 6) Deployment Process

### Steps to Deploy

1. **Setup shared catalog**  
   Убедиться, что `/var/www/layment-shared/domain/contours` содержит актуальные файлы общего каталога.

2. **Configure virtual environments**  
   Убедиться, что общий backend venv расположен в:
   `/var/www/layment-shared/venv/backend`

3. **Deploy backend services**
   - для prod: `layment-backend.service`
   - для dev: `layment-backend-dev.service`

4. **Update nginx configuration**  
   Убедиться, что маршруты `/`, `/admin/`, `/api/`, `/dev/`, `/dev/admin/`, `/dev/api/`, `/contours/`, `/svg3d/`, `/svg3d-api/` настроены корректно.

5. **Reload / restart services if needed**

```bash
sudo systemctl restart layment-backend.service
sudo systemctl restart layment-backend-dev.service
sudo nginx -t && sudo systemctl reload nginx
```

---

## 7) Verification / Smoke Checks

### Backend manifest endpoints

#### Prod

```bash
curl -sS http://127.0.0.1:8001/api/contours/manifest | head
```

#### Dev

```bash
curl -sS http://127.0.0.1:8002/api/contours/manifest | head
```

### Public nginx-routed API checks

#### Prod

```bash
curl -sS http://127.0.0.1/api/contours/manifest | head
```

#### Dev

```bash
curl -sS http://127.0.0.1/dev/api/contours/manifest | head
```

### Static routing checks

Проверить, что:

- prod frontend корректно открывается по `/`
- prod admin корректно открывается по `/admin/`
- dev frontend корректно открывается по `/dev/`
- dev admin корректно открывается по `/dev/admin/`
- shared contours доступны по `/contours/...`
- svg3d prototype доступен по `/svg3d/`

### Service checks

```bash
sudo systemctl status layment-backend.service --no-pager
sudo systemctl status layment-backend-dev.service --no-pager
```

---

## 8) Final Notes

- **Shared catalog** вынесен отдельно и используется обоими контурами через общую файловую структуру / symlink-модель.
- **Orders directories разделены**, чтобы prod и dev не конфликтовали по runtime-артефактам заказов.
- **Shared venv** упрощает обслуживание, но делает prod и dev зависимыми от одного и того же Python-окружения. Любое обновление пакетов влияет сразу на оба контура.
- **Nginx routing требует аккуратности**, потому что prod и dev живут под разными URL-prefix'ами.
- Особо хрупкое место: `root` в `/admin/` и `alias` в `/dev/admin/`. При правке nginx это легко сломать несогласованным `try_files`.
- Для `svg3d` важно не потерять trailing slash в `proxy_pass`, иначе приложение начнет получать некорректные пути.
- Если позже потребуется более жесткая изоляция, первым кандидатом на разделение должен быть **shared backend venv**, а не shared catalog.

---

## 9) Recommended Canonical Summary

Текущая схема сервера:

- **Prod backend:** `127.0.0.1:8001`
- **Dev backend:** `127.0.0.1:8002`
- **SVG3D prototype:** `127.0.0.1:3000`
- **Shared catalog:** `/var/www/layment-shared/domain/contours`
- **Shared backend venv:** `/var/www/layment-shared/venv/backend`
- **Prod codebase:** `/var/www/layment-designer-prod`
- **Dev codebase:** `/var/www/layment-designer-dev`
- **Prod public URL base:** `/`
- **Dev public URL base:** `/dev/`
- **Prod admin URL base:** `/admin/`
- **Dev admin URL base:** `/dev/admin/`
- **SVG3D URL base:** `/svg3d/`
- **SVG3D API URL base:** `/svg3d-api/`
