(function initAppBootstrap(global) {
    async function bootstrapDesignerApp() {
        const editorFacade = global.EditorFacade;
        const uiDom = global.UIDom;
        const feedback = global.DesignerUiFeedback.create(uiDom);
        const workspaceShell = global.DesignerWorkspaceShell.create({ editorFacade });
        const statusBarRefreshEventName = global.DesignerControlsShell?.STATUS_BAR_REFRESH_EVENT || 'designer:status-bar-refresh';

        await editorFacade.initEditor({
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
