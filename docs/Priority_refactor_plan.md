# Frontend architectural review — Layment Designer

## 1. Executive summary

1. **`frontend/js/app.js` уже стал фактическим coordination hub и частично god object.** Он одновременно держит canvas lifecycle, selection/pointer state machine, soft-group drag, DOM wiring, catalog UI, modal order flow, workspace persistence, export, sync sidebars и status bar. Это уже не просто orchestration, а смесь orchestration + low-level interaction + UI composition.
2. **Заявленная схема `object metadata -> interaction policy -> action executor -> app orchestration` реализована только частично.** Для keyboard/batch операций она в целом работает, но pointer drag, group/ungroup, text-form actions, primitive dimension edits и часть selection lifecycle всё ещё идут в обход executor.
3. **Самый опасный разрыв архитектуры — policy зависит от Fabric mechanical state.** `interactionPolicy.canSelect/canMove` читает `obj.selectable`, `obj.lockMovementX/Y`, а `objectMeta.applyInteractionState()` сам сохраняет часть low-level флагов обратно в metadata. В результате semantic-state и runtime projection уже начали течь друг в друга.
4. **Selection/pointer subsystem — самая хрупкая зона проекта.** Здесь много ручных флагов (`pendingSelectionSource`, `activeSelectionSource`, `selectionSanitizeInProgress`, `softGroupDragState`, `applyingSoftGroupMove`, `suppressCanvasUntilMouseUp`, `primaryPointerDown`, `pointerDownStartedInProtectedUi` и др.), а поведение размазано по global DOM listeners, canvas listeners и post-selection sanitize.
5. **Soft-group и attached-text пересекаются через отдельный drag path, а не через единый executor path.** Это рабочий компромисс, но именно он создаёт высокий риск регрессий в multi-selection и follower sync.
6. **Text subsystem в целом уже лучше и чище старой label-модели, но UI execution path у текстов всё ещё разветвлён.** Runtime source of truth (`textManager.texts[]`) соблюдается, поддержка multiple attached texts реализована, однако редактирование текста из правой панели не привязано к единому action pipeline и может действовать не только на текущий canvas selection.
7. **Есть несколько уже видимых расхождений между docs и runtime.** Самое явное — документация про `schemaVersion=3`, в то время как код сохраняет `schemaVersion: 4` и загружает обе версии. Менее явное — docs описывают metadata + policy как canonical source of truth, а фактический код всё ещё хранит значимую семантику на самих Fabric objects.
8. **DOM coupling пока управляемый, но app.js уже слишком знает о конкретной вёрстке.** `UIDom` помогает, однако app напрямую использует селекторы, строит куски DOM вручную и содержит защищённые UI-правила как knowledge о конкретной HTML-структуре.
9. **Хорошая новость: рефакторинг не требует переписывания frontend.** Базовые модули `objectMeta`, `interactionPolicy`, `actionExecutor`, `textManager`, `ui.dom` уже дают нормальный каркас. Нужна не миграция на новый стек, а выравнивание execution paths и ужесточение границ между semantic state, Fabric mechanics и app orchestration.

---

## 2. Current frontend architecture map

### `frontend/js/config.js`
**Текущая ответственность:** центральное хранилище констант UI, geometry, Fabric defaults, API URLs.

**Замечания:**
- Хорошо, что базовые инварианты и API пути централизованы.
- Есть следы legacy (`CONVERSION.SCALE_FACTOR` с TODO), которые архитектурно опасны именно из-за инварианта `1 px == 1 mm`.
- `FABRIC_CONFIG.GROUP` живёт здесь и должен применяться только из явного runtime/app setup, а не как скрытый module side effect.

### `frontend/js/objectMeta.js`
**Текущая ответственность:** унифицированный metadata layer и проекция semantic-state на Fabric flags.

**Замечания:**
- Это один из лучших модулей по форме: маленький, сфокусированный, понятный API (`init/patch/copy/apply`).
- Но граница ответственности размывалась: модуль не только хранил метаданные, но и кэшировал low-level Fabric flags обратно в metadata (`lockMovement*`, `lockRotation`, `hasControls`, `hasBorders`).
- Целевая и уже поддерживаемая граница: metadata должна оставаться semantic source of truth, а mechanical state вычисляться как runtime projection по object role.

