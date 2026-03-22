# Frontend Target Architecture

## Status
Draft

## Purpose
This document defines the target architectural state of the frontend editor.
It is not a rewrite plan and not a demand for maximum abstraction.
Its purpose is to keep future PRs moving in one direction: isolate editor semantics from UI shell and from low-level canvas mechanics, without rebuilding the same complexity one layer higher.

---

## Why this document exists

The current frontend already has the right direction:
- object metadata as semantic layer
- interaction policy as rule layer
- action executor as unified execution path
- app layer as orchestration and wiring

But in practice, part of the behavior is still concentrated in `app.js`.
That creates several risks:
- mixed responsibilities
- inconsistent execution paths
- duplicated interaction rules
- fragile pointer/selection/text behavior
- harder future integration into external shells such as Vue/Nuxt storefront

The goal is not to isolate Fabric just for the sake of it.
The goal is to isolate **editor core**.

---

## Core principle

**Target state is not “Fabric isolated”. Target state is “Editor Core isolated”.**

A low-level canvas adapter alone is not enough.
If semantic rules are pushed out of the editor core into the surrounding shell, the system will simply recreate the same `app.js` problems at a different layer.

The correct separation is:
- low-level canvas mechanics
- editor semantic core
- app shell / integration layer

---

## Target layer model

### 1. Canvas Adapter / Fabric Runtime

Responsibility:
- Fabric canvas lifecycle
- viewport / zoom / pan
- low-level pointer integration
- creation/removal of runtime objects
- ActiveSelection and Fabric-native mechanics
- low-level projection of runtime flags and visual state
- rendering of workspace geometry on canvas

Allowed to know:
- Fabric APIs
- canvas object references
- viewport state
- rendering-specific details

Must not own:
- catalog logic
- order flow
- modal visibility
- customer journey logic
- semantic grouping rules
- export policy
- pricing or backend concerns

Important note:
This layer may emit low-level events internally, but raw Fabric events are **not** the desired public integration API.

---

### 2. Editor Core

Responsibility:
- semantic object metadata
- interaction policy
- unified action execution
- selection semantics
- group semantics
- lock semantics
- attached text semantics
- follower model
- workspace snapshot building
- export payload building
- validation orchestration
- classification of state: runtime-only / workspace / export

This is the most important layer.
It is not UI.
It is not low-level Fabric.
It contains the actual editor behavior.

Editor Core should define:
- who is the primary action target
- who is excluded
- who is follower
- how grouped behavior works
- how attached text participates in actions
- what is editor-only state
- what is persisted in workspace
- what is exported to backend

This layer should be transport-agnostic and DOM-agnostic.
It should be embeddable into a different shell as long as the same command/query contract is preserved.

---

### 3. App Shell / Integration Layer

Responsibility:
- DOM wiring
- catalog rendering
- toolbars and buttons
- panel visibility
- modal orchestration
- API requests
- 3D preview open flow
- embedding into storefront or external app shell
- UX-specific reactions to editor state

This layer is allowed to:
- subscribe to high-level editor events
- dispatch commands to editor core
- render UI based on editor state
- integrate with Nuxt/Vue, backend API, storefront flow

This layer must not:
- mutate Fabric objects directly
- duplicate interaction rules
- own selection semantics
- own grouping semantics
- own text attachment semantics
- bypass action executor

---

## Public boundary of the editor

The external boundary should be **command/query oriented**, not raw-event oriented.

### Commands
Examples:
- `initEditor(config)`
- `setLaymentSize(width, height)`
- `addContour(payload)`
- `addPrimitive(payload)`
- `addText(payload)`
- `selectByIds(ids)`
- `moveSelection(delta)`
- `rotateSelection(angle)`
- `deleteSelection()`
- `duplicateSelection()`
- `groupSelection()`
- `ungroupSelection()`
- `validateLayout()`
- `loadWorkspace(snapshot)`
- `destroyEditor()`

### Queries
Examples:
- `getSelectionState()`
- `getDocumentState()`
- `getWorkspaceSnapshot()`
- `getExportPayload()`
- `getValidationState()`
- `getViewportState()`

### High-level events
Examples:
- `selectionChanged`
- `documentChanged`
- `validationChanged`
- `viewportChanged`
- `editorReady`

### Not a public API goal
The main external API should **not** be based on raw Fabric events such as:
- `mouse:down`
- `mouse:move`
- `object:moving`
- `selection:created`

Those can exist internally, but should not become the primary boundary between layers.
Otherwise the shell will have to reconstruct semantics from low-level signals, and that recreates architectural chaos one level higher.

---

## Source of truth rules

### Semantic truth
Lives in editor metadata and editor rules.
This includes:
- role of object
- ownership/attachment
- grouping semantics
- lock semantics
- export relevance
- workspace relevance

### Mechanical truth
Lives in Fabric runtime projection.
This includes:
- transient control visibility
- runtime selection object instances
- visual flags
- viewport projection

