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

    async function executeAction(action, payload = {}, app) {
        if (!action || !app) {
            return null;
        }

        const ctx = buildActionContext(app, action, payload);
        const handler = ACTION_HANDLERS[action];
        if (typeof handler !== 'function') {
            return null;
        }

        const result = await handler(ctx);
        finalizeCanvasAction(app, {
            scheduleWorkspaceSave: ctx.skipAutosave !== true
        });
        return result;
    }

    const ACTION_HANDLERS = {
        delete: async (ctx) => {
            const { app, canvas } = ctx;
            const active = canvas?.getActiveObject?.();
            if (!active) {
                ctx.skipAutosave = true;
                return null;
            }

            const objects = app.resolveActionTargets(active, 'delete');
            await app.batchRender(async () => {
                canvas.discardActiveObject();
                for (const obj of objects) {
                    if (!obj) {
                        continue;
                    }

                    if (obj.isTextObject) {
                        app.textManager.removeText(obj);
                        continue;
                    }

                    if (obj.primitiveType) {
                        app.primitiveManager.removePrimitive(obj, false);
                        continue;
                    }

                    if (app.textManager.removeTextsForPlacementId && obj.placementId != null) {
                        app.textManager.removeTextsForPlacementId(obj.placementId);
                    }
                    app.contourManager.removeContour(obj, false);
                }
            });

            return { removedCount: objects.length };
        },
        rotate: async (ctx) => {
            const { app, canvas } = ctx;
            const active = canvas?.getActiveObject?.();
            const [obj] = app.resolveActionTargets(active, 'rotate');
            if (!obj) {
                ctx.skipAutosave = true;
                return null;
            }

            const nextAngle = (obj.angle + 90) % 360;
            app.contourManager.rotateContour(obj, nextAngle);
            return { angle: nextAngle, object: obj };
        },
        duplicate: async (ctx) => {
            const DUPLICATE_OFFSET = 16;
            const { app, canvas } = ctx;
            const selected = app.getDuplicateSelectionObjects();
            if (!selected.length) {
                ctx.skipAutosave = true;
                return [];
            }

            const newObjects = [];
            await app.batchRender(async () => {
                canvas.discardActiveObject();

                for (const obj of selected) {
                    if (obj.primitiveType === 'rect') {
                        const copy = app.primitiveManager.addPrimitive(
                            'rect',
                            { x: obj.left + DUPLICATE_OFFSET, y: obj.top + DUPLICATE_OFFSET },
                            { width: obj.width, height: obj.height },
                            { pocketDepthMm: obj.pocketDepthMm }
                        );
                        copy.set({
                            scaleX: obj.scaleX,
                            scaleY: obj.scaleY,
                            stroke: obj.stroke,
                            strokeWidth: obj.strokeWidth,
                            fill: obj.fill,
                            opacity: obj.opacity,
                            angle: obj.angle || 0
                        });
                        copy.setCoords();
                        newObjects.push(copy);
                        continue;
                    }

                    if (obj.primitiveType === 'circle') {
                        const copy = app.primitiveManager.addPrimitive(
                            'circle',
                            { x: obj.left + DUPLICATE_OFFSET, y: obj.top + DUPLICATE_OFFSET },
                            { radius: obj.radius },
                            { pocketDepthMm: obj.pocketDepthMm }
                        );
                        copy.set({
                            scaleX: obj.scaleX,
                            scaleY: obj.scaleY,
                            stroke: obj.stroke,
                            strokeWidth: obj.strokeWidth,
                            fill: obj.fill,
                            opacity: obj.opacity
                        });
                        copy.setCoords();
                        newObjects.push(copy);
                        continue;
                    }

                    const meta = app.contourManager.metadataMap.get(obj);
                    if (!meta?.assets?.svg) {
                        continue;
                    }

                    const contourCenter = obj.getCenterPoint();
                    await app.contourManager.addContour(
                        `/contours/${meta.assets.svg}`,
                        { x: contourCenter.x + DUPLICATE_OFFSET, y: contourCenter.y + DUPLICATE_OFFSET },
                        meta
                    );

                    const duplicatedContour = app.contourManager.contours[app.contourManager.contours.length - 1];
                    duplicatedContour.set({ angle: obj.angle || 0 });
                    duplicatedContour.setCoords();
                    newObjects.push(duplicatedContour);

                    const sourceLabel = app.textManager.getAttachedTextByPlacementId(obj.placementId);
                    if (!sourceLabel) {
                        continue;
                    }

                    const duplicatedLabel = app.textManager.createAttachedText(duplicatedContour, {
                        text: sourceLabel.text || '',
                        role: sourceLabel.role || 'user-text',
                        fontSizeMm: sourceLabel.fontSizeMm || sourceLabel.fontSize,
                        localOffsetX: sourceLabel.localOffsetX,
                        localOffsetY: sourceLabel.localOffsetY,
                        localAngle: sourceLabel.localAngle
                    });

                    if (duplicatedLabel) {
                        duplicatedLabel.setCoords();
                    }
                }
            });

            app.restoreActiveSelection(newObjects);
            return newObjects;
        }
    };

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

    function finalizeCanvasAction(app, options = {}) {
        if (!app) {
            return;
        }

        app.canvas?.requestRenderAll?.();
        app.updateButtons?.();
        app.updateStatusBar?.();
        app.syncPrimitiveControlsFromSelection?.();
        app.syncTextControlsFromSelection?.();

        if (options.scheduleWorkspaceSave) {
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