### `frontend/js/interactionPolicy.js`
**Текущая ответственность:** centralized rules для select/move/rotate/delete/duplicate/lock/group/arrange target resolution.

**Замечания:**
- По форме модуль тоже удачный: policy действительно собрана в одном месте.
- Целевая граница: policy должна принимать решения из metadata + object semantics, а не читать Fabric mechanical flags как primary source.
- Из-за этого policy не полностью изолирована от runtime projection и может давать разные ответы в зависимости от того, кто и когда успел поменять Fabric flags.

### `frontend/js/actionExecutor.js`
**Текущая ответственность:** единый executor для batch-команд (`delete`, `move`, `rotate`, `duplicate`, `toggleLock`, `align`, `distribute`, `snap`) + follower updates + finalize path.

**Замечания:**
- Это хороший и полезный модуль, реально уменьшающий дублирование.
- Он уже стабилизирует keyboard/programmatic actions.
- Но executor пока не покрывает pointer drag, group/ungroup, text-form commands, text attach/detach, primitive property edits.
- Поэтому сейчас есть не единый action system, а “executor + несколько параллельных mutation paths”.

### `frontend/js/textManager.js`
**Текущая ответственность:** runtime source of truth для texts, attached/free lifecycle, anchor math, workspace/export builders.

**Замечания:**
- Модуль заметно чище legacy-подхода: `texts[]` как runtime source of truth, multiple attached texts, explicit `ownerPlacementId`, `localOffset*`, export/workspace builders.
- Но семантика текста всё ещё живёт прямо на Fabric object (`kind`, `role`, `ownerPlacementId`, `localOffsetX/Y`, `localAngle`, `uiId`), а не только в metadata layer.
- Панель управления текстом в app.js использует `textManager` как data-store, но сама execution logic всё равно размазана между app и manager.

### `frontend/js/contourManager.js`
**Текущая ответственность:** загрузка SVG-контуров, хранение contour metadata map, validation/export builders, primitive manager.

**Замечания:**
- `metadataMap` для contour domain-data — хороший приём и хорошо отделяет runtime object от manifest metadata.
- Экспорт contour coordinates через `obj.aCoords.tl` соблюдает инвариант.
- Но модуль одновременно содержит `PrimitiveManager`, validation/highlighting, глобальный патч `fabric.ActiveSelection.prototype.set(...)` и geometry-specific runtime hooks.
- Это не критично сейчас, но уже намекает на будущую перегрузку.

### `frontend/js/ui.dom.js`
**Текущая ответственность:** единый registry DOM references.

**Замечания:**
- Один из самых удачных модулей по поддерживаемости.
- Он реально снижает хаос direct `getElementById` по проекту.
- Но app.js всё равно частично идёт в обход (`querySelector('.canvas-scroll-container')`, `querySelectorAll('[data-hint]')`, `closest(...)` по protected UI).

### `frontend/js/app.js`
**Текущая ответственность:** фактически весь orchestration layer и значимая часть editor runtime.

**Замечания:**
- Это уже не просто app-orchestrator, а центральный stateful runtime объект.
- Внутри смешаны несколько слоёв: canvas, editor state machine, UI-controller, persistence/export flow, modal flow, catalog rendering.
- Это главный источник hidden complexity и будущих regressions.

### `frontend/index.html`
**Текущая ответственность:** статическая shell-структура UI.

**Замечания:**
- HTML остаётся простой и читаемой.
- Но app знает слишком много про конкретные ids, блоки и layout semantics, поэтому любые UI-правки быстро превращаются в cross-file change.

### `frontend/css/style.css`
**Текущая ответственность:** layout и визуальные стили.

**Замечания:**
- CSS не выглядит архитектурной проблемой сам по себе.
- Важный плюс: pointer/focus/user-select ограничения явно зафиксированы стилями, а не магией JS.
- Но часть interaction safety зависит одновременно и от CSS (`user-select`) и от JS flags, что усложняет reasoning.

### `docs/frontend-interaction-layer.md`
**Текущая ответственность:** описание целевой interaction architecture.

