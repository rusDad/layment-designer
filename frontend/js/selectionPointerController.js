// selectionPointerController.js
// Выделение runtime-state selection/pointer lifecycle из app.js без изменения editor semantics.

(function initSelectionPointerControllerModule(global) {
    const DEFAULT_PROTECTED_UI_SELECTOR = '#customerModalOverlay, #customerModalDialog, .customer-modal-overlay, .customer-modal-dialog, input, textarea, select, button, label, a, [contenteditable]:not([contenteditable="false"])';
    const DEFAULT_EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

    class SelectionPointerController {
        constructor(app, options = {}) {
            this.app = app;
            this.protectedUiSelector = typeof options.protectedUiSelector === 'string' && options.protectedUiSelector
                ? options.protectedUiSelector
                : DEFAULT_PROTECTED_UI_SELECTOR;
            this.editableSelector = typeof options.editableSelector === 'string' && options.editableSelector
                ? options.editableSelector
                : DEFAULT_EDITABLE_SELECTOR;

            this.isPanning = false;
            this.panStart = null;
            this.isSpacePressed = false;
            this.primaryPointerDown = false;
            this.primaryDownStartedOutsideCanvas = false;
            this.pointerDownStartedInProtectedUi = false;
            this.suppressCanvasUntilMouseUp = false;
            this.pendingPointerResetRenderRaf = null;
            this.pendingSelectionSource = null;
            this.activeSelectionSource = null;
            this.selectionSanitizeInProgress = false;
            this.softGroupDragState = null;
            this.pendingSoftGroupFinalizeObjects = null;
            this.applyingSoftGroupMove = false;
            this.pointerFocusDebug = global.localStorage?.getItem('laymentDesigner.debugPointerFocus') === '1';
        }

        get canvas() {
            return this.app?.canvas || null;
        }

        getActiveSelectionSource() {
            return this.activeSelectionSource;
        }

        isSelectionSanitizeInProgress() {
            return this.selectionSanitizeInProgress;
        }

        bindKeyboardEvents() {
            document.addEventListener('keydown', event => {
                if (event.code !== 'Space') {
                    return;
                }
                this.isSpacePressed = true;
            });

            document.addEventListener('keyup', event => {
                if (event.code !== 'Space') {
                    return;
                }
                this.isSpacePressed = false;
            });
        }

        isSpacePanModifier(mouseEvent) {
            return Boolean(mouseEvent?.spaceKey || this.isSpacePressed);
        }

        canStartPanning(mouseEvent) {
            if (!mouseEvent) {
                return false;
            }

            return mouseEvent.button === 1 || (mouseEvent.button === 0 && this.isSpacePanModifier(mouseEvent));
        }

        setPanCursor(isGrabbing) {
            this.app?.setPanCursor?.(isGrabbing);
        }

        stopPanning() {
            const canvas = this.canvas;
            if (!this.isPanning || !canvas) {
                return;
            }

            this.isPanning = false;
            this.panStart = null;
            canvas.selection = true;
            canvas.skipTargetFind = false;
            this.setPanCursor(false);
        }

        isInsideCanvas(target) {
            if (!this.canvas?.wrapperEl || !(target instanceof Node)) {
                return false;
            }

            return this.canvas.wrapperEl.contains(target);
        }

        resolveTargetElement(target) {
            if (!(target instanceof Node)) {
                return null;
            }
            return target instanceof Element ? target : target.parentElement;
        }

        isProtectedUiTarget(target) {
            const element = this.resolveTargetElement(target);
            if (!element) {
                return false;
            }

            return !!element.closest(this.protectedUiSelector);
        }

        isEditableElement(element) {
            if (!(element instanceof Element)) {
                return false;
            }

            return !!element.closest(this.editableSelector);
        }

        isEditableTarget(target) {
            const element = this.resolveTargetElement(target);
            return this.isEditableElement(element);
        }

        clearBrowserSelection() {
            const selection = global.getSelection?.();
            if (selection && selection.rangeCount > 0) {
                selection.removeAllRanges();
            }
        }

        logPointerFocus(eventName, target) {
            if (!this.pointerFocusDebug) {
                return;
            }

            const active = document.activeElement;
            console.debug('[pointer-focus-debug]', eventName, {
                targetTag: target instanceof Element ? target.tagName : target?.nodeName,
                activeTag: active?.tagName,
                activeId: active?.id || null,
                activeClass: active?.className || null
            });
        }

        schedulePointerResetRender() {
            const canvas = this.canvas;
            if (!canvas) {
                return;
            }

            if (this.pendingPointerResetRenderRaf !== null) {
                cancelAnimationFrame(this.pendingPointerResetRenderRaf);
                this.pendingPointerResetRenderRaf = null;
            }

            this.pendingPointerResetRenderRaf = requestAnimationFrame(() => {
                this.pendingPointerResetRenderRaf = null;
                if (this.isEditableElement(document.activeElement)) {
                    return;
                }
                canvas.requestRenderAll();
            });
        }

        finishActiveTextEditing() {
            const canvas = this.canvas;
            if (!canvas) {
                return;
            }

            const activeObject = canvas.getActiveObject();
            if (!activeObject || activeObject.type !== 'i-text' || !activeObject.isEditing) {
                return;
            }

            activeObject.exitEditing();
            activeObject.hiddenTextarea?.blur?.();
        }

        resetPointerInteraction({ soft = false } = {}) {
            const canvas = this.canvas;
            if (!canvas) {
                return;
            }

            this.stopPanning();
            this.isPanning = false;
            this.panStart = null;
            this.primaryPointerDown = false;
            this.primaryDownStartedOutsideCanvas = false;
            this.pointerDownStartedInProtectedUi = false;
            this.suppressCanvasUntilMouseUp = false;
            canvas.selection = true;
            canvas.skipTargetFind = false;
            this.setPanCursor(false);

            if (soft) {
                if (this.pendingPointerResetRenderRaf !== null) {
                    cancelAnimationFrame(this.pendingPointerResetRenderRaf);
                    this.pendingPointerResetRenderRaf = null;
                }
                return;
            }

            this.schedulePointerResetRender();
        }

        bindGlobalPointerSafety() {
            document.addEventListener('mousedown', event => {
                if (event.button !== 0) {
                    return;
                }

                this.logPointerFocus('mousedown', event.target);

                const startedInsideCanvas = this.isInsideCanvas(event.target);
                const startedInProtectedUi = !startedInsideCanvas && this.isProtectedUiTarget(event.target);

                this.primaryPointerDown = true;
                this.primaryDownStartedOutsideCanvas = !startedInsideCanvas;
                this.pointerDownStartedInProtectedUi = startedInProtectedUi;
                this.suppressCanvasUntilMouseUp = this.primaryDownStartedOutsideCanvas && !this.pointerDownStartedInProtectedUi;

                if (this.suppressCanvasUntilMouseUp && !this.pointerDownStartedInProtectedUi) {
                    this.stopPanning();
                    this.canvas?.discardActiveObject();
                    this.canvas?.requestRenderAll();
                }
            }, true);

            global.addEventListener('mouseup', event => {
                if (event.button !== 0) {
                    return;
                }

                this.logPointerFocus('mouseup', event.target);

                const endedOnEditableUi = this.isEditableTarget(event.target);
                if (!this.isInsideCanvas(event.target)) {
                    this.finishActiveTextEditing();
                }

                if (endedOnEditableUi) {
                    this.resetPointerInteraction({ soft: true });
                    return;
                }

                this.resetPointerInteraction();
            }, true);

            global.addEventListener('blur', () => {
                this.resetPointerInteraction();
            });

            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    this.resetPointerInteraction();
                }
            });

            this.canvas?.wrapperEl?.addEventListener('mouseenter', event => {
                if (!this.primaryPointerDown || !this.suppressCanvasUntilMouseUp) {
                    return;
                }

                this.stopPanning();
                this.canvas?.discardActiveObject();
                this.clearBrowserSelection();

                event.preventDefault();
                event.stopPropagation();
                this.canvas?.requestRenderAll();
            });
        }

        beginSoftGroupMove(target, selectedObjects = this.app?.resolveActionTargets?.(target, 'move')) {
            if (!target) {
                this.softGroupDragState = null;
                return null;
            }

            const moveTargets = Array.isArray(selectedObjects) ? selectedObjects.filter(Boolean) : [];
            if (!moveTargets.length) {
                this.softGroupDragState = null;
                return null;
            }

            const activeSelectionMembers = target.type === 'activeSelection'
                ? new Set(target.getObjects().filter(Boolean))
                : null;
            const trackedObjects = moveTargets
                .filter(obj => {
                    if (obj === target) {
                        return false;
                    }
                    if (activeSelectionMembers?.has(obj)) {
                        return false;
                    }
                    return true;
                })
                .map(obj => ({
                    obj,
                    left: Number(obj.left) || 0,
                    top: Number(obj.top) || 0
                }));

            this.softGroupDragState = {
                target,
                anchorLeft: Number(target.left) || 0,
                anchorTop: Number(target.top) || 0,
                trackedObjects
            };
            return this.softGroupDragState;
        }

        handleSoftGroupObjectMoving(target) {
            if (!target || this.applyingSoftGroupMove) {
                return;
            }

            const selectedObjects = this.app?.resolveActionTargets?.(target, 'move') || [];
            if (!selectedObjects.length) {
                this.softGroupDragState = null;
                return;
            }

            let dragState = this.softGroupDragState;
            if (!dragState || dragState.target !== target) {
                this.beginSoftGroupMove(target, selectedObjects);
                dragState = this.softGroupDragState;
            }
            if (!dragState || dragState.target !== target) {
                return;
            }

            const currentAnchor = {
                left: Number(target.left) || 0,
                top: Number(target.top) || 0
            };
            const deltaX = currentAnchor.left - dragState.anchorLeft;
            const deltaY = currentAnchor.top - dragState.anchorTop;
            if (!deltaX && !deltaY) {
                return;
            }

            this.applyingSoftGroupMove = true;
            try {
                dragState.trackedObjects.forEach(item => {
                    item.obj.set({
                        left: item.left + deltaX,
                        top: item.top + deltaY
                    });
                    this.app?.syncObjectTextState?.(item.obj);
                });
            } finally {
                this.applyingSoftGroupMove = false;
            }
        }

        finalizeSoftGroupMove(target) {
            const dragState = this.softGroupDragState;
            if (!dragState || dragState.target !== target) {
                const pendingObjects = Array.isArray(this.pendingSoftGroupFinalizeObjects)
                    ? this.pendingSoftGroupFinalizeObjects.filter(Boolean)
                    : [];
                this.softGroupDragState = null;
                this.pendingSoftGroupFinalizeObjects = null;
                return pendingObjects;
            }

            const trackedObjects = dragState.trackedObjects
                .map(item => item?.obj)
                .filter(Boolean);
            this.softGroupDragState = null;
            this.pendingSoftGroupFinalizeObjects = null;
            return trackedObjects;
        }

        markNextSelectionSource(source) {
            this.pendingSelectionSource = typeof source === 'string' && source ? source : null;
        }

        consumeSelectionSource(activeObject, fallback = null) {
            const pendingSource = this.pendingSelectionSource;
            this.pendingSelectionSource = null;
            if (typeof pendingSource === 'string' && pendingSource) {
                return pendingSource;
            }
            if (!activeObject) {
                return null;
            }
            if (typeof fallback === 'string' && fallback) {
                return fallback;
            }
            return activeObject.type === 'activeSelection' ? 'programmatic' : 'click';
        }

        detectSelectionSourceFromPointerEvent(event) {
            const nativeEvent = event?.e;
            if (nativeEvent?.button !== 0) {
                return null;
            }
            if (event?.target) {
                return 'click';
            }
            if (this.canvas?.selection === false || this.canvas?.skipTargetFind === true) {
                return null;
            }
            return 'marquee';
        }

        setActiveObjectWithSelectionSource(obj, source = 'programmatic') {
            if (!obj || !this.canvas) {
                return;
            }
            this.markNextSelectionSource(source);
            this.canvas.setActiveObject(obj);
        }

        sanitizeActiveSelectionIfNeeded(active, source) {
            if (!active || active.type !== 'activeSelection' || source !== 'marquee') {
                return false;
            }

            const selectedObjects = active.getObjects().filter(Boolean);
            const allowedObjects = selectedObjects.filter(obj => {
                if (this.app?.interactionPolicy?.canBoxSelect) {
                    return this.app.interactionPolicy.canBoxSelect(this.app, obj);
                }
                return this.app?.interactionPolicy?.canSelect?.(this.app, obj) !== false;
            });

            if (allowedObjects.length === selectedObjects.length) {
                return false;
            }

            this.selectionSanitizeInProgress = true;
            try {
                this.canvas?.discardActiveObject();

                if (allowedObjects.length === 1) {
                    this.setActiveObjectWithSelectionSource(allowedObjects[0], 'marquee');
                } else if (allowedObjects.length > 1) {
                    this.app?.restoreActiveSelection?.(allowedObjects, { source: 'marquee' });
                } else {
                    this.activeSelectionSource = null;
                    this.canvas?.requestRenderAll();
                }
            } finally {
                this.selectionSanitizeInProgress = false;
            }

            return true;
        }

        finalizeSelectionChange(active = this.canvas?.getActiveObject?.(), source = null) {
            this.activeSelectionSource = active ? source : null;
            this.app?.syncSelectionVisualState?.(active);
            this.app?.syncActiveSelectionInteractionState?.(active);
            this.app?.requestControlsStateRefresh?.();
            this.app?.requestStatusBarRefresh?.();
        }

        handleSelectionChanged() {
            const active = this.canvas?.getActiveObject?.() || null;
            const fallbackSource = active?.type === 'activeSelection'
                ? (this.activeSelectionSource || 'programmatic')
                : (this.activeSelectionSource || 'click');
            const source = this.consumeSelectionSource(active, fallbackSource);

            if (!this.selectionSanitizeInProgress && this.sanitizeActiveSelectionIfNeeded(active, source)) {
                return;
            }

            if (!this.app?.selectionExpandInProgress && this.app?.expandActiveSelectionWithSoftGroupsIfNeeded?.(this.canvas.getActiveObject(), source)) {
                return;
            }

            this.finalizeSelectionChange(this.canvas?.getActiveObject?.() || null, source);
        }

        handleSelectionCleared() {
            this.pendingSelectionSource = null;
            this.activeSelectionSource = null;
            this.app?.requestControlsStateRefresh?.();
            this.app?.requestStatusBarRefresh?.();
        }

        bindCanvasEvents() {
            const canvas = this.canvas;
            if (!canvas) {
                return;
            }

            this.setPanCursor(false);

            canvas.on('mouse:down', event => {
                const nativeEvent = event.e;

                if (this.suppressCanvasUntilMouseUp && nativeEvent?.button === 0) {
                    nativeEvent.preventDefault();
                    nativeEvent.stopPropagation();
                    this.stopPanning();
                    canvas.discardActiveObject();
                    canvas.requestRenderAll();
                    return;
                }

                if (!this.canStartPanning(nativeEvent)) {
                    this.beginSoftGroupMove(event.target);
                    this.markNextSelectionSource(this.detectSelectionSourceFromPointerEvent(event));
                    return;
                }

                nativeEvent.preventDefault();
                nativeEvent.stopPropagation();

                this.isPanning = true;
                this.panStart = { x: nativeEvent.clientX, y: nativeEvent.clientY };
                canvas.selection = false;
                canvas.skipTargetFind = true;
                this.setPanCursor(true);
            });

            canvas.on('mouse:move', event => {
                const nativeEvent = event.e;

                if (this.suppressCanvasUntilMouseUp && this.primaryPointerDown) {
                    nativeEvent?.preventDefault?.();
                    this.stopPanning();
                    return;
                }

                if (!this.isPanning) {
                    return;
                }

                const dx = nativeEvent.clientX - this.panStart.x;
                const dy = nativeEvent.clientY - this.panStart.y;
                const vpt = canvas.viewportTransform;

                vpt[4] += dx;
                vpt[5] += dy;

                this.panStart = { x: nativeEvent.clientX, y: nativeEvent.clientY };
                canvas.requestRenderAll();
            });

            canvas.on('mouse:up', () => {
                this.stopPanning();
                this.pendingSoftGroupFinalizeObjects = this.finalizeSoftGroupMove(canvas.getActiveObject());
            });

            canvas.on('mouse:wheel', event => {
                this.app?.zoomViewportByPointer?.(event.e);
            });

            canvas.on('selection:created', () => {
                this.handleSelectionChanged();
            });

            canvas.on('selection:updated', () => {
                this.handleSelectionChanged();
            });

            canvas.on('selection:cleared', () => {
                this.handleSelectionCleared();
            });

            canvas.on('object:moving', event => {
                this.handleSoftGroupObjectMoving(event.target);
                if (event.target?.type !== 'activeSelection') {
                    this.app?.syncObjectTextState?.(event.target);
                }
                canvas.requestRenderAll();
                this.app?.requestStatusBarRefresh?.();
            });

            canvas.on('object:scaling', () => {
                canvas.requestRenderAll();
                this.app?.requestStatusBarRefresh?.();
            });

            canvas.on('object:rotating', event => {
                if (event.target?.type !== 'activeSelection') {
                    this.app?.syncObjectTextState?.(event.target);
                }
                canvas.requestRenderAll();
                this.app?.requestStatusBarRefresh?.();
            });

            canvas.on('object:modified', event => {
                this.app?.finalizePointerDrivenTransform?.(event.target);
            });
        }
    }

    global.SelectionPointerController = {
        create(app, options) {
            return new SelectionPointerController(app, options);
        }
    };
})(window);
