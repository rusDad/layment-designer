# Text subsystem (current state after labels -> texts clean break)

## Цель документа

Зафиксировать **фактическую** реализацию text subsystem в текущем frontend/runtime и её контракт с backend.
Документ не описывает новый refactor-plan; он фиксирует, что уже работает, какие версии поддерживаются, и где остаются осознанные ограничения.

---

## 1) Каноническая runtime-модель текста

Fabric `IText` в редакторе имеет semantic-поля:

- `isTextObject: true`;
- `kind: 'attached' | 'free'`;
- `role: 'default-text' | 'user-text' | <future>`;
- `ownerPlacementId: number | null`;
- `fontSizeMm`;
- `localOffsetX/localOffsetY/localAngle` для attached;
- `excludeFromExport: true` (экспорт строится builder-слоем, не Fabric JSON export).

`textManager.texts[]` — единственный runtime source-of-truth для текстов.

---

## 2) Lifecycle

### Free text
- создаётся как независимый текст;
- не имеет owner (`ownerPlacementId = null`);
- свободно перемещается/вращается.

### Attached text
- привязан к contour placement (`ownerPlacementId`);
- хранит локальный offset/angle относительно центра owner-контура;
- при move/rotate owner-а пересчитывается через `computeAbsoluteTextPosition()`;
- ограничивается рамкой `allowedRect` вокруг owner-контура.

### Default text
- attached text с `role='default-text'`;
- создаётся через `ensureDefaultTextForContour()` при наличии `defaultLabel`.

У одного owner-контура поддерживается несколько attached-text объектов.

---

## 3) Execution path

Текущий execution path:

- batch/semantic операции (`attach`, `detach`, `textPropertyUpdate`) идут через `ActionExecutor`;
- owner-transform follower-sync выполняется централизованно (`syncAttachedTextsForContour` + shared move invariants);
- duplicate/delete contour paths работают со всем набором attached followers owner-а;
- `buildExportTexts()` сериализует только `texts[]`.

Известный точечный bypass в текущем runtime:

- `deleteSelectedText()` в `app.js` удаляет объект напрямую через `textManager.removeText(...)`, без executor.

---

## 4) Workspace snapshot и versioning

### Текущий формат

`buildWorkspaceSnapshot()` формирует:

- `schemaVersion: 4`;
- `texts[]` с полями `kind/role/ownerPlacementId/text/fontSizeMm/localOffset*/localAngle/isLocked/x/y`;
- `editorState.groupId` (editor-only), если включён `includeEditorState`.

### Поддержка загрузки

`loadWorkspaceFromStorage()` принимает `schemaVersion`:

- `3`;
- `4`.

Другие версии отклоняются.

---

## 5) Export DTO (`texts[]`)

Frontend отправляет `texts[]` в export payload c полями:

- `kind`;
- `text`;
- `x`;
- `y`;
- `angle`;
- `fontSizeMm`;
- `ownerContourId` (`String(ownerPlacementId)` для attached, иначе `null`).

Builder-layer граница остаётся в `textManager.buildExportTexts()` / `app.buildExportTexts()`.

---

## 6) Что считается удалённым legacy

В актуальном runtime не должно быть:

- `labels[]` как рабочей модели;
- label-manager runtime-path;
- export fallback по legacy `labels`-формату.

Исторические упоминания `labels` допустимы только в контексте старой документации/миграций.

---

## 7) Инварианты для следующих PR

1. `textManager.texts[]` остаётся единственным runtime source-of-truth.
2. Для attached текстов связь 1:N (один owner, много texts) не ломается.
3. Workspace/export не возвращаются к `labels[]`.
4. Любые persist/export вычисления идут при `scale=1`.
5. Editor-only state не утекает в export payload.