**Замечания:**
- Документ полезный и довольно честный.
- Он уже фиксирует правильный direction: metadata + policy как канон, executor для batch actions, grouping как editor-only state.
- Но runtime ещё не полностью соответствует этому контракту, особенно в pointer drag, text UI actions и зависимости policy от Fabric flags.

### `docs/text-subsystem-refactor.md`
**Текущая ответственность:** описание clean break от labels к texts.

**Замечания:**
- В части текстовой модели документ в целом совпадает с кодом.
- Но есть уже устаревшая часть про workspace versioning (`schemaVersion=3`), тогда как runtime сохраняет `schemaVersion=4` и принимает 3/4.

---

## 3. Problem list

### Issue 1 — `app.js` смешивает слишком много обязанностей
**Почему это риск:**
- Любой новый PR в selection/pointer/export/UI почти гарантированно трогает один и тот же файл.
- Локальные фиксы легко ломают соседние execution paths, потому что зависимости неявны.
- Когнитивная стоимость изменений уже высокая: чтобы править selection, нужно помнить про pointer safety, sanitize, sidebar sync, autosave, text followers, modal focus и т.д.

**Где именно:**
- Инициализация canvas и viewport: `initializeCanvas`, `resizeCanvasToContent`, zoom/pan (`frontend/js/app.js`).
- Soft-group и selection lifecycle: `groupSelected`, `ungroupSelected`, `handleSoftGroupObjectMoving`, `sanitizeActiveSelectionIfNeeded`, `finalizeActiveSelectionTransform`.
- DOM wiring: `bindUIButtonEvents`, `bindInputEvents`, `bindCatalogEvents`, `bindCustomerModalEvents`.
- Persistence/export/order flow: `saveWorkspace`, `loadWorkspace`, `exportData`, modal/result helpers.

**Severity:** high.

### Issue 2 — Реальная execution model не едина: executor покрывает не все mutation paths
**Почему это риск:**
- Поведение может расходиться между keyboard shortcuts, toolbar actions, mouse drag и side panel edits.
- Post-processing (`setCoords`, follower sync, autosave, selection restore, UI sync) выполняется по-разному в разных ветках.
- Следующие баги почти наверняка будут “в одном пути работает, в другом нет”.

**Где именно:**
- Через executor идут: `move`, `delete`, `rotate`, `duplicate`, `align`, `distribute`, `snap`, `toggleLock`.
- В обход executor идут: soft-group drag (`handleSoftGroupObjectMoving`, `finalizeSoftGroupMove`), `groupSelected`, `ungroupSelected`, text form edits (`applyTextValueFromInput`, `applyTextFontSizeFromInput`, `applyTextAngleFromInput`, `attachSelectedTextToSelectionContour`, `detachSelectedText`, `deleteSelectedText`), primitive dimension edits (`applyPrimitiveDimensionsFromInputs`).

**Severity:** high.

### Issue 3 — Policy layer зависит от mechanical Fabric flags
**Почему это риск:**
- Заявленная архитектура говорит, что canonical source of truth — metadata + policy, а Fabric flags — projection.
- Фактический код делает обратную зависимость: policy читает `obj.selectable` и `obj.lockMovementX/Y`.
- Это создаёт circular reasoning: policy зависит от projection, а projection зависит от metadata.

**Где именно:**
- `interactionPolicy.canSelect()` возвращает `obj.selectable !== false`.
- `interactionPolicy.canMove()` после semantic checks дополнительно смотрит на `obj.lockMovementX && obj.lockMovementY`.
- `objectMeta.applyInteractionState()` сам пишет/читает `lockMovement*`, `lockRotation`, `hasControls`, `hasBorders` в metadata.

**Severity:** high.

### Issue 4 — Metadata не стала единым semantic source of truth
**Почему это риск:**
- Семантическое состояние размазано между `__objectMeta`, ad-hoc полями Fabric object и app-local state.
- Трудно понять, где именно truth для текста, group membership, ownership и selection behavior.
- Любое новое действие может обновить только один из слоёв и оставить второй устаревшим.

**Где именно:**
- На текстах semantic fields живут прямо на объекте: `kind`, `role`, `ownerPlacementId`, `localOffsetX`, `localOffsetY`, `localAngle`, `uiId`.
- `placementId` живёт и на contour object, и в metadata.
- `TextManager.applyTextSemanticMeta()` читает `textObj.__objectMeta` напрямую, а не через API.

