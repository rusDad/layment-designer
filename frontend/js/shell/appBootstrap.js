(function initAppBootstrap(global) {
    function resolveHostBindings() {
        return {
            canvasElement: document.getElementById('workspaceCanvas'),
            canvasScrollContainer: document.querySelector('.canvas-scroll-container'),
            pointerGuards: {
                protectedUiSelector: '#customerModalOverlay, #customerModalDialog, .customer-modal-overlay, .customer-modal-dialog, input, textarea, select, button, label, a, [contenteditable]:not([contenteditable="false"])',
                editableSelector: 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
            }
        };
    }

    async function bootstrapDesignerApp() {
        const editorFacade = global.EditorFacade;
        const uiDom = global.UIDom;
        const feedback = global.DesignerUiFeedback.create(uiDom);
        const workspaceShell = global.DesignerWorkspaceShell.create({ editorFacade });
        const statusBarRefreshEventName = global.DesignerControlsShell?.STATUS_BAR_REFRESH_EVENT || 'designer:status-bar-refresh';
        const controlsStateRefreshEventName = global.DesignerControlsShell?.CONTROLS_STATE_REFRESH_EVENT || 'designer:controls-state-refresh';

        await editorFacade.initEditor({
            host: resolveHostBindings(),
            callbacks: {
                onAutosaveRequested: async ({ mode }) => {
                    try {
                        await workspaceShell.saveWorkspaceToStorage(mode || 'autosave');
                    } catch (error) {
                        console.error('Ошибка autosave workspace', error);
                    }
                },
                onStatusBarChanged: () => {
                    document.dispatchEvent(new CustomEvent(statusBarRefreshEventName));
                },
                onControlsStateChanged: payload => {
                    document.dispatchEvent(new CustomEvent(controlsStateRefreshEventName, {
                        detail: payload || {}
                    }));
                }
            }
        });

        const catalogShell = global.DesignerCatalogShell.create({ editorFacade, uiDom, feedback });
        await catalogShell.init();

        await workspaceShell.restoreAutosave();

        const controlsShell = global.DesignerControlsShell.create({ editorFacade, workspaceShell, uiDom, feedback });
        const orderFlowShell = global.DesignerOrderFlowShell.create({ editorFacade, uiDom, feedback });

        controlsShell.bind();
        orderFlowShell.bind();
        catalogShell.bind();
        await catalogShell.render();
    }

    document.addEventListener('DOMContentLoaded', () => {
        bootstrapDesignerApp().catch(error => {
            console.error('Не удалось загрузить shell конструктора', error);
        });
    });

    global.bootstrapDesignerApp = bootstrapDesignerApp;
})(window);
