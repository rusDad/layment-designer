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

domain/contours/
├── manifest.json
├── svg/ # tool contours for frontend visualization
├── preview/ # tool previews (optional)
└── nc/ # reference CNC programs (backend only)


Rules:
- domain data is read-only at runtime
- frontend never accesses domain files directly
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
