// editorFacade.js
// Тонкий command/query facade поверх текущего runtime редактора.

(function initEditorFacade(global) {
    const state = {
        factory: null,
        app: null
    };

    function registerEditorFactory(factory) {
        state.factory = typeof factory === 'function' ? factory : null;
        return api;
    }

    function getApp(requiredMethod = null) {
        const app = state.app;
        if (!app) {
            throw new Error('Editor is not initialized. Call initEditor() first.');
        }
        if (requiredMethod && typeof app[requiredMethod] !== 'function') {
            throw new Error(`Editor method ${requiredMethod}() is not available.`);
        }
        return app;
    }

    async function initEditor(options = {}) {
        if (state.app) {
            await state.app.ready;
            return api;
        }
        if (typeof state.factory !== 'function') {
            throw new Error('Editor factory is not registered.');
        }

        state.app = state.factory(options);
        await state.app.ready;
        return api;
    }

    function destroyEditor() {
        if (!state.app) {
            return false;
        }

        state.app.destroy?.();
        state.app = null;
        return true;
    }

    const commands = {
        addContour: async (itemOrId) => (await getApp('addContourCommand').addContourCommand(itemOrId)),
        addPrimitive: (payload = {}) => getApp('addPrimitiveCommand').addPrimitiveCommand(payload),
        addText: (payload = {}) => getApp('addTextCommand').addTextCommand(payload),
        moveSelection: (payload = {}) => getApp('moveSelectionCommand').moveSelectionCommand(payload),
        rotateSelection: () => getApp('rotateSelectionCommand').rotateSelectionCommand(),
        deleteSelection: () => getApp('deleteSelectionCommand').deleteSelectionCommand(),
        duplicateSelection: async () => (await getApp('duplicateSelected').duplicateSelected(), queries.selection()),
        toggleLockSelection: () => (getApp('toggleLockSelected').toggleLockSelected(), queries.selection()),
        groupSelection: () => getApp('groupSelectionCommand').groupSelectionCommand(),
        ungroupSelection: () => getApp('ungroupSelectionCommand').ungroupSelectionCommand(),
        alignSelection: (mode) => (getApp('alignSelected').alignSelected(mode), queries.selection()),
        distributeSelection: (mode) => (getApp('distributeSelected').distributeSelected(mode), queries.selection()),
        snapSelection: (side) => (getApp('snapSelectedToSide').snapSelectedToSide(side), queries.selection()),
        buildWorkspaceSnapshot: async (options = {}) => await queries.workspace(options),
        applyLaymentPreset: (presetName) => getApp('applyLaymentPreset').applyLaymentPreset(presetName),
        updateLaymentSize: ({ width, height }) => getApp('updateLaymentSize').updateLaymentSize(width, height),
        setBaseMaterialColor: (colorKey) => getApp('setBaseMaterialColor').setBaseMaterialColor(colorKey),
        setLaymentThickness: (thicknessMm) => getApp('setLaymentThickness').setLaymentThickness(thicknessMm),
        setWorkspaceScale: (scale) => getApp('updateWorkspaceScale').updateWorkspaceScale(scale),
        updatePrimitiveDimensions: async (payload = {}) => await getApp('applyPrimitiveDimensions').applyPrimitiveDimensions(payload),
        updateTextValue: (value) => getApp('applyTextValueFromInput').applyTextValueFromInput(value),
        updateTextFontSize: (value) => getApp('applyTextFontSizeFromInput').applyTextFontSizeFromInput(value),
        updateTextAngle: (value) => getApp('applyTextAngleFromInput').applyTextAngleFromInput(value),
        addFreeText: (payload = {}) => getApp('addTextCommand').addTextCommand({ ...payload, kind: 'free', role: payload.role || 'user-text' }),
        addAttachedText: (payload = {}) => getApp('addTextCommand').addTextCommand({ ...payload, kind: 'attached', role: payload.role || 'user-text' }),
        attachSelectedText: () => getApp('attachSelectedTextToSelectionContour').attachSelectedTextToSelectionContour(),
        detachSelectedText: () => getApp('detachSelectedText').detachSelectedText(),
        deleteSelectedText: () => getApp('deleteSelectedText').deleteSelectedText(),
        validateLayout: async () => (await getApp('validateLayoutCommand').validateLayoutCommand()),
        validateForOrder: async () => (await getApp('validateForOrder').validateForOrder()),
        build3dPreviewPayload: () => getApp('build3dPreviewPayload').build3dPreviewPayload(),
        buildOrderRequest: async (customer) => await getApp('buildOrderRequest').buildOrderRequest(customer),
        loadWorkspace: async (data) => {
            await getApp('loadWorkspace').loadWorkspace(data);
            return await queries.workspace({ includeEditorState: true });
        }
    };

    const queries = {
        selection: () => getApp('getSelectionState').getSelectionState(),
        document: () => getApp('getDocumentState').getDocumentState(),
        controlsState: () => getApp('getControlsState').getControlsState(),
        primitiveInspectorState: () => getApp('getPrimitiveInspectorState').getPrimitiveInspectorState(),
        textInspectorState: () => getApp('getTextInspectorState').getTextInspectorState(),
        statusBar: () => getApp('getStatusBarState').getStatusBarState(),
        workspace: async (options = {}) => (await getApp('getWorkspaceState').getWorkspaceState(options)),
        export: async (options = {}) => (await getApp('getExportState').getExportState(options)),
        validation: async () => (await getApp('validateLayoutCommand').validateLayoutCommand()),
        orderSummary: () => getApp('buildCustomerModalSummaryData').buildCustomerModalSummaryData()
    };

    const api = {
        initEditor,
        destroyEditor,
        registerEditorFactory,
        getApp: () => state.app,
        commands,
        queries
    };

    global.EditorFacade = api;
    global.initEditor = initEditor;
    global.destroyEditor = destroyEditor;
})(window);
