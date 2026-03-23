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
        const changedObjects = Array.isArray(ctx.changedObjects) ? ctx.changedObjects : [];
        if (ctx.followersHandled !== true) {
            const followers = collectFollowers(changedObjects, ctx, app);
            applyFollowerUpdates(followers, action, payload, ctx, app);
        }

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
        move: async (ctx) => {
            const { app, canvas } = ctx;
            const active = canvas?.getActiveObject?.();
            const selected = app.resolveActionTargets(active, 'move');
            const deltaX = Number(ctx.deltaX) || 0;
            const deltaY = Number(ctx.deltaY) || 0;
            if (!selected.length || (!deltaX && !deltaY)) {
                ctx.skipAutosave = true;
                return null;
            }

            const savedSelection = active?.type === 'activeSelection'
                ? (app.temporarilyUngroupActiveSelection?.() || { objects: null })
                : { objects: null };
            const changedObjects = applyAction(ctx, selected, (obj) => {
                applyDeltaToObject(obj, deltaX, deltaY);
            });

            if (active?.type === 'activeSelection') {
                app.restoreActiveSelection(changedObjects.length ? selected : (savedSelection.objects || selected));
            } else if (changedObjects.length === 1) {
                canvas?.setActiveObject?.(changedObjects[0]);
                changedObjects[0].setCoords?.();
            }

            return { changedObjects, deltaX, deltaY };
        },
        rotate: async (ctx) => {
            const { app, canvas } = ctx;
            const active = canvas?.getActiveObject?.();
            const selected = app.resolveActionTargets(active, 'rotate');
            if (!selected.length) {
                ctx.skipAutosave = true;
                return null;
            }

            const originalSelection = active?.type === 'activeSelection'
                ? active.getObjects().filter(Boolean)
                : selected.slice();
            const savedSelection = active?.type === 'activeSelection'
                ? (app.temporarilyUngroupActiveSelection?.() || { objects: null })
                : { objects: null };
            const pivot = getObjectsBoundingCenter(selected);
            const deltaAngle = 90;

            const changedObjects = applyAction(ctx, selected, (obj) => {
                const center = obj.getCenterPoint();
                const rotatedCenter = rotatePointAroundPivot(center, pivot, deltaAngle);
                const nextAngle = normalizeAngle((obj.angle || 0) + deltaAngle);

                obj.set({
                    left: rotatedCenter.x,
                    top: rotatedCenter.y,
                    angle: nextAngle
                });
                app.contourManager.snapToAllowedAngle?.(obj);
            });

            if (active?.type === 'activeSelection') {
                const selectionToRestore = originalSelection.length
                    ? originalSelection
                    : (savedSelection.objects || selected);
                app.restoreActiveSelection(selectionToRestore, { source: 'programmatic' });
            } else if (changedObjects.length === 1) {
                canvas?.setActiveObject?.(changedObjects[0]);
                changedObjects[0].setCoords?.();
            }

            return { changedObjects, pivot, deltaAngle };
        },
        duplicate: async (ctx) => {
            const DUPLICATE_OFFSET = 16;
            const { app, canvas } = ctx;
            const objectMetaApi = app?.objectMetaApi || global.ObjectMeta;
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
                        objectMetaApi?.copyObjectMeta?.(obj, copy);
                        objectMetaApi?.patchObjectMeta?.(copy, { groupId: null });
                        objectMetaApi?.applyInteractionState?.(copy);
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
                        objectMetaApi?.copyObjectMeta?.(obj, copy);
                        objectMetaApi?.patchObjectMeta?.(copy, { groupId: null });
                        objectMetaApi?.applyInteractionState?.(copy);
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
                    objectMetaApi?.copyObjectMeta?.(obj, duplicatedContour);
                    objectMetaApi?.patchObjectMeta?.(duplicatedContour, {
                        placementId: duplicatedContour.placementId,
                        groupId: null
                    });
                    objectMetaApi?.applyInteractionState?.(duplicatedContour);
                    duplicatedContour.set({ angle: obj.angle || 0 });
                    duplicatedContour.setCoords();
                    newObjects.push(duplicatedContour);

                    const sourceTexts = app.textManager.getAttachedTextsByPlacementId?.(obj.placementId) || [];
                    sourceTexts.forEach(sourceText => {
                        const duplicatedText = app.textManager.createAttachedText(duplicatedContour, {
                            text: sourceText.text || '',
                            role: sourceText.role || 'user-text',
                            fontSizeMm: sourceText.fontSizeMm || sourceText.fontSize,
                            localOffsetX: sourceText.localOffsetX,
                            localOffsetY: sourceText.localOffsetY,
                            localAngle: sourceText.localAngle
                        });

                        if (!duplicatedText) {
                            return;
                        }

                        objectMetaApi?.copyObjectMeta?.(sourceText, duplicatedText);
                        objectMetaApi?.patchObjectMeta?.(duplicatedText, {
                            followMode: 'followBoundObject',
                            boundToId: duplicatedText.ownerPlacementId,
                            groupId: null
                        });
                        objectMetaApi?.applyInteractionState?.(duplicatedText);
                        duplicatedText.setCoords();
                    });
                }
            });

            app.restoreActiveSelection(newObjects);
            return newObjects;
        },
        group: async (ctx) => {
            const { app } = ctx;
            const objectMetaApi = app?.objectMetaApi || global.ObjectMeta;
            const selectedObjects = app.getSelectionObjects?.() || [];
            const groupableObjects = app.getGroupSelectionObjects?.() || [];
            if (selectedObjects.length < 2 || groupableObjects.length !== selectedObjects.length || !objectMetaApi?.patchObjectMeta) {
                ctx.skipAutosave = true;
                return false;
            }

            const nextGroupId = app.generateSoftGroupId?.();
            if (!nextGroupId) {
                ctx.skipAutosave = true;
                return false;
            }

            groupableObjects.forEach(obj => {
                objectMetaApi.patchObjectMeta(obj, { groupId: nextGroupId });
                obj.setCoords?.();
            });

            ctx.changedObjects = groupableObjects;
            app.restoreActiveSelection(groupableObjects, { source: 'programmatic' });
            return true;
        },
        ungroup: async (ctx) => {
            const { app, canvas } = ctx;
            const objectMetaApi = app?.objectMetaApi || global.ObjectMeta;
            const selectedObjects = app.getUngroupSelectionObjects?.() || [];
            if (!selectedObjects.length || !objectMetaApi?.patchObjectMeta) {
                ctx.skipAutosave = true;
                return false;
            }

            const targetGroupIds = Array.from(new Set(selectedObjects
                .map(obj => objectMetaApi?.getGroupId?.(obj))
                .filter(Boolean)));
            const changedObjects = [];

            targetGroupIds.forEach(groupId => {
                app.getSoftGroupMembers?.(groupId)?.forEach(member => {
                    objectMetaApi.patchObjectMeta(member, { groupId: null });
                    member.setCoords?.();
                    changedObjects.push(member);
                });
            });

            const activeSelection = changedObjects.length > 1 ? changedObjects : selectedObjects.filter(Boolean);
            if (activeSelection.length > 0) {
                app.restoreActiveSelection(activeSelection, { source: 'programmatic' });
            } else {
                canvas?.discardActiveObject?.();
            }

            ctx.changedObjects = changedObjects;
            return true;
        },
        toggleLock: async (ctx) => {
            const { app, canvas } = ctx;
            const objectMetaApi = app?.objectMetaApi || global.ObjectMeta;
            const active = canvas?.getActiveObject?.();
            const selected = app.resolveActionTargets(active, 'toggleLock');
            if (!selected.length || !objectMetaApi?.patchObjectMeta) {
                ctx.skipAutosave = true;
                return null;
            }

            const lockState = app.getSelectionLockState(active);
            const nextLocked = !lockState.allLocked;
            const changedObjects = [];

            selected.forEach(obj => {
                objectMetaApi.patchObjectMeta(obj, { isLocked: nextLocked });
                objectMetaApi.applyInteractionState?.(obj);
                app.applyObjectVisualState?.(obj);
                obj.setCoords?.();
                changedObjects.push(obj);
            });

            ctx.changedObjects = changedObjects;
            if (active?.type === 'activeSelection') {
                app.syncSelectionVisualState?.(active);
                app.syncActiveSelectionInteractionState?.(active);
            }
            return {
                changedObjects,
                isLocked: nextLocked
            };
        },
        align: async (ctx) => {
            const { app, canvas, mode } = ctx;
            const active = canvas?.getActiveObject?.();
            const selected = app.resolveActionTargets(active, 'align');
            if (selected.length < 2) {
                ctx.skipAutosave = true;
                return null;
            }

            const savedSelection = app.temporarilyUngroupActiveSelection?.() || { objects: null };
            const boxes = selected.map(obj => ({ obj, bbox: obj.getBoundingRect(true) }));
            const minLeft = Math.min(...boxes.map(item => item.bbox.left));
            const maxRight = Math.max(...boxes.map(item => item.bbox.left + item.bbox.width));
            const minTop = Math.min(...boxes.map(item => item.bbox.top));
            const maxBottom = Math.max(...boxes.map(item => item.bbox.top + item.bbox.height));
            const centerX = minLeft + ((maxRight - minLeft) / 2);
            const centerY = minTop + ((maxBottom - minTop) / 2);

            const changedObjects = applyAction(ctx, selected, (obj) => {
                const item = boxes.find(candidate => candidate.obj === obj);
                if (!item) {
                    return;
                }

                let targetLeft = item.bbox.left;
                let targetTop = item.bbox.top;

                if (mode === 'left') targetLeft = minLeft;
                if (mode === 'center-x') targetLeft = centerX - (item.bbox.width / 2);
                if (mode === 'right') targetLeft = maxRight - item.bbox.width;
                if (mode === 'top') targetTop = minTop;
                if (mode === 'center-y') targetTop = centerY - (item.bbox.height / 2);
                if (mode === 'bottom') targetTop = maxBottom - item.bbox.height;

                const deltaX = targetLeft - item.bbox.left;
                const deltaY = targetTop - item.bbox.top;
                applyDeltaToObject(obj, deltaX, deltaY);
            });

            app.restoreActiveSelection(changedObjects.length ? selected : (savedSelection.objects || selected));
            return { changedObjects, mode };
        },
        distribute: async (ctx) => {
            const { app, canvas, mode } = ctx;
            const active = canvas?.getActiveObject?.();
            const selected = app.resolveActionTargets(active, 'distribute');
            if (selected.length < 3) {
                ctx.skipAutosave = true;
                return null;
            }

            const savedSelection = app.temporarilyUngroupActiveSelection?.() || { objects: null };
            const axis = mode === 'horizontal-gaps' ? 'x' : 'y';
            const boxes = selected.map(obj => ({ obj, bbox: obj.getBoundingRect(true) }));
            const sorted = boxes.sort((a, b) => axis === 'x' ? a.bbox.left - b.bbox.left : a.bbox.top - b.bbox.top);
            const targets = [];

            if (axis === 'x') {
                const totalWidth = sorted.reduce((sum, item) => sum + item.bbox.width, 0);
                const span = (sorted[sorted.length - 1].bbox.left + sorted[sorted.length - 1].bbox.width) - sorted[0].bbox.left;
                const gap = (span - totalWidth) / (sorted.length - 1);
                let cursor = sorted[0].bbox.left + sorted[0].bbox.width + gap;

                for (let i = 1; i < sorted.length - 1; i += 1) {
                    targets.push({ obj: sorted[i].obj, deltaX: cursor - sorted[i].bbox.left, deltaY: 0 });
                    cursor += sorted[i].bbox.width + gap;
                }
            } else {
                const totalHeight = sorted.reduce((sum, item) => sum + item.bbox.height, 0);
                const span = (sorted[sorted.length - 1].bbox.top + sorted[sorted.length - 1].bbox.height) - sorted[0].bbox.top;
                const gap = (span - totalHeight) / (sorted.length - 1);
                let cursor = sorted[0].bbox.top + sorted[0].bbox.height + gap;

                for (let i = 1; i < sorted.length - 1; i += 1) {
                    targets.push({ obj: sorted[i].obj, deltaX: 0, deltaY: cursor - sorted[i].bbox.top });
                    cursor += sorted[i].bbox.height + gap;
                }
            }

            const changedObjects = applyAction(ctx, targets.map(item => item.obj), (obj) => {
                const target = targets.find(candidate => candidate.obj === obj);
                if (!target) {
                    return;
                }
                applyDeltaToObject(obj, target.deltaX, target.deltaY);
            });

            app.restoreActiveSelection(changedObjects.length ? selected : (savedSelection.objects || selected));
            return { changedObjects, mode };
        },
        snap: async (ctx) => {
            const { app, canvas, side } = ctx;
            const active = canvas?.getActiveObject?.();
            const selected = app.resolveActionTargets(active, 'snap');
            if (!selected.length) {
                ctx.skipAutosave = true;
                return null;
            }

            const savedSelection = app.temporarilyUngroupActiveSelection?.() || { objects: null };
            const targetArea = (app.safeArea || app.layment)?.getBoundingRect?.(true);
            if (!targetArea) {
                app.restoreActiveSelection(savedSelection.objects || selected);
                ctx.skipAutosave = true;
                return null;
            }

            const clearancePx = 3;
            const boxes = selected.map(obj => ({ obj, bbox: obj.getBoundingRect(true) }));
            const changedObjects = applyAction(ctx, selected, (obj) => {
                const item = boxes.find(candidate => candidate.obj === obj);
                if (!item) {
                    return;
                }

                let deltaX = 0;
                let deltaY = 0;

                if (side === 'left') {
                    const targetLeft = targetArea.left + clearancePx;
                    deltaX = targetLeft - item.bbox.left;
                } else if (side === 'right') {
                    const targetLeft = targetArea.left + targetArea.width - clearancePx - item.bbox.width;
                    deltaX = targetLeft - item.bbox.left;
                } else if (side === 'top') {
                    const targetTop = targetArea.top + clearancePx;
                    deltaY = targetTop - item.bbox.top;
                } else if (side === 'bottom') {
                    const targetTop = targetArea.top + targetArea.height - clearancePx - item.bbox.height;
                    deltaY = targetTop - item.bbox.top;
                }

                applyDeltaToObject(obj, deltaX, deltaY);
            });

            app.restoreActiveSelection(changedObjects.length ? selected : (savedSelection.objects || selected));
            return { changedObjects, side };
        },
        textPropertyUpdate: async (ctx) => {
            const { app, property, value } = ctx;
            const textObj = app.getEditingTextObject?.();
            if (!textObj?.isTextObject) {
                ctx.skipAutosave = true;
                return false;
            }

            if (property === 'text') {
                const nextText = typeof value === 'string' ? value : '';
                if ((textObj.text ?? '') === nextText) {
                    ctx.skipAutosave = true;
                    return false;
                }
                textObj.set({ text: nextText });
                textObj.dirty = true;
            } else if (property === 'fontSize') {
                const fontSize = Number(value);
                if (!Number.isFinite(fontSize) || fontSize <= 0) {
                    ctx.skipAutosave = true;
                    return false;
                }
                if ((Number(textObj.fontSize) || 0) === fontSize) {
                    ctx.skipAutosave = true;
                    return false;
                }
                textObj.set({ fontSize });
                textObj.fontSizeMm = fontSize;
            } else if (property === 'angle') {
                const angle = Number(value);
                if (!Number.isFinite(angle)) {
                    ctx.skipAutosave = true;
                    return false;
                }
                if ((Number(textObj.angle) || 0) === angle) {
                    ctx.skipAutosave = true;
                    return false;
                }
                textObj.set({ angle });
            } else {
                ctx.skipAutosave = true;
                return false;
            }

            app.syncObjectTextState?.(textObj);
            textObj.setCoords?.();
            ctx.changedObjects = [textObj];
            return true;
        },
        textAttach: async (ctx) => {
            const { app } = ctx;
            const textObj = ctx.textObj || app.getEditingTextObject?.();
            const contour = ctx.contour || app.getSelectedContourForText?.();
            if (!textObj?.isTextObject || !contour?.placementId || textObj.kind !== 'free') {
                ctx.skipAutosave = true;
                return false;
            }

            app.textManager.attachTextToContour(textObj, contour, ctx.role || 'user-text');
            app.syncObjectTextState?.(textObj);
            textObj.setCoords?.();
            ctx.changedObjects = [textObj];
            return true;
        },
        textDetach: async (ctx) => {
            const { app } = ctx;
            const textObj = ctx.textObj || app.getEditingTextObject?.();
            if (!textObj?.isTextObject || textObj.kind !== 'attached') {
                ctx.skipAutosave = true;
                return false;
            }

            app.textManager.detachText(textObj);
            app.syncObjectTextState?.(textObj);
            textObj.setCoords?.();
            ctx.changedObjects = [textObj];
            return true;
        },
        primitiveDimensionUpdate: async (ctx) => {
            const { app, dimensions } = ctx;
            const primitive = ctx.primitive || app.getSingleSelectedPrimitive?.();
            if (!primitive?.primitiveType) {
                ctx.skipAutosave = true;
                return false;
            }

            const prevDimensions = app.primitiveManager.getPrimitiveDimensions?.(primitive);
            const applied = app.primitiveManager.applyDimensions?.(primitive, dimensions || {});
            if (!applied) {
                ctx.skipAutosave = true;
                return false;
            }

            const nextDimensions = app.primitiveManager.getPrimitiveDimensions?.(primitive);
            const changed = JSON.stringify(prevDimensions) !== JSON.stringify(nextDimensions);
            if (!changed) {
                ctx.skipAutosave = true;
                return false;
            }

            primitive.setCoords?.();
            ctx.changedObjects = [primitive];
            return true;
        }
    };

    function applyDeltaToObject(obj, deltaX, deltaY) {
        if (!obj) {
            return;
        }

        obj.set({
            left: obj.left + deltaX,
            top: obj.top + deltaY
        });
    }

    function normalizeAngle(angle) {
        const normalized = angle % 360;
        return normalized < 0 ? normalized + 360 : normalized;
    }

    function rotatePointAroundPivot(point, pivot, angleDeg) {
        const angleRad = fabric.util.degreesToRadians(angleDeg || 0);
        const dx = (point?.x || 0) - (pivot?.x || 0);
        const dy = (point?.y || 0) - (pivot?.y || 0);

        return {
            x: (pivot?.x || 0) + (dx * Math.cos(angleRad)) - (dy * Math.sin(angleRad)),
            y: (pivot?.y || 0) + (dx * Math.sin(angleRad)) + (dy * Math.cos(angleRad))
        };
    }

    function getObjectsBoundingCenter(objects) {
        const points = (Array.isArray(objects) ? objects : [])
            .flatMap(obj => Object.values(obj?.aCoords || {}).filter(Boolean));

        if (!points.length) {
            return { x: 0, y: 0 };
        }

        const bbox = fabric.util.makeBoundingBoxFromPoints(points);
        return {
            x: bbox.left + (bbox.width / 2),
            y: bbox.top + (bbox.height / 2)
        };
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

        const followers = collectFollowers(updated, ctx, ctx?.app);
        applyFollowerUpdates(followers, ctx?.actionName, {}, ctx, ctx?.app);
        ctx.followersHandled = true;
        ctx.changedObjects = updated;
        return updated;
    }

    function collectFollowers(changedObjects, ctx, appArg) {
        const app = appArg || ctx?.app;
        const policy = ctx?.policy || app?.interactionPolicy || global.InteractionPolicy;
        const owners = changedObjects;
        const ownerList = Array.isArray(owners) ? owners : (owners ? [owners] : []);
        const followers = [];

        if (!app?.textManager || !policy?.shouldFollowOwnerMove) {
            return followers;
        }

        ownerList.forEach(owner => {
            if (!owner?.placementId) {
                return;
            }
            const attachedTexts = app.textManager.getAttachedTextsByPlacementId?.(owner.placementId) || [];
            attachedTexts.forEach(textObj => {
                if (policy.shouldFollowOwnerMove(ctx, textObj, owner)) {
                    followers.push({ owner, follower: textObj });
                }
            });
        });

        return followers;
    }

    function applyFollowerUpdates(followerPairs, action, payload, ctx, appArg) {
        const app = appArg || ctx?.app;
        if (!app?.textManager) {
            return [];
        }

        const list = Array.isArray(followerPairs) ? followerPairs : [];
        const updated = [];
        const syncedOwners = new Set();

        list.forEach(pair => {
            const follower = pair?.follower;
            const owner = pair?.owner;
            if (!follower || !owner || !follower.isTextObject || follower.kind !== 'attached') {
                return;
            }

            const ownerKey = Number.isFinite(owner.placementId) ? owner.placementId : owner;
            if (!syncedOwners.has(ownerKey)) {
                app.textManager.syncAttachedTextsForContour(owner);
                syncedOwners.add(ownerKey);
            }
            app.textManager.clampTextToContourBounds(follower);
            app.textManager.updateAttachedTextAnchorFromAbsolute(follower);
            follower.setCoords?.();
            updated.push(follower);
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
