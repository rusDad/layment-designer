(function initWorkspaceShell(global) {
    const WORKSPACE_STORAGE_KEY = 'laymentDesigner.workspace.v2';
    const WORKSPACE_MANUAL_KEY = 'laymentDesigner.workspace.v2.manual';
    const WORKSPACE_FILE_NAME = 'layment-workspace.json';
    const SUPPORTED_SCHEMA_VERSIONS = new Set([3, 4]);

    function resolveStorageKey(mode = 'autosave') {
        return mode === 'manual' ? WORKSPACE_MANUAL_KEY : WORKSPACE_STORAGE_KEY;
    }

    function parseWorkspaceSnapshot(raw) {
        const snapshot = JSON.parse(raw);
        if (!snapshot || typeof snapshot !== 'object') {
            throw new Error('Workspace payload must be an object');
        }
        if (!SUPPORTED_SCHEMA_VERSIONS.has(snapshot.schemaVersion)) {
            throw new Error(`Unsupported workspace schema version: ${snapshot.schemaVersion}`);
        }
        return snapshot;
    }

    function createWorkspaceShell({ editorFacade }) {
        async function buildWorkspaceSnapshot(options = {}) {
            return await editorFacade.queries.workspace(options);
        }

        async function saveWorkspaceToStorage(mode = 'autosave') {
            const key = resolveStorageKey(mode);
            const snapshot = await buildWorkspaceSnapshot();
            localStorage.setItem(key, JSON.stringify(snapshot));
            return true;
        }

        async function loadWorkspaceFromStorage(mode = 'autosave') {
            const key = resolveStorageKey(mode);
            const raw = localStorage.getItem(key);
            if (!raw) {
                return false;
            }
            try {
                const snapshot = parseWorkspaceSnapshot(raw);
                await editorFacade.commands.loadWorkspace(snapshot);
                return true;
            } catch (error) {
                console.error('Ошибка восстановления workspace из storage', error);
                return false;
            }
        }

        async function saveWorkspaceToFile() {
            const snapshot = await buildWorkspaceSnapshot();
            const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = WORKSPACE_FILE_NAME;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            return true;
        }

        async function loadWorkspaceFromFile(file) {
            if (!file) {
                return false;
            }

            let raw = '';
            try {
                raw = await file.text();
                const snapshot = parseWorkspaceSnapshot(raw);
                await editorFacade.commands.loadWorkspace(snapshot);
                return true;
            } catch (error) {
                console.error('Ошибка восстановления workspace из файла', error);
                return false;
            }
        }

        async function restoreAutosave() {
            const restoredManual = await loadWorkspaceFromStorage('manual');
            if (restoredManual) {
                return 'manual';
            }
            const restoredAutosave = await loadWorkspaceFromStorage('autosave');
            return restoredAutosave ? 'autosave' : null;
        }

        return {
            buildWorkspaceSnapshot,
            saveWorkspaceToStorage,
            loadWorkspaceFromStorage,
            saveWorkspaceToFile,
            loadWorkspaceFromFile,
            restoreAutosave
        };
    }

    global.DesignerWorkspaceShell = { create: createWorkspaceShell };
})(window);