**Severity:** high.

### Issue 5 — Pointer/selection state machine слишком флаг-ориентирована и вручную синхронизируется
**Почему это риск:**
- Много булевых флагов, чьё корректное сочетание трудно удержать в голове.
- Ошибки здесь часто nondeterministic и тяжело воспроизводимы: “начал drag вне canvas”, “отпустил мышь над input”, “вернулся курсором в canvas”, “selected text в editing mode”, “modal открыт”.
- Такой код легко чинится локальным `if`, но каждый `if` увеличивает hidden complexity.

**Где именно:**
- Состояние в constructor: `primaryPointerDown`, `primaryDownStartedOutsideCanvas`, `pointerDownStartedInProtectedUi`, `suppressCanvasUntilMouseUp`, `pendingSelectionSource`, `activeSelectionSource`, `selectionSanitizeInProgress`, `softGroupDragState`, `applyingSoftGroupMove`, `isPanning`, `isSpacePressed`.
- Связанные потоки: `bindGlobalPointerSafety`, `bindCanvasEvents`, `resetPointerInteraction`, `sanitizeActiveSelectionIfNeeded`, `handleSelectionChanged`.

**Severity:** high.

### Issue 6 — Soft-group drag реализован отдельным ad-hoc path с ручным follower sync
**Почему это риск:**
- Pointer drag multi-selection и keyboard/programmatic move уже живут в двух разных архитектурных моделях.
- Для soft-group drag app сам двигает связанные объекты и отдельно вызывает `syncObjectTextState`.
- Это место очень чувствительно к attached text regressions и mixed selection cases.

**Где именно:**
- `bindCanvasEvents -> object:moving -> handleSoftGroupObjectMoving()`.
- `beginSoftGroupMove()` собирает `trackedObjects`, игнорируя target и членов `activeSelection`.
- `handleSoftGroupObjectMoving()` двигает `trackedObjects` напрямую через `obj.set({ left, top })`.

**Severity:** high.

### Issue 7 — Text UI может мутировать объект, который не является текущим canvas selection
**Почему это риск:**
- Редактирование текста идёт не только от active object, но и от значения select в правой панели.
- Это создаёт параллельную selection model: canvas selection и sidebar selection могут разойтись.
- Пользователь и разработчик могут ожидать изменение одного объекта, а реально изменится другой.

**Где именно:**
- `getEditingTextObject()` сначала берёт selected text, а если его нет — ищет text по `UIDom.texts.list.value`.
- `applyTextValueFromInput`, `applyTextFontSizeFromInput`, `applyTextAngleFromInput`, `deleteSelectedText`, `attachSelectedTextToSelectionContour`, `detachSelectedText` работают через этот fallback.

**Severity:** high.

### Issue 8 — Панель текста смешивает контекст выбранного контура и вообще все free texts
**Почему это риск:**
- При выборе контура пользовательский список текстов содержит attached texts этого owner плюс все free texts сразу.
- Это неожиданная hidden coupling между selection contour context и глобальным text pool.
- Чем больше free texts, тем менее предсказуемым будет editing flow.

**Где именно:**
- `syncTextControlsFromSelection()` собирает `listTexts` как `[...attachedTextsForContour, ...freeTexts]`.

**Severity:** medium.

### Issue 9 — `groupSelected` / `ungroupSelected` не проходят через общий finalize path
**Почему это риск:**
- Grouping — editor-only feature, но она всё равно меняет selection, metadata и autosave-sensitive state.
- Сейчас это отдельный поток с прямым `patchObjectMeta`, `restoreActiveSelection` и `scheduleWorkspaceSave`.
- Если позже появятся follower-правила, lock nuances или audit hooks для grouping, логика снова разойдётся.

**Где именно:**
- `groupSelected()` и `ungroupSelected()` в `frontend/js/app.js`.

**Severity:** medium.

### Issue 10 — Документация по workspace versioning уже расходится с кодом
**Почему это риск:**
- Архитектурные docs должны быть точкой синхронизации для следующих PR.
- Если docs говорят `schemaVersion=3 only`, а runtime уже живёт на `4`, следующий разработчик либо сломает загрузку, либо зацементирует неявную обратную совместимость.

