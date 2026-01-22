# Backend rules

- FastAPI: разделить public и admin роутеры через include_router() с prefix:
  - public: prefix="/api"
  - admin: prefix="/admin/api"
- Вынести работу с `domain/contours` в единый модуль (например, domain_store.py).
- Не использовать относительные пути типа "./contours". Только BASE_DIR / "domain" / "contours".
- Export endpoint path: "/export-layment" (префикс добавляется при include_router).
- Модели запроса export описывать через Pydantic (OrderMeta, ContourPlacement, ExportRequest).
- Админ модуль именовать `admin_api` (не `admin`).
