# Frontend interaction layer (editor state, policy, executor)

## Цель

Зафиксировать текущую архитектурную границу interaction-слоя в frontend, чтобы инкрементально переносить действия в единый executor без изменения публичных контрактов export/workspace.

---

## 1) Source of truth для editor-interaction state

### 1.1 Канонический источник (metadata + policy)

`Source of truth` для interaction-state объекта в редакторе — это связка:

1. **Object metadata (semantic state)**
   - доменные/семантические поля объекта (`kind`, `boundToId`, `groupId`, `placementId`, lock intent и т.д.);
   - хранятся и обновляются через metadata-слой (`objectMeta` API), а не через ad-hoc поля UI.

2. **InteractionPolicy (rules/policy layer)**
   - policy отвечает на вопросы «можно ли» (`canSelect/canMove/canDelete/canRotate/...`);
   - policy определяет выбор целей для команд (`resolveActionTargets(...)`);
   - policy фиксирует семантические ограничения follow-связей (`shouldFollowOwnerMove(...)`).

3. **Fabric object flags (mechanical projection)**
   - флаги Fabric (`selectable`, `evented`, `lockMovementX/Y`, `lockRotation`, ...)
     рассматриваются как **низкоуровневая проекция** semantic-state на runtime-объект;
   - флаги не являются business-source-of-truth сами по себе.

Итого: канон — это **metadata + policy**, а Fabric flags — исполняющий механизм.

### 1.2 Runtime source of truth для текстов

Для текстовой подсистемы сохраняется действующий инвариант:

- **`textManager.texts[]` остаётся runtime source of truth для текстов**;
- обход canvas как первичный источник текста не используется.

---

## 2) Роль executor

`ActionExecutor` — единая точка исполнения canvas-команд с детерминированной пост-обработкой:

- создаёт единый `ctx` (app/canvas/policy/actionName);
- выполняет обработчик действия (`delete`, `rotate`, `duplicate`, ...);
- собирает изменённые объекты (`changedObjects`);
- применяет follower-updates (например, все attached-text follower-объекты за owner-контуром);
- централизованно делает финализацию (`render + autosave` через общий finalize-path).

### Действия, которые обязаны идти через executor

Все действия, которые:

- массово изменяют canvas-сущности;
- затрагивают связанный lifecycle (owner/follower);
- требуют единообразной финализации (`setCoords`, render, autosave);
- могут менять несколько типов сущностей (contour/primitive/text)

должны выполняться через `ActionExecutor.executeAction(...)`.

Практически это минимум для команд уровня toolbar/hotkeys/programmatic transforms: `delete`, `move` (включая keyboard nudging), `rotate`, `duplicate`, `align`, `distribute`, `snap` и любые будущие batch-действия редактора.

---

## 3) Grouping: только UI/editor feature

`Grouping` трактуется как инструмент взаимодействия в editor UI:

- нужен для удобства выделения/перемещения/выравнивания в рамках сессии редактирования;
- **не является частью бизнес-сущности workspace/export**;
- не должен влиять на доменный контракт export (backend получает контуры/примитивы/тексты, а не UI-grouping состояние).

Следствие: любые `groupId`/временные group-структуры в frontend — технические runtime-детали редактора.

---

## 4) Lock-модель (явно)

### 4.1 Lock как semantic rule в policy

Lock в целевой модели — это прежде всего semantic rule:

- policy решает, разрешено ли действие над объектом;
- lock-интенция хранится в metadata/state и проверяется на уровне policy-функций.

### 4.2 Fabric flags как low-level механизм

Дополнительный инвариант text subsystem в interaction-layer: один owner-контур может иметь несколько attached-text follower-объектов, поэтому executor и policy не должны предполагать связь 1:1 между contour и text.


Fabric lock-флаги (`lockMovementX/Y`, `lockRotation`, `lockScalingX/Y`, ...) — технический слой:

- применяются для физического ограничения интеракций в canvas;
- синхронизируются из semantic state;
- не должны становиться единственным источником правды о правилах объекта.

Итого по lock-модели: **semantic lock (policy) -> mechanical lock (Fabric flags)**.

---

## 5) Инкрементальный checklist по executor

Ниже чеклист для PR-итераций: что уже переведено и что пока оставлено осознанно.

### 5.1 Уже на executor

- [x] `delete` (с учётом разных типов объектов и очистки всех связанных attached-text).
- [x] `move` (keyboard nudging и другие programmatic translate-paths через policy-resolved target list + executor).
- [x] `rotate` (целевое действие через policy-resolved target + единая финализация).
- [x] `duplicate` (batch-дублирование с переносом metadata и follower-логики).
- [x] `arrange`-семейство: `align`, `distribute`, `snap` (через policy-resolved target list и executor).

### 5.2 Намеренно пока НЕ переведено

- [ ] Точечные текстовые команды формы/редактирования (например, edit/delete из text UI) вне batch executor.
- [ ] Локальные операции выбора/ungroup для служебных editor-потоков.

### 5.3 Критерий готовности очередного шага

Перед переносом новой команды в executor:

- [x] действие проходит через `resolveActionTargets(...)` policy-слой;
- [x] обработчик не ломает инвариант `textManager.texts[]` как runtime source of truth;
- [x] follower-updates/lock-ограничения учтены централизованно;
- [x] финализация не дублируется вне executor.


## 6) Arrange operations: policy -> executor

Arrange-операции (`align`, `distribute`, `snap`) теперь идут только через `ActionExecutor.executeAction(...)`.

Канонический поток для arrange:

1. UI в `app.js` только инициирует команду executor'у;
2. `interactionPolicy.resolveActionTargets(...)` является **единственной точкой**, которая решает, какие объекты участвуют в arrange;
3. executor при необходимости временно разбирает `activeSelection`, выполняет геометрию и затем восстанавливает selection;
4. attached-text объекты не участвуют в arrange как primary target, но все follower-тексты owner'а обновляются после перемещения owner-объекта через централизованный follower-update path.

Ограничения policy для arrange:

- `text` не участвует в `align/snap/distribute` как primary target;
- `safeArea` и `layment` не участвуют;
- semantic-locked объекты исключаются ещё на policy-слое, даже если полноценный lock UI ещё не введён.

## 7) Canvas events: low-level sync, не policy layer

Fabric canvas events (`object:moving`, `object:rotating`, `object:modified`) сохраняются как low-level hooks для:

- синхронизации attached/free text состояния;
- обновления status/UI sync;
- autosave на завершении жеста (`object:modified`).

Но эти события **не должны** принимать semantic-решения о допустимости пользовательской команды.
Любые keyboard/programmatic move/rotate действия сначала проходят через `interactionPolicy.resolveActionTargets(...)`, затем через `ActionExecutor.executeAction(...)`, и только после этого canvas events обслуживают low-level sync/render lifecycle.