**Где именно:**
- `docs/text-subsystem-refactor.md`: описан `schemaVersion=3` и “поддерживается только 3”.
- `frontend/js/app.js`: `buildWorkspaceSnapshot()` пишет `schemaVersion: 4`; `loadWorkspaceFromStorage()` принимает 3 и 4.

**Severity:** medium.

### Issue 11 — `TextManager.applyTextSemanticMeta()` использует прямой доступ к `__objectMeta`
**Почему это риск:**
- Это подрывает инкапсуляцию metadata layer.
- Если внутренняя форма хранения метаданных поменяется, text subsystem silently сломается.
- Это также показывает, что модуль сам не доверяет публичному API metadata.

**Где именно:**
- Исторически это было `const currentMeta = textObj.__objectMeta ...` внутри `applyTextSemanticMeta()`, но целевой вариант — чтение только через публичный metadata API.

**Severity:** medium.

### Issue 12 — `objectMeta.applyInteractionState()` тащит в metadata low-level свойства runtime UI
**Почему это риск:**
- Metadata начинает хранить не только semantic intent, но и текущую конфигурацию controls/borders/locks.
- Это делает state менее детерминированным: одно и то же semantic состояние может иметь разный metadata snapshot в зависимости от истории взаимодействий.
- Усложняется reasoning про restore/copy/duplicate.

**Где именно:**
- Исторически проблема была в том, что `applyInteractionState()` lazily записывал `lockMovementX`, `lockMovementY`, `lockRotation`, `lockScalingX/Y`, `hasControls`, `hasBorders` обратно в metadata; целевая модель — projection-only.

**Severity:** medium.

### Issue 13 — `ContourManager` глобально патчит `fabric.ActiveSelection.prototype`
**Почему это риск:**
- Это скрытая глобальная зависимость.
- Конфигурация selection widget становится effect-ом загрузки модуля, а не явной частью app/runtime setup.
- Любой другой код, работающий с `ActiveSelection`, уже получает этот патч implicitly.

**Где именно:**
- Исторически патч делался прямо в `ContourManager`; целевая модель — явная настройка runtime/app setup для `ActiveSelection`.

**Severity:** medium.

### Issue 14 — DOM coupling остаётся частично нецентрализованным
**Почему это риск:**
- `UIDom` есть, но не покрывает все точки доступа.
- При изменении HTML структура может сломать не только `ui.dom.js`, но и `app.js` напрямую.
- Это повышает стоимость даже простых UI-правок.

**Где именно:**
- `document.querySelector('.canvas-scroll-container')`.
- `document.querySelectorAll('[data-hint]')`.
- `isProtectedUiTarget()` и `isEditableElement()/isEditableTarget()` используют knowledge о DOM-структуре и селекторах напрямую.

**Severity:** medium.

### Issue 15 — `syncTextControlsFromSelection()` создаёт ad-hoc UI state на самих текстовых объектах
**Почему это риск:**
- `textObj.uiId` — ещё одно runtime поле вне metadata и вне text DTO.
- Это не страшно само по себе, но показатель накопления ad-hoc state на Fabric objects.
- Такие поля обычно размножаются и потом начинают участвовать в неожиданных execution paths.

**Где именно:**
- `textObj.uiId = textObj.uiId || ...` в `syncTextControlsFromSelection()`.

**Severity:** low.

### Issue 16 — Persistence/export слой содержит смешение editor-state, order-state и preview-state
**Почему это риск:**
- `workspaceSnapshot`, `layoutPng`, `layoutSvg`, `canvasPng`, customer payload и order meta собираются в одном месте одним методом.
- Это затрудняет понимание, какие поля editor-only, какие transport-only, какие production-facing.
- При следующих изменениях export легко случайно протащить editor-only данные или дублировать payload.

**Где именно:**
- `exportData()` одновременно делает validation, preview generation, DTO building, customer flow, network call, result mapping.
- `orderMeta.workspaceSnapshot` правильно строится без editorState, но само решение живёт рядом с UI/modal logic.

**Severity:** medium.

### Issue 17 — App содержит локальные type checks, дублирующие policy semantics
**Почему это риск:**
- Это размывает обещание “policy — единственное место, где решается кто участвует в действии”.
- Даже если дублирование сейчас безобидно, со временем оно почти гарантированно расходится.

