# Layment Designer — Architecture Overview

## Purpose

Layment Designer is a production-oriented service for generating CNC G-code
for EVA-foam tool inlays based on a user-defined layout.

The system is designed with strict separation of responsibilities:
- frontend is a visualization and data collection layer
- backend is a deterministic G-code generator
- domain is the single source of truth for tool data

---

## High-Level Architecture

Browser
  → Nginx
    → Backend (FastAPI)
      → Domain (file-based data)

---

## Domain

The `domain/` directory contains all data related to tools and contours.
It is the single source of truth and is not owned by frontend or backend code.
domain хранится файлово на VDS, может не быть в репозитории; в репо — только код

domain/contours/
├── manifest.json
├── svg/ # tool contours for frontend visualization
├── preview/ # tool previews (optional)
└── nc/ # reference CNC programs (backend only)


Rules:
- domain read-only для public runtime; изменения только через admin pipeline
- Frontend не получает manifest и метаданные из /contours/ напрямую. Manifest — только GET /api/contours/manifest
- Frontend может загружать ассеты (svg/preview) по публичным URL /contours/....
- backend reads domain files directly from filesystem

---

## Backend (FastAPI)

Responsibilities:
- reading `domain/contours/manifest.json`
- validating and processing orders
- generating CNC G-code
- exposing stable API contracts

Key endpoints:
- `GET /api/contours/manifest`
- `POST /api/export-layment`

Backend is deployed as a systemd service and is environment-agnostic.

---

## Frontend

Frontend responsibilities:
- load manifest via API
- render SVG contours
- collect layout data
- submit orders to backend

Frontend:
- does not know about CNC, G-code, or NC files
- does not access filesystem paths
- works only via HTTP API

---

## Nginx

Nginx is used as a reverse proxy and static file server.

Routing rules:
- `/` → frontend
- `/api/*` → backend (FastAPI)
- `/contours/*` → static files from `domain/contours/`

Direct access to `manifest.json` via `/contours/manifest.json` is запрещён.

---

## Design Principles

- stable identifiers over convenience
- frontend is dumb, backend is smart
- no implicit coordinate transformations
- all domain data must be FS-safe
- MVP without technical debt

---

## Smoke Test (manual)

Assumes FastAPI is running locally on `http://localhost:8001`.

1) Manifest and static SVG:

```bash
curl -s http://localhost:8001/api/contours/manifest
curl -I http://localhost:8001/contours/svg/<id>.svg
```

2) Public export:

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

3) Admin: create item + upload files + manifest assets format:

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
