# Frontend Target Architecture

## Status
Active target-state document (validated against runtime as of March 2026).

## Purpose

Документ фиксирует **целевое направление** frontend-архитектуры.
Он не должен противоречить текущему коду, но и не обязан описывать только то, что уже сделано.

---

## Current baseline (already implemented)

В кодовой базе уже присутствуют ключевые элементы target-направления:

- semantic metadata слой: `objectMeta`;
- policy слой: `interactionPolicy`;
- unified executor: `actionExecutor`;
- pointer/selection boundary: `selectionPointerController`;
- command/query boundary: `editorFacade`;
- shell composition: `shell/appBootstrap` + `catalog/controls/orderFlow` shell modules.

Это означает, что переход от «монолитного app.js-only orchestration» к слоистой модели **уже начат и частично реализован**.

---

## Target layer model

### 1) Canvas Adapter / Fabric Runtime

Отвечает за:
- Fabric canvas lifecycle;
- viewport/pan/zoom;
- low-level pointer integration;
- runtime object mechanics и ActiveSelection behavior.

Не должен владеть:
- catalog/order UI flow;
- transport/business/export policy decisions;
- semantic rules уровня editor core.

### 2) Editor Core

Отвечает за:
- semantic object state;
- interaction policy;
- unified action execution;
- text/selection/group/lock semantics;
- workspace/export builders и их boundary.

Editor Core должен оставаться DOM-agnostic.

### 3) App Shell / Integration Layer

Отвечает за:
- DOM wiring;
- panel/modal/toolbars;
- API orchestration;
- embedding boundary для внешних storefront/shell.

Shell не должен:
- напрямую мутировать Fabric objects;
- дублировать policy rules;
- создавать bypass-path мимо editor commands.

---

## Command/query boundary (target + current direction)

Внешняя интеграция должна идти через high-level boundary:

- commands (`addContour`, `moveSelection`, `groupSelection`, `submitOrder`, ...);
- queries (`selection`, `document`, `workspace`, `export`, ...);
- optional high-level callbacks/events.

`editorFacade` уже реализует этот паттерн и является текущей опорной boundary-точкой.

---

## Source-of-truth model

### Semantic truth

Живёт в metadata/policy/editor-core state.

### Mechanical truth

Живёт в Fabric runtime projection (selection wrappers, lock flags, visual controls).

### Export truth

Строится из explicit semantic state и явных export rules.
Editor-only state не должен попадать в export случайно.

---

## Architectural invariants

1. UI shell не мутирует canvas-объекты напрямую как основной способ изменений.
2. Eligibility/interaction rules живут в policy, а не в нескольких местах.
3. Multi-object mutations идут через unified executor path.
4. Workspace и export разделяются явно.
5. `1 px == 1 mm`, `performWithScaleOne()`, `obj.aCoords.tl` (для contour export) остаются жёсткими инвариантами.

---

## Known gap between current and target state

На текущем этапе:

- `app.js` всё ещё крупный orchestration hub;
- часть UI-sync и точечных mutation paths остаётся в `app.js`;
- не все команды полностью нормализованы в единый command-handler слой.

Это трактуется как **осознанный архитектурный долг**, а не как повод возвращаться к ad-hoc путям.