**Где именно:**
- `getSelectedContourForText()` вручную исключает `activeSelection`, primitives, text, layment, safeArea.
- `getSelectedTextObject()` вручную распознаёт selected text.
- `isContourObject()` в app повторяет type semantics вне policy.

**Severity:** medium.

### Issue 18 — `performWithScaleOne()` корректный по инварианту, но boundary builder/persistence не до конца дисциплинирован
**Почему это риск:**
- Хорошо, что check/save/load/export работают через `performWithScaleOne()`.
- Но это зависит от дисциплины вызова из app.js и не enforced на уровне builder-модулей.
- Новые PR легко добавят ещё один export/persist path и забудут об этом требовании.

**Где именно:**
- `performWithScaleOne()` / `withViewportReset()` в app.js.
- Вызовы есть в check/save/load/export/open3dPreview, но не инкапсулированы ближе к builder-слою.

**Severity:** medium.

---

## 4. Самые опасные расхождения между заявленной архитектурой и фактической реализацией

### 4.1 Metadata + policy декларированы как канон, но policy всё ещё читает Fabric runtime flags
Это главный архитектурный разрыв. В документации semantic source of truth — metadata + policy, а Fabric flags — лишь projection. На практике `interactionPolicy` читает `obj.selectable` и `obj.lockMovementX/Y`, а `objectMeta.applyInteractionState()` сам тащит эти поля обратно в metadata. В результате граница “semantic vs mechanical” не удержана.

### 4.2 Executor задуман как единый action path, но pointer drag живёт в отдельной модели
Документ про interaction layer честно двигает редактор к executor-driven flow, но нативный drag multi-selection/soft-group до сих пор обрабатывается app-level canvas events + локальным sync кодом. Это значит, что move semantics уже разошлись на programmatic/keyboard и pointer paths.

### 4.3 App заявлен как orchestrator, но реально содержит и domain-ish execution logic
В app.js живут не только orchestration и wiring, но и selection sanitization, panning safety, soft-group drag choreography, text sidebar resolution, catalog rendering, modal workflow и export builder coordination. Это уже не orchestration-only слой.

### 4.4 Text clean break от legacy в целом состоялся, но text execution model не централизована
Документ про text subsystem обещает единый text-flow. Runtime действительно ушёл от `labels[]`, но текстовые действия по-прежнему исполняются разными путями: через canvas events, через textManager methods, через app sidebar handlers, через delete path executor. Data model стала чище, execution model — ещё нет.

### 4.5 Docs про workspace versioning уже устарели
Это не production bug прямо сейчас, но архитектурно вредно: текстовая документация перестала быть reliable design source.

---

## 5. Что уже сделано хорошо и стоит сохранить

1. **`ObjectMeta` / `InteractionPolicy` / `ActionExecutor` — правильный вектор.** Это именно тот уровень абстракции, который здесь нужен: без фреймворков, без overengineering, но с явной структурой.
2. **`textManager.texts[]` как runtime source of truth — хорошее решение.** Это лучше, чем ходить по canvas как по implicit базе данных.
3. **Поддержка multiple attached texts на один contour-owner уже архитектурно верная.** Это снимает старую 1:1-хрупкость.
4. **Экспорт contour coordinates через `obj.aCoords.tl` соблюдается.** Это важно и соответствует инварианту проекта.
5. **`performWithScaleOne()` уже есть и реально используется в критичных потоках.** Это хороший guardrail для workspace/export/check.
6. **`metadataMap` в contourManager — удачное отделение manifest/domain metadata от runtime Fabric object.** Это стоит сохранить.
7. **`UIDom` как единая карта DOM — удачный компромисс для plain JS.** Его нужно не выкидывать, а расширять до полного покрытия.
8. **Документация по interaction/text architecture уже достаточно зрелая, чтобы использовать её как target state.** Нужна не новая архитектура, а дотягивание runtime до уже описанного направления.

---

## 6. Priority refactor plan

### Что можно оставить как есть

