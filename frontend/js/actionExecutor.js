// actionExecutor.js
// Лёгкий исполнитель canvas-действий с финализацией в одном месте.

(function initActionExecutorModule(global) {
    function buildActionContext(app, actionName, extras = {}) {
        return {
            app,
            actionName,
            canvas: app?.canvas || null,
            policy: app?.interactionPolicy || global.InteractionPolicy || null,
            ...extras
        };
    }

    async function executeAction(ctx, performer) {
        if (!ctx || typeof performer !== 'function') {
            return null;
        }

        const result = await performer(ctx);
        finalizeCanvasAction(ctx);
        return result;
    }

    function applyAction(ctx, targets, updater) {
        if (typeof updater !== 'function') {
            return [];
        }

        const list = Array.isArray(targets) ? targets : (targets ? [targets] : []);
        const updated = [];

        for (const obj of list) {
            if (!obj) {
                continue;
            }
            updater(obj, ctx);
            obj.setCoords?.();
            updated.push(obj);
        }

        return updated;
    }

    function collectFollowers(ctx, owners) {
        const app = ctx?.app;
        const policy = ctx?.policy || global.InteractionPolicy;
        const ownerList = Array.isArray(owners) ? owners : (owners ? [owners] : []);
        const followers = [];

        if (!app?.textManager || !policy?.shouldFollowOwnerMove) {
            return followers;
        }

        ownerList.forEach(owner => {
            if (!owner?.placementId) {
                return;
            }
            const text = app.textManager.getAttachedTextByPlacementId?.(owner.placementId);
            if (text && policy.shouldFollowOwnerMove(ctx, text, owner)) {
                followers.push({ owner, follower: text });
            }
        });

        return followers;
    }

    function applyFollowerUpdates(ctx, followerPairs, updater) {
        if (typeof updater !== 'function') {
            return [];
        }

        const list = Array.isArray(followerPairs) ? followerPairs : [];
        const updated = [];

        list.forEach(pair => {
            if (!pair?.follower) {
                return;
            }
            updater(pair.follower, pair.owner, ctx);
            pair.follower.setCoords?.();
            updated.push(pair.follower);
        });

        return updated;
    }

    function finalizeCanvasAction(ctx) {
        const app = ctx?.app;
        if (!app) {
            return;
        }

        app.canvas?.requestRenderAll?.();
        app.updateButtons?.();
        app.updateStatusBar?.();
        app.syncPrimitiveControlsFromSelection?.();
        app.syncTextControlsFromSelection?.();

        if (ctx.skipAutosave !== true) {
            app.scheduleWorkspaceSave?.();
        }
    }

    global.ActionExecutor = {
        buildActionContext,
        executeAction,
        applyAction,
        collectFollowers,
        applyFollowerUpdates,
        finalizeCanvasAction
    };
})(window);
