# Frontend interaction layer (current runtime state)

## Цель документа

Зафиксировать **фактическое** состояние interaction-слоя во frontend после выделения policy/executor/pointer/shell модулей.
Документ не описывает новый план рефакторинга: только то, как работает текущий runtime, где остались компромиссы и что считать архитектурным долгом.

---

## 1) Текущая модульная граница

На текущем этапе runtime разбит на следующие роли:

1. **Canvas/Fabric runtime (`app.js` + `selectionPointerController.js`)**
   - жизненный цикл canvas;
   - low-level pointer/pan/zoom;
   - selection/marquee sanitization;
   - интеграция Fabric events с UI-sync и autosave.

2. **Editor semantics (`objectMeta.js`, `interactionPolicy.js`, `actionExecutor.js`, `textManager.js`)**
   - semantic metadata объектов;
   - eligibility rules (`canMove/canRotate/...`);
   - unified execution path для batch-действий;
   - text lifecycle (free/attached/default), follower-sync, export/workspace snapshots.

3. **Integration boundary (`editorFacade.js` + shell-модули)**
   - `EditorFacade.commands/queries` как high-level command/query API;
   - `shell/appBootstrap.js` как стартовая композиция;
   - `shell/catalogShell.js`, `shell/controlsShell.js`, `shell/orderFlowShell.js` как DOM wiring поверх facade;
   - toolbar-state вычисляется в editor (`queries.controlsState()`), а применяется в `controlsShell.applyControlsState(...)`.

---

## 2) Source of truth правила

### 2.1 Semantic vs mechanical state

- Канонический semantic source-of-truth для interaction объектов: `ObjectMeta` + `InteractionPolicy`.
- Fabric flags (`selectable`, `lockMovementX`, `hasControls`, ...) — только mechanical projection semantic-state.
- Прямая правка Fabric flags из shell слоёв не допускается; projection централизуется через `applyInteractionState()`.

### 2.2 Text runtime source of truth

- Канонический runtime-источник для текста: `textManager.texts[]`.
- Canvas traversal не используется как первичный источник semantic text state.

---

## 3) Unified execution paths (что уже централизовано)

Через `ActionExecutor.executeAction(...)` в текущем runtime идут:

- `delete`;
- `move` (включая keyboard nudging);
- `rotate`;
- `duplicate`;
- `group` / `ungroup`;
- `toggleLock`;
- arrange family: `align` / `distribute` / `snap`;
- text actions: `textPropertyUpdate`, `textAttach`, `textDetach`;
- `primitiveDimensionUpdate`.

Канонический паттерн: `policy.resolveActionTargets(...) -> executor handler -> centralized finalize (render + autosave + follower sync)`.

---

## 4) Pointer/selection boundary (текущее состояние)

`selectionPointerController` является boundary-слоем между pointer-runtime и editor semantics:

- определяет selection source (`click` / `marquee` / `programmatic`);
- выполняет sanitize для marquee-selection через `canBoxSelect`;
- запрещает text (`selectionMode='clickOnly'`) оставаться в marquee multi-selection;
- обслуживает panning safety (outside-canvas mousedown, protected UI targets, blur/visibility reset);
- реализует soft-group drag sync для policy-resolved move targets.

Важно: selection semantics больше не распределены по случайным DOM handlers; pointer lifecycle собран в одном модуле.

---

## 5) Shell boundary и command/query контракт

Текущая внешняя граница frontend редактора:

- `EditorFacade.registerEditorFactory/initEditor/destroyEditor`;
- `EditorFacade.commands` для mutation paths;
- `EditorFacade.queries` для read-model paths.

Shell-модули (`catalogShell`, `controlsShell`, `orderFlowShell`) работают через facade и не должны использовать Fabric API напрямую.
Catalog-model state живёт в `catalogShell`/`catalogState` и не является частью `EditorFacade.queries.document`.
Интеграционный контракт для каталога — передача готового `item` в `EditorFacade.commands.addContour(item)`.

Практический итог текущего этапа:

- основная DOM-привязка вынесена из legacy path в shell-модули;
- `app.js` больше не мутирует toolbar DOM напрямую: editor пушит `onControlsStateChanged`, shell применяет состояние кнопок;
- однако `app.js` остаётся крупным orchestration hub и содержит часть UI-sync обязанностей (status bar, primitive controls sync, text controls sync, keyboard shortcuts, document-level listeners).

---

## 6) Workspace / export boundary

- Все проверки/снимки/экспорт строятся через `performWithScaleOne()`.
- `workspaceSnapshot` строится как отдельный state (`buildWorkspaceSnapshot`) и включается в `orderMeta.workspaceSnapshot`.
- Export и workspace разделены: editor-only данные (например, `editorState.groupId`) сохраняются только в workspace snapshot и не попадают в export DTO.
- Текущий workspace `schemaVersion` = **4**, при загрузке поддерживаются `3` и `4`.

---

## 7) Актуальные известные ограничения / риски

Это **не** план работ, а список реальных текущих компромиссов:

1. `app.js` всё ещё совмещает canvas runtime, editor orchestration и UI-sync обязанности.
   - Вне этого PR остаются отдельные UI-sync debt зоны: status bar, primitive controls, text controls.
2. Не все text-mutation paths унифицированы через executor:
   - `deleteSelectedText()` удаляет текст напрямую через `textManager.removeText(...)`.
3. Часть text create paths остаётся прямой (`createFreeText/createAttachedText`) вместо единого command-handler слоя.
4. `ContourApp` остаётся единой точкой сборки большого числа зависимостей; явного разделения на отдельные runtime adapters пока нет.

---

## 8) Что считать regression для следующих PR

1. Возврат DOM/Fabric direct mutations в shell-модули.
2. Добавление новых bypass-path мимо `interactionPolicy`/`actionExecutor` для batch-действий.
3. Дублирование eligibility-правил одновременно в policy и UI handlers.
4. Протекание editor-only state (grouping/selection helpers) в export payload.
5. Нарушение инвариантов `1 px == 1 mm`, `performWithScaleOne()`, и contour export через `obj.aCoords.tl`.
