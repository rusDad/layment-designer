(function initAppBootstrap(global) {
    async function bootstrapDesignerApp() {
        const editorFacade = global.EditorFacade;
        const uiDom = global.UIDom;
        const feedback = global.DesignerUiFeedback.create(uiDom);

        await editorFacade.initEditor();

        const controlsShell = global.DesignerControlsShell.create({ editorFacade, uiDom, feedback });
        const catalogShell = global.DesignerCatalogShell.create({ editorFacade, uiDom, feedback });
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