### Text runtime truth
Text subsystem may keep dedicated runtime structures, but their semantics still belong to editor core.

### Export truth
Export payload must be derived from explicit semantic state and explicit export rules.
Editor-only state must not leak into export by accident.

---

## Architectural invariants

### 1. UI does not mutate canvas objects directly
Buttons, hotkeys, panels, modals, or external integration code must not directly patch Fabric objects as their primary mechanism.
All meaningful editor mutations should flow through editor core commands.

### 2. Interaction rules live in one place
Policy decisions such as inclusion, exclusion, followers, group participation, lock participation, attached text behavior, and selection sanitation must not be reimplemented in multiple modules.

### 3. Multi-object actions go through one execution path
Move, rotate, align, distribute, duplicate, group, ungroup, delete, and related actions should share a unified execution path instead of separate ad-hoc handlers.

### 4. Editor-only state is explicit
Anything like group markers, helper state, selection assistance, or debug-only structures must be clearly marked as editor-only and never silently flow into export.

### 5. Workspace and export are separate concepts
A thing may be:
- runtime only
- workspace persisted
- export persisted
- both workspace and export

This must be intentional for every entity type and every new feature.

### 6. Core is DOM-agnostic
Editor semantics must not depend on a specific DOM structure, CSS layout, modal implementation, or sidebar markup.

### 7. Shell is replaceable
A different outer shell should be able to drive the same editor core using the same command/query contract.
This is the real integration goal.

---

## What must stay inside Editor Core

These concerns are not “mere UI details” and should not be pushed into shell code:
- selection semantics
- group semantics
- lock semantics
- attached text semantics
- follower updates
- action eligibility rules
- workspace snapshot logic
- export payload construction
- validation orchestration

If these rules are moved outward, the shell becomes a second hidden editor engine.
That is explicitly not the target state.

---

## What should move out of `app.js`

The following responsibilities should gradually leave the monolithic orchestration layer and become either shell concerns or explicit editor-core services:
- DOM-specific wiring
- catalog rendering and catalog interactions
- modal and order UX flow
- API call orchestration not directly tied to editor semantics
- external preview open flow
- panel visibility and UI-only state

At the same time, this should **not** become a blind “split everything into files” exercise.
If logic is still semantic editor behavior, moving it out of `app.js` into the editor core is correct.
If it is merely DOM glue, moving it into shell/UI adapters is correct.

---

## Integration target for Vue / Nuxt storefront

The editor should be integrated as a specialized embedded subsystem, not rewritten as a native Vue canvas feature.

Desired model:
- storefront shell owns route, page composition, auth context, commercial UX
- editor core owns editor semantics
- backend owns production semantics and final order processing

Recommended integration style:
- explicit initialization API
- explicit commands and queries
- explicit import/export payloads
- explicit cleanup lifecycle

Anti-goal:
- dissolve editor semantics into Vue component-local state
- let Nuxt UI directly own interaction rules
- reimplement editor logic in store/actions/watchers

---

## Anti-goals

The following are not goals of this architecture:
- building a universal renderer-agnostic graphics platform
- abstracting Fabric away to the point where it is meaningless
- rewriting frontend into a framework-heavy architecture
- moving all intelligence out of frontend in the name of “frontend dumb, backend smart”
- hiding important semantic rules inside UI handlers
- replacing one god object with a distributed god object across many files

---

## Smells that indicate wrong direction

The architecture is moving in the wrong direction if:
- new feature logic is added directly into `app.js` because it is faster
- UI handler directly edits Fabric object fields instead of dispatching a command
- the same eligibility rule appears in multiple files
- attached text behavior is patched separately for drag, align, rotate, delete, and duplicate without one unified path
- shell code starts interpreting raw Fabric events to rebuild selection semantics
- workspace/export decisions are made ad hoc at call sites
- editor semantics become dependent on DOM state or CSS structure

---

## Signs that a new feature is integrated correctly

A feature is probably aligned with target state if it can be described in this format:
- what semantic state it introduces
- who is primary target
- who is excluded
- who is follower
- which policy rule decides participation
- which executor path applies the action
- what belongs to runtime only
- what belongs to workspace
- what belongs to export
- which high-level events it emits outward

If a feature cannot be described this way, it is likely being implemented through ad-hoc local behavior.

---

## Migration principle

Move toward this target state incrementally.
Do not rewrite the editor around an imagined perfect abstraction.
Each PR should reduce one class of ambiguity:
- fewer duplicated rules
- fewer direct object mutations from shell
- fewer hidden responsibilities in `app.js`
- clearer command/query surface
- clearer workspace/export boundaries

The point is not maximal purity.
The point is lower future maintenance cost and easier safe integration.

---

## One-sentence summary

**Target frontend architecture = Canvas Adapter + Editor Core + App Shell, where Editor Core is the isolated unit, exposed through command/query boundaries, while UI and integration code do not own editor semantics and do not mutate Fabric objects directly.**