1. **Plain JS + Fabric.js стек.** Здесь нет причин для framework migration.
2. **`UIDom` подход.** Это хороший lightweight pattern для текущего проекта.
3. **`textManager.texts[]` и multiple attached-text model.** Это уже рабочая и понятная основа.
4. **Executor для batch-команд.** Его не надо переписывать; его надо расширять и выравнивать по coverage.
5. **`performWithScaleOne()` и использование `aCoords.tl` в contour export/workspace.** Это must-keep.

### Что лучше поправить в ближайших PR

1. **Жёстко развести semantic metadata и Fabric mechanical projection.**
2. **Вытащить pointer/selection state machine из app.js хотя бы в отдельный внутренний helper/module без смены стека.**
3. **Убрать sidebar text editing как параллельную selection model.**
4. **Свести grouping и pointer drag к тем же пост-инвариантам, что и executor-driven actions.**
5. **Обновить docs/runtime по workspace schemaVersion до одного канона.**
6. **Убрать прямой доступ к `__objectMeta` вне metadata API.**
7. **Довести `UIDom` до полного покрытия и убрать прямые DOM селекторы из app.js там, где это легко сделать.**

### Что можно отложить

1. **Разделение catalog UI / order modal / status bar на отдельные lightweight controller-модули.** Это полезно, но не самый срочный риск по сравнению с selection/pointer.
2. **Декомпозиция `ContourManager` и `PrimitiveManager`.** Пока можно жить, если не разрастается geometry layer.
3. **Нормализация preview/order DTO builder-слоя.** Важно, но не настолько аварийно, как selection/text/policy leaks.

---

## 7. Для каждого предлагаемого изменения

### Change A — Развести semantic metadata и mechanical Fabric state
**Minimal fix:**
- В `interactionPolicy` перестать опираться на `obj.selectable` и `obj.lockMovementX/Y` как на primary source.
- В `objectMeta.applyInteractionState()` перестать lazily записывать mechanical flags обратно в metadata, оставив в metadata только semantic intent (`isLocked`, `selectionMode`, `groupId`, `followMode`, `boundToId`, `placementId`, `objectRole`).
- Все решения “можно ли двигать/выбирать/группировать” принимать из metadata + object type semantics.

**Cleaner longer-term fix:**
- Ввести чёткое разделение: `objectMeta` хранит только semantic state, `applyInteractionState()` — только projection, без обратного влияния на stored meta.
- Зафиксировать allowed semantic fields для contour / primitive / text и перестать плодить ad-hoc runtime fields.

**Риск переписывания:** medium. Нужно осторожно прогнать selection/lock/text flows, но объём локальный и хорошо тестируемый.

### Change B — Выделить pointer/selection runtime из `app.js`
**Minimal fix:**
- Вынести функции `bindGlobalPointerSafety`, `bindCanvasEvents`, `resetPointerInteraction`, `sanitizeActiveSelectionIfNeeded`, `handleSelectionChanged`, `finalizeActiveSelectionTransform`, `handleSoftGroupObjectMoving`, `begin/finalizeSoftGroupMove` в отдельный модуль вида `interactionRuntime.js`.
- Не менять архитектуру, только уменьшить размер и связность `app.js`.

**Cleaner longer-term fix:**
- Сделать маленький stateful helper “selection/pointer controller”, который владеет только interaction lifecycle и зовёт обратно app callbacks (`syncTextControls...`, `updateButtons`, `scheduleWorkspaceSave`, `resolveActionTargets`).

**Риск переписывания:** medium-high. Это зона с высокой хрупкостью; лучше выносить без изменения поведения, маленькими PR.

### Change C — Убрать параллельную sidebar text selection model
**Minimal fix:**
- Сузить `getEditingTextObject()` так, чтобы side panel редактировала только текущий selected text object либо явно programmatically selected text.
- При выборе текста из списка сначала делать его active object на canvas, а потом уже редактировать.

**Cleaner longer-term fix:**
- Ввести единое правило: text form всегда отражает current canvas selection; список текста в панели — только способ programmatic selection, а не отдельный target source.

**Риск переписывания:** medium. Возможны UX-изменения, но архитектурно это сильно уменьшит скрытую сложность.

### Change D — Нормализовать soft-group / group drag post-invariants
**Minimal fix:**
- Явно собрать общий finalize helper для group drag и executor-driven move: `setCoords + follower sync + selection restore + autosave decision + sidebar sync`.
- Не обязательно переводить native drag в executor, но обязательно уравнять финализацию и follower path.

**Cleaner longer-term fix:**
- Довести pointer-driven move до той же target resolution модели, что и executor move, с единым объектом результата и единой finalization функцией.

**Риск переписывания:** high. Это зона вероятных регрессий в multi-selection и attached text.

### Change E — Централизовать text actions хотя бы на уровне post-processing
**Minimal fix:**
- Необязательно тащить все text UI действия в executor сразу.
- Достаточно ввести единый helper для text mutation finalization: `normalize text state -> setCoords -> requestRenderAll -> syncTextControls -> scheduleWorkspaceSave`.
- Использовать его в `applyTextValueFromInput`, `applyTextFontSizeFromInput`, `applyTextAngleFromInput`, `attach/detach/delete`.

**Cleaner longer-term fix:**
- Перевести text actions на тот же command-style path, где selection resolution и post-processing централизованы.

**Риск переписывания:** low-medium. Относительно локальная зона.

### Change F — Синхронизировать docs и runtime по workspace schema/version
**Minimal fix:**
- Явно описать текущее состояние: runtime сохраняет `schemaVersion=4`, загружает 3/4.
- Либо вернуть код к 3, либо обновить docs до 4, но канон должен быть один.

**Cleaner longer-term fix:**
- Зафиксировать политику versioning: какая версия canonical, какие legacy версии читаются временно, до какого момента.

**Риск переписывания:** low.

### Change G — Убрать прямое чтение `__objectMeta`
**Minimal fix:**
- В `TextManager.applyTextSemanticMeta()` читать метаданные только через `this.app.objectMetaApi.getObjectMeta()`.

**Cleaner longer-term fix:**
- Запретить вне metadata API любые обращения к `__objectMeta` код-ревью правилом и локальным grep-чеком.

**Риск переписывания:** low.

### Change H — Дотащить `UIDom` до полного покрытия
**Minimal fix:**
- Завести в `UIDom` ссылки на `.canvas-scroll-container`, tooltip/hint targets при необходимости, возможно на root app container / modal root.
- Убрать из `app.js` хотя бы самые очевидные прямые `querySelector` / `querySelectorAll`.

**Cleaner longer-term fix:**
- Сделать `ui.dom.js` единственным модулем знания о конкретной DOM-разметке.

**Риск переписывания:** low.

---

## 8. Если ничего не менять, где вероятнее всего будут следующие баги

1. **Multi-selection + attached text + soft-group drag.** Особенно сценарии: mixed selection, drag после marquee sanitize, locked member inside selection, rotate/drag после restoreActiveSelection.
2. **Text editing через правую панель при неочевидном selection context.** Риск изменить не тот текст, особенно когда выбран contour, а в списке видны и attached, и free texts.
3. **Pointer/focus edge cases.** Сценарии: mousedown вне canvas -> mouseup над input, modal открыт/закрыт во время selection, IText editing + blur + canvas mouseenter.
4. **Lock semantics, если появятся новые действия.** Пока lock partly semantic и partly mechanical; новые команды могут начать читать “не тот” слой.
5. **Workspace restore после расширения editor-state.** Из-за hybrid state между metadata, ad-hoc object props и docs mismatch versioning.
6. **UI-рефакторинги HTML.** Даже небольшая правка DOM-структуры может сломать protected UI detection, hint wiring или canvas container sizing.
7. **Новые batch-действия, добавленные мимо executor.** Это почти гарантированно увеличит divergence между execution paths.

---

## Итог

Frontend уже имеет **неплохой архитектурный каркас**, и это важно: проект не выглядит как хаотичный legacy без опоры. Самые сильные элементы — `objectMeta`, `interactionPolicy`, `actionExecutor`, `textManager.texts[]`, `UIDom`, `performWithScaleOne()` и дисциплина вокруг `aCoords.tl` для contour export.

Главная проблема не в том, что архитектуры нет, а в том, что **она пока не дотянута до всех execution paths**. Поэтому лучший следующий шаг — не “рефакторинг ради красоты”, а **выравнивание уже существующей архитектуры**: убрать утечки между semantic и mechanical state, уменьшить ответственность `app.js`, и привести pointer/text/group flows к тем же пост-инвариантам, что уже есть у executor-driven действий.
