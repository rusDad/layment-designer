// app.js

const WORKSPACE_STORAGE_KEY = 'laymentDesigner.workspace.v2';
const WORKSPACE_MANUAL_KEY = 'laymentDesigner.workspace.v2.manual';
const AUTOSAVE_DEBOUNCE_MS = 5000;

class ContourApp {
    constructor() {
        this.canvas = null;
        this.layment = null;                  
        this.safeArea = null;
        this.workspaceScale = Config.WORKSPACE_SCALE.DEFAULT;
        this.laymentOffset = Config.LAYMENT_OFFSET;
        this.availableContours = [];
        this.availableArticleEntries = [];
        this.availableCategories = [];
        this.categoryLabels = {};
        this.currentCategory = null;
        this.catalogQuery = '';
        this.autosaveTimer = null;
        this.isRestoringWorkspace = false;
        this.isSyncingPrimitiveControls = false;
        this.isSyncingTextControls = false;
        this.exportButtonDefaultText = UIDom.buttons.export?.textContent || 'Завершить';
        this.exportCooldownMs = 5000;
        this.exportInProgress = false;
        this.lastOrderResult = null;
        this.baseMaterialColor = Config.DEFAULT_MATERIAL_COLOR;
        this.laymentThicknessMm = 35;
        this.pendingCustomer = null;
        this.isPanning = false;
        this.panStart = null;
        this.isSpacePressed = false;
        this.primaryPointerDown = false;
        this.primaryDownStartedOutsideCanvas = false;
        this.pointerDownStartedInProtectedUi = false;
        this.suppressCanvasUntilMouseUp = false;
        this.pendingPointerResetRenderRaf = null;
        this.pointerFocusDebug = window.localStorage?.getItem('laymentDesigner.debugPointerFocus') === '1';

        this.objectMetaApi = window.ObjectMeta || null;
        this.interactionPolicy = window.InteractionPolicy || null;
        this.actionExecutor = window.ActionExecutor || null;

        this.init();
    }

    async init() {
        this.initializeCanvas();
        this.initializeServices();
        this.createLayment();
        this.initializeMaterialColor();
        this.initializeLaymentThickness();
        await this.loadAvailableContours();
        this.setupEventListeners();
        this.syncPrimitiveControlsFromSelection();
        this.syncTextControlsFromSelection();
        this.fitToLayment();
        await this.loadWorkspaceFromStorage();
    }

    initializeCanvas() {
        const container = document.querySelector('.canvas-scroll-container');
        this.canvasScrollContainer = container;

        const getCanvasSize = () => this.getViewportSize();

        const initialSize = getCanvasSize();
        this.canvas = new fabric.Canvas('workspaceCanvas', {
            width: initialSize.width,
            height: initialSize.height,
            backgroundColor: Config.UI.CANVAS_BACKGROUND,
            selection: true,
            preserveObjectStacking: true
        });
        this.canvas.renderOnAddRemove = false;

        const resizeCanvas = () => {
            const size = getCanvasSize();
            if (size.width > 0 && size.height > 0) {
                this.canvas.setDimensions({ width: size.width, height: size.height });
                this.resizeCanvasToContent();
                this.canvas.renderAll();
            }
        };

        window.addEventListener('resize', resizeCanvas);
        requestAnimationFrame(resizeCanvas);
    }

    getViewportSize() {
        if (!this.canvasScrollContainer) {
            return {
                width: this.canvas?.width || Math.max(0, window.innerWidth - Config.UI.PANEL_WIDTH - Config.UI.CANVAS_PADDING),
                height: this.canvas?.height || Math.max(0, window.innerHeight - Config.UI.HEADER_HEIGHT)
            };
        }

        return {
            width: Math.max(0, this.canvasScrollContainer.clientWidth || this.canvas?.width || 0),
            height: Math.max(0, this.canvasScrollContainer.clientHeight || this.canvas?.height || 0)
        };
    }


    async batchRender(callback) {
        if (!this.canvas) {
            return await callback();
        }

        const originalRenderAll = this.canvas.renderAll;
        this.canvas._objectsDirty = true;
        this.canvas.renderAll = () => {};

        try {
            return await callback();
        } finally {
            this.canvas.renderAll = originalRenderAll;
            this.canvas.requestRenderAll();
        }
    }

    resizeCanvasToContent() {
        if (!this.canvas) {
            return;
        }

        const viewport = this.getViewportSize();
        const margin = 100;
        const objectsForBounds = this.canvas.getObjects().filter(obj => obj !== this.safeArea && obj?.aCoords);

        let contentRight = 0;
        let contentBottom = 0;

        if (objectsForBounds.length > 0) {
            const points = objectsForBounds.flatMap(obj => Object.values(obj.aCoords).filter(Boolean));
            if (points.length > 0) {
                const boundingRect = fabric.util.makeBoundingBoxFromPoints(points);
                contentRight = boundingRect.left + boundingRect.width;
                contentBottom = boundingRect.top + boundingRect.height;
            }
        }

        const zoomFactor = this.canvas?.getZoom?.() || this.workspaceScale || 1;
        const width = Math.max(viewport.width, Math.ceil((contentRight + margin) * zoomFactor));
        const height = Math.max(viewport.height, Math.ceil((contentBottom + margin) * zoomFactor));

        this.canvas.setDimensions({ width, height });
        this.canvas.calcOffset();
    }

    initializeServices() {
        this.contourManager = new ContourManager(this.canvas, this);  // Pass this (app) to ContourManager
        this.primitiveManager = new PrimitiveManager(this.canvas, this);  // Новый менеджер для примитивов
        this.textManager = new TextManager(this.canvas, this, this.contourManager);
    }

    resolveActionTargets(activeObject, actionName = null) {
        if (this.interactionPolicy?.resolveActionTargets) {
            return this.interactionPolicy.resolveActionTargets(this, activeObject, actionName);
        }

        if (!activeObject) {
            return [];
        }
        return activeObject.type === 'activeSelection' ? activeObject.getObjects().filter(Boolean) : [activeObject];
    }

    createSafeAreaRect() {
        if (!this.layment) {
            return;
        }

        const padding = Config.GEOMETRY.LAYMENT_PADDING * this.layment.scaleX;

        this.safeArea = new fabric.Rect({
            width: Math.max(1, this.layment.width * this.layment.scaleX - padding * 2),
            height: Math.max(1, this.layment.height * this.layment.scaleY - padding * 2),
            left: this.layment.left + padding,
            top: this.layment.top + padding,
            scaleX: 1,
            scaleY: 1,
            fill: 'transparent',
            stroke: Config.LAYMENT_STYLE.SAFE_AREA_STROKE,
            strokeWidth: Config.LAYMENT_STYLE.SAFE_AREA_STROKE_WIDTH,
            strokeDashArray: Config.LAYMENT_STYLE.SAFE_AREA_STROKE_DASH_ARRAY,
            selectable: false,
            evented: false,
            hasControls: false,
            hasBorders: false,
            excludeFromExport: true,
            name: 'safe-area'
        });

        this.canvas.add(this.safeArea);
        this.safeArea.moveTo(1);
    }

    syncSafeAreaRect() {
        if (!this.layment || !this.safeArea) {
            return;
        }

        const padding = Config.GEOMETRY.LAYMENT_PADDING * this.layment.scaleX;
        this.safeArea.set({
            width: Math.max(1, this.layment.width * this.layment.scaleX - padding * 2),
            height: Math.max(1, this.layment.height * this.layment.scaleY - padding * 2),
            left: this.layment.left + padding,
            top: this.layment.top + padding,
            scaleX: 1,
            scaleY: 1
        });
        this.safeArea.setCoords();
    }

    createLayment() {
        const width = parseInt(UIDom.inputs.laymentWidth.value) || Config.LAYMENT_DEFAULT_WIDTH;
        const height = parseInt(UIDom.inputs.laymentHeight.value) || Config.LAYMENT_DEFAULT_HEIGHT;


        this.layment = new fabric.Rect({
            width: width,
            height: height,
            left: this.laymentOffset,
            top: this.laymentOffset,
            fill: Config.LAYMENT_STYLE.FILL,
            stroke: Config.LAYMENT_STYLE.STROKE,
            strokeWidth: Config.LAYMENT_STYLE.STROKE_WIDTH,
            strokeDashArray: Config.LAYMENT_STYLE.STROKE_DASH_ARRAY,
            selectable: false,
            evented: false,
            hasControls: false,
            hasBorders: false,
            name: 'layment'
        });

        this.canvas.add(this.layment);
        this.canvas.sendToBack(this.layment);
        this.canvas.layment = this.layment; // для удобства
        this.createSafeAreaRect();
        this.syncLaymentPresetBySize(width, height);
    }

    syncLaymentPresetBySize(width, height) {
        const presetEntry = Object.entries(Config.LAYMENT_PRESETS || {}).find(([, size]) => {
            return size.width === width && size.height === height;
        });
        UIDom.inputs.laymentPreset.value = presetEntry ? presetEntry[0] : 'CUSTOM';
    }

    applyLaymentPreset(presetName) {
        const preset = Config.LAYMENT_PRESETS?.[presetName];
        if (!preset) {
            return;
        }

        UIDom.inputs.laymentWidth.value = preset.width;
        UIDom.inputs.laymentHeight.value = preset.height;
        this.updateLaymentSize(preset.width, preset.height);
    }

    initializeMaterialColor() {
        const colorInput = UIDom.inputs.baseMaterialColor;
        if (!colorInput) {
            this.applyMaterialColorToCutouts();
            return;
        }

        if (!Config.MATERIAL_COLORS[this.baseMaterialColor]) {
            this.baseMaterialColor = Config.DEFAULT_MATERIAL_COLOR;
        }

        colorInput.value = this.baseMaterialColor;
        this.applyMaterialColorToCutouts();
    }

    getValidLaymentThickness(value) {
        const thickness = Number(value);
        if (thickness === 35 || thickness === 65) {
            return thickness;
        }
        return 35;
    }

    initializeLaymentThickness() {
        this.laymentThicknessMm = this.getValidLaymentThickness(this.laymentThicknessMm);
        const thicknessInput = UIDom.inputs.laymentThicknessMm;
        if (thicknessInput) {
            thicknessInput.value = String(this.laymentThicknessMm);
        }
    }

    getMaterialColorHex(colorKey = this.baseMaterialColor) {
        return Config.MATERIAL_COLORS[colorKey] || Config.MATERIAL_COLORS[Config.DEFAULT_MATERIAL_COLOR];
    }

    applyMaterialColorToCutouts() {
        const materialHex = this.getMaterialColorHex();

        Config.COLORS.CONTOUR.FILL = materialHex;
        Config.COLORS.PRIMITIVE.FILL = materialHex;

        this.contourManager?.contours?.forEach(group => {
            group.set({ fill: materialHex });
            this.contourManager.resetPropertiesRecursive(group, { fill: materialHex });
        });

        this.primitiveManager?.primitives?.forEach(primitive => {
            this.contourManager.resetPropertiesRecursive(primitive, { fill: materialHex });
        });

        this.canvas?.requestRenderAll();
    }

    async loadAvailableContours() {
        try {
            const resp = await fetch(Config.API.MANIFEST_URL);
            const data = await resp.json();

            this.manifest = data.items.reduce((acc, item) => {
                acc[item.id] = item;
                return acc;
            }, {});
            this.categoryLabels = data.categories || {};

            this.availableContours = data.items.filter(i => i.enabled);
            this.availableArticleEntries = this.buildArticleEntries(this.availableContours);
            this.availableCategories = this.buildCategories(this.availableArticleEntries);
            this.ensureValidCategory();
            this.renderCatalogNav();
            this.renderCatalogList();
        } catch (err) {
                console.error('Ошибка загрузки manifest', err);
                this.showOrderResultError(Config.MESSAGES.LOADING_ERROR);
        }
    }

    async addContour(item) {
        const centerX = this.layment.left + this.layment.width / 2;
        const centerY = this.layment.top + this.layment.height / 2;

        await this.batchRender(async () => {
            await this.contourManager.addContour(
                `/contours/${item.assets.svg}`,
                { x: centerX, y: centerY },
                item
            );

            const contourObj = this.contourManager.contours[this.contourManager.contours.length - 1];
            this.textManager.ensureDefaultTextForContour(contourObj, item.defaultLabel);
        });

        this.scheduleWorkspaceSave();
    }

    updateLaymentSize(width, height) {
        this.layment.set({ width, height });
        this.layment.setCoords();
        this.syncSafeAreaRect();
        if (!this.isRestoringWorkspace) {
            this.fitToLayment();
        }
        this.canvas.requestRenderAll();
        this.scheduleWorkspaceSave();
    }

    updateWorkspaceScale(newScale) {
        if (newScale < Config.WORKSPACE_SCALE.MIN || newScale > Config.WORKSPACE_SCALE.MAX) return;
        this.applyViewportZoom(newScale);
    }

    applyViewportZoom(newScale) {
        const saved = this.temporarilyUngroupActiveSelection();
        this.workspaceScale = newScale;
        this.canvas.setZoom(newScale);
        this.resizeCanvasToContent();
        this.canvas.requestRenderAll();
        this.syncWorkspaceScaleInput();
        this.updateStatusBar();
        this.restoreActiveSelection(saved.objects);
    }

    fitToLayment() {
        if (!this.canvas || !this.layment) {
            return;
        }

        const viewport = this.getViewportSize();
        if (!viewport.width || !viewport.height) {
            return;
        }

        this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

        const rect = this.layment.getBoundingRect(true, true);
        const padding = 20;
        const zoomX = viewport.width / (rect.width + padding * 2);
        const zoomY = viewport.height / (rect.height + padding * 2);
        const unclampedZoom = Math.min(zoomX, zoomY);
        const zoom = Math.max(Config.WORKSPACE_SCALE.MIN, Math.min(Config.WORKSPACE_SCALE.MAX, unclampedZoom));

        this.canvas.setZoom(zoom);

        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const vpt = this.canvas.viewportTransform;

        vpt[4] = viewport.width / 2 - cx * zoom;
        vpt[5] = viewport.height / 2 - cy * zoom;

        this.canvas.setViewportTransform(vpt);

        this.workspaceScale = zoom;
        this.syncWorkspaceScaleInput();
        this.resizeCanvasToContent();
        this.canvas.requestRenderAll();
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

    zoomViewportByPointer(mouseEvent) {
        if (!this.canvas || !mouseEvent) {
            return;
        }

        const wheelDelta = mouseEvent.deltaY;
        if (!wheelDelta) {
            return;
        }

        mouseEvent.preventDefault();
        mouseEvent.stopPropagation();

        const oldZoom = this.canvas.getZoom() || this.workspaceScale || 1;
        const zoomMultiplier = wheelDelta < 0 ? 1.1 : (1 / 1.1);
        const unclampedZoom = oldZoom * zoomMultiplier;
        const newZoom = Math.max(Config.WORKSPACE_SCALE.MIN, Math.min(Config.WORKSPACE_SCALE.MAX, unclampedZoom));

        if (newZoom === oldZoom) {
            return;
        }

        const vpt = this.canvas.viewportTransform;
        const cursorX = mouseEvent.offsetX;
        const cursorY = mouseEvent.offsetY;
        const worldX = (cursorX - vpt[4]) / oldZoom;
        const worldY = (cursorY - vpt[5]) / oldZoom;

        vpt[0] = newZoom;
        vpt[3] = newZoom;
        vpt[4] = cursorX - worldX * newZoom;
        vpt[5] = cursorY - worldY * newZoom;

        this.canvas.setViewportTransform(vpt);
        this.workspaceScale = newZoom;
        this.syncWorkspaceScaleInput();
        this.canvas.requestRenderAll();
        this.updateStatusBar();
    }

    setPanCursor(isGrabbing) {
        if (!this.canvasScrollContainer) {
            return;
        }
        this.canvasScrollContainer.classList.toggle('is-panning', isGrabbing);
    }

    stopPanning() {
        if (!this.isPanning || !this.canvas) {
            return;
        }

        this.isPanning = false;
        this.panStart = null;
        this.canvas.selection = true;
        this.canvas.skipTargetFind = false;
        this.setPanCursor(false);
    }

    isInsideCanvas(target) {
        if (!this.canvas?.wrapperEl || !(target instanceof Node)) {
            return false;
        }

        return this.canvas.wrapperEl.contains(target);
    }

    isProtectedUiTarget(target) {
        if (!(target instanceof Node)) {
            return false;
        }

        const element = target instanceof Element ? target : target.parentElement;
        if (!element) {
            return false;
        }

        return !!element.closest(
            '#customerModalOverlay, #customerModalDialog, .customer-modal-overlay, .customer-modal-dialog, input, textarea, select, button, label, a, [contenteditable]:not([contenteditable="false"])'
        );
    }

    clearBrowserSelection() {
        const selection = window.getSelection?.();
        if (selection && selection.rangeCount > 0) {
            selection.removeAllRanges();
        }
    }

    isEditableElement(element) {
        if (!(element instanceof Element)) {
            return false;
        }

        return !!element.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
    }

    isEditableTarget(target) {
        if (!(target instanceof Node)) {
            return false;
        }

        const element = target instanceof Element ? target : target.parentElement;
        return this.isEditableElement(element);
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
        if (!this.canvas) {
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
            this.canvas.requestRenderAll();
        });
    }

    finishActiveTextEditing() {
        if (!this.canvas) {
            return;
        }

        const activeObject = this.canvas.getActiveObject();
        if (!activeObject || activeObject.type !== 'i-text' || !activeObject.isEditing) {
            return;
        }

        activeObject.exitEditing();
        activeObject.hiddenTextarea?.blur?.();
    }

    resetPointerInteraction({ soft = false } = {}) {
        if (!this.canvas) {
            return;
        }

        this.stopPanning();
        this.isPanning = false;
        this.panStart = null;
        this.primaryPointerDown = false;
        this.primaryDownStartedOutsideCanvas = false;
        this.pointerDownStartedInProtectedUi = false;
        this.suppressCanvasUntilMouseUp = false;
        this.canvas.selection = true;
        this.canvas.skipTargetFind = false;
        this.setPanCursor(false);
        this.clearBrowserSelection();

        if (soft) {
            if (this.pendingPointerResetRenderRaf !== null) {
                cancelAnimationFrame(this.pendingPointerResetRenderRaf);
                this.pendingPointerResetRenderRaf = null;
            }
            return;
        }

        this.schedulePointerResetRender();
    }

    setupEventListeners() {
        this.bindGlobalPointerSafety();
        this.bindCanvasEvents();
        this.bindUIButtonEvents();
        this.bindInputEvents();
        this.bindCatalogEvents();
        this.bindStatusHintEvents();
        this.bindCustomerModalEvents();
        this.bindKeyboardShortcuts();
        this.syncWorkspaceScaleInput();
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
            // External drag safety should apply only to truly external sources.
            // Legitimate UI controls (forms/modals/catalog inputs) must keep focus
            // and should not arm canvas suppression.
            this.suppressCanvasUntilMouseUp = this.primaryDownStartedOutsideCanvas && !this.pointerDownStartedInProtectedUi;

            if (this.suppressCanvasUntilMouseUp && !this.pointerDownStartedInProtectedUi) {
                this.stopPanning();
                this.canvas.discardActiveObject();
                this.canvas.requestRenderAll();
            }
        }, true);

        window.addEventListener('mouseup', event => {
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

        window.addEventListener('blur', () => {
            this.resetPointerInteraction();
        });

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.resetPointerInteraction();
            }
        });

        this.canvas.wrapperEl.addEventListener('mouseenter', event => {
            if (!this.primaryPointerDown || !this.suppressCanvasUntilMouseUp) {
                return;
            }

            this.stopPanning();
            this.canvas.discardActiveObject();
            this.clearBrowserSelection();

            event.preventDefault();
            event.stopPropagation();
            this.canvas.requestRenderAll();
        });
    }

    bindKeyboardShortcuts() {
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

        document.addEventListener('keydown', event => {
            const isModalOpen = !UIDom.customerModal?.overlay?.hidden;
            if (event.defaultPrevented || (this.shouldIgnoreKeyboardShortcut(event) && !(isModalOpen && event.key === 'Escape'))) {
                return;
            }

            const step = event.shiftKey ? 10 : 1;

            switch (event.key) {
                case 'ArrowUp':
                    if (this.moveSelectedBy(0, -step)) {
                        event.preventDefault();
                    }
                    break;
                case 'ArrowDown':
                    if (this.moveSelectedBy(0, step)) {
                        event.preventDefault();
                    }
                    break;
                case 'ArrowLeft':
                    if (this.moveSelectedBy(-step, 0)) {
                        event.preventDefault();
                    }
                    break;
                case 'ArrowRight':
                    if (this.moveSelectedBy(step, 0)) {
                        event.preventDefault();
                    }
                    break;
                case 'Delete':
                    if (this.canvas.getActiveObject()) {
                        event.preventDefault();
                        this.deleteSelected();
                    }
                    break;
                case 'Escape':
                    if (!UIDom.customerModal?.overlay?.hidden) {
                        event.preventDefault();
                        this.closeCustomerModal();
                        break;
                    }
                    if (this.canvas.getActiveObject()) {
                        event.preventDefault();
                        this.canvas.discardActiveObject();
                        this.canvas.requestRenderAll();
                        this.updateButtons();
                        this.updateStatusBar();
                        this.syncPrimitiveControlsFromSelection();
                        this.syncTextControlsFromSelection();
                    }
                    break;
                default:
                    break;
            }
        });
    }

    shouldIgnoreKeyboardShortcut(event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return false;
        }

        if (target.isContentEditable) {
            return true;
        }

        return !!target.closest('input, textarea, select');
    }

    moveSelectedBy(dx, dy) {
        const active = this.canvas.getActiveObject();
        if (!active) {
            return false;
        }

        if (active.type === 'activeSelection') {
            active.getObjects().forEach(obj => {
                obj.set({
                    left: obj.left + dx,
                    top: obj.top + dy
                });
                this.syncObjectTextState(obj, { rememberContourLastPosition: true });
            });
            active.setCoords();
        } else {
            active.set({
                left: active.left + dx,
                top: active.top + dy
            });
            this.syncObjectTextState(active, { rememberContourLastPosition: true });
        }

        this.canvas.requestRenderAll();
        this.updateStatusBar();
        this.scheduleWorkspaceSave();
        return true;
    }

    bindCanvasEvents() {
        this.setPanCursor(false);

        this.canvas.on('mouse:down', event => {
            const nativeEvent = event.e;

            if (this.suppressCanvasUntilMouseUp && nativeEvent?.button === 0) {
                nativeEvent.preventDefault();
                nativeEvent.stopPropagation();
                this.stopPanning();
                this.canvas.discardActiveObject();
                this.canvas.requestRenderAll();
                return;
            }

            if (!this.canStartPanning(nativeEvent)) {
                return;
            }

            nativeEvent.preventDefault();
            nativeEvent.stopPropagation();

            this.isPanning = true;
            this.panStart = { x: nativeEvent.clientX, y: nativeEvent.clientY };
            this.canvas.selection = false;
            this.canvas.skipTargetFind = true;
            this.setPanCursor(true);
        });

        this.canvas.on('mouse:move', event => {
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
            const vpt = this.canvas.viewportTransform;

            vpt[4] += dx;
            vpt[5] += dy;

            this.panStart = { x: nativeEvent.clientX, y: nativeEvent.clientY };
            this.canvas.requestRenderAll();
        });

        this.canvas.on('mouse:up', () => {
            this.stopPanning();
        });

        this.canvas.on('mouse:wheel', event => {
            this.zoomViewportByPointer(event.e);
        });

        this.canvas.on('selection:created', () => {
            this.updateButtons();
            this.updateStatusBar();
            this.syncPrimitiveControlsFromSelection();
            this.syncTextControlsFromSelection();
        });

        this.canvas.on('selection:updated', () => {
            this.updateButtons();
            this.updateStatusBar();
            this.syncPrimitiveControlsFromSelection();
            this.syncTextControlsFromSelection();
        });

        this.canvas.on('selection:cleared', () => {
            this.updateButtons();
            this.updateStatusBar();
            this.syncPrimitiveControlsFromSelection();
            this.syncTextControlsFromSelection();
        });

        this.canvas.on('object:moving', event => {
            this.syncObjectTextState(event.target);
            this.canvas.requestRenderAll();
            this.updateStatusBar();
        });

        this.canvas.on('object:scaling', () => {
            this.canvas.requestRenderAll();
            this.updateStatusBar();
        });

        this.canvas.on('object:rotating', event => {
            this.syncObjectTextState(event.target);
            this.canvas.requestRenderAll();
            this.updateStatusBar();
        });

        this.canvas.on('object:modified', event => {
            const target = event.target;
            this.syncObjectTextState(target);
            this.canvas.requestRenderAll();
            if (this.shouldAutosaveForObject(target)) {
                this.scheduleWorkspaceSave();
            }
            this.syncPrimitiveControlsFromSelection();
            this.syncTextControlsFromSelection();
            this.updateStatusBar();
        });
    }    
    bindUIButtonEvents() {
        UIDom.buttons.delete.onclick = () => this.deleteSelected();
        UIDom.buttons.rotate.onclick = () => this.rotateSelected();
        UIDom.buttons.duplicate.onclick = () => this.duplicateSelected();
        UIDom.buttons.saveWorkspace.onclick = () => this.saveWorkspace('manual');
        UIDom.buttons.loadWorkspace.onclick = async () => {
            this.cancelAutosave();
            const okManual = await this.loadWorkspaceFromStorage('manual');
            if (!okManual) {
                await this.loadWorkspaceFromStorage('autosave');
            }
        };

        UIDom.buttons.preview3d.onclick = () => this.open3dPreview();
        UIDom.buttons.export.onclick = () => this.openCustomerModal();

        UIDom.buttons.check.onclick =
            () => this.performWithScaleOne(() => {
              const validation = this.contourManager.checkCollisionsAndHighlight();
              if (validation.ok) {
                const orderResult = UIDom.orderResult;
                if (orderResult.container) {
                    orderResult.container.hidden = false;
                    orderResult.container.classList.remove('order-result-error');
                    orderResult.container.classList.add('order-result-success');
                    orderResult.message.textContent = Config.MESSAGES.VALID_LAYOUT;
                    orderResult.details.hidden = true;
                }
                return;
              }

              this.showOrderResultError(this.formatLayoutIssuesMessage(validation.issues));
            });


        UIDom.buttons.addRect.addEventListener('click', () => {
            const bbox = this.layment.getBoundingRect(true);
            const centerX = bbox.left + (bbox.width / 2);
            const centerY = bbox.top + (bbox.height / 2);
            this.primitiveManager.addPrimitive('rect', { x: centerX, y: centerY }, { width: 50, height: 50 });
            this.scheduleWorkspaceSave();
        });

        UIDom.buttons.addCircle.addEventListener('click', () => {
            const bbox = this.layment.getBoundingRect(true);
            const centerX = bbox.left + (bbox.width / 2);
            const centerY = bbox.top + (bbox.height / 2);
            this.primitiveManager.addPrimitive('circle', { x: centerX, y: centerY }, { radius: 25 });
            this.scheduleWorkspaceSave();
        });

        UIDom.buttons.alignLeft.onclick = () => this.alignSelected('left');
        UIDom.buttons.alignCenterX.onclick = () => this.alignSelected('center-x');
        UIDom.buttons.alignRight.onclick = () => this.alignSelected('right');
        UIDom.buttons.alignTop.onclick = () => this.alignSelected('top');
        UIDom.buttons.alignCenterY.onclick = () => this.alignSelected('center-y');
        UIDom.buttons.alignBottom.onclick = () => this.alignSelected('bottom');
        UIDom.buttons.distributeHorizontalGaps.onclick = () => this.distributeSelected('horizontal-gaps');
        UIDom.buttons.distributeVerticalGaps.onclick = () => this.distributeSelected('vertical-gaps');
        UIDom.buttons.snapLeft.onclick = () => this.snapSelectedToSide('left');
        UIDom.buttons.snapRight.onclick = () => this.snapSelectedToSide('right');
        UIDom.buttons.snapTop.onclick = () => this.snapSelectedToSide('top');
        UIDom.buttons.snapBottom.onclick = () => this.snapSelectedToSide('bottom');
    }
    bindCustomerModalEvents() {
        const modal = UIDom.customerModal;
        if (!modal?.overlay) {
            return;
        }

        const syncConfirmState = () => {
            const isValid = Boolean(modal.nameInput?.value.trim()) && Boolean(modal.contactInput?.value.trim());
            if (modal.confirmButton) {
                modal.confirmButton.disabled = !isValid;
            }
            return isValid;
        };

        modal.nameInput?.addEventListener('input', () => {
            this.clearCustomerModalFeedback();
            syncConfirmState();
        });
        modal.contactInput?.addEventListener('input', () => {
            this.clearCustomerModalFeedback();
            syncConfirmState();
        });

        modal.cancelButton?.addEventListener('click', () => this.closeCustomerModal());

        modal.overlay.addEventListener('click', event => {
            if (event.target === modal.overlay) {
                this.closeCustomerModal();
            }
        });

        const onEnter = event => {
            if (event.key !== 'Enter') {
                return;
            }
            if (!syncConfirmState()) {
                return;
            }
            event.preventDefault();
            this.handleCustomerModalConfirm();
        };

        modal.nameInput?.addEventListener('keydown', onEnter);
        modal.contactInput?.addEventListener('keydown', onEnter);

        modal.confirmButton?.addEventListener('click', () => this.handleCustomerModalConfirm());
    }

    bindInputEvents() {
        UIDom.inputs.laymentPreset.addEventListener('change', e => {
            this.applyLaymentPreset(e.target.value);
        });

        UIDom.inputs.laymentWidth.addEventListener('change', e => {
            let v = parseInt(e.target.value) || Config.LAYMENT_DEFAULT_WIDTH;
            if (v < Config.LAYMENT_MIN_SIZE) v = Config.LAYMENT_MIN_SIZE;
            e.target.value = v;
            UIDom.inputs.laymentPreset.value = 'CUSTOM';
            this.updateLaymentSize(v, this.layment.height);
        });

        UIDom.inputs.laymentHeight.addEventListener('change', e => {
            let v = parseInt(e.target.value) || Config.LAYMENT_DEFAULT_HEIGHT;
            if (v < Config.LAYMENT_MIN_SIZE) v = Config.LAYMENT_MIN_SIZE;
            e.target.value = v;
            UIDom.inputs.laymentPreset.value = 'CUSTOM';
            this.updateLaymentSize(this.layment.width, v);
        });

        UIDom.inputs.baseMaterialColor?.addEventListener('change', e => {
            const selectedColor = e.target.value;
            if (!Config.MATERIAL_COLORS[selectedColor]) {
                e.target.value = this.baseMaterialColor;
                return;
            }

            this.baseMaterialColor = selectedColor;
            this.applyMaterialColorToCutouts();
            this.scheduleWorkspaceSave();
        });

        UIDom.inputs.laymentThicknessMm?.addEventListener('change', e => {
            const thickness = this.getValidLaymentThickness(e.target.value);
            e.target.value = String(thickness);
            this.laymentThicknessMm = thickness;
            this.scheduleWorkspaceSave();
        });

        UIDom.inputs.workspaceScale.addEventListener('change', e => {
            const percent = parseFloat(e.target.value);
            const minPercent = Math.round(Config.WORKSPACE_SCALE.MIN * 100);
            const maxPercent = Math.round(Config.WORKSPACE_SCALE.MAX * 100);
            if (Number.isFinite(percent) && percent >= minPercent && percent <= maxPercent) {
                this.updateWorkspaceScale(percent / 100);
                this.syncWorkspaceScaleInput();
            } else {
                this.syncWorkspaceScaleInput();
            }
        });
        UIDom.inputs.primitiveWidth.addEventListener('change', () => this.applyPrimitiveDimensionsFromInputs());
        UIDom.inputs.primitiveHeight.addEventListener('change', () => this.applyPrimitiveDimensionsFromInputs());
        UIDom.inputs.primitiveRadius.addEventListener('change', () => this.applyPrimitiveDimensionsFromInputs());

        UIDom.texts.list?.addEventListener('change', () => {
            if (this.isSyncingTextControls) {
                return;
            }
            this.syncTextControlsFromSelection();
        });
        UIDom.texts.value?.addEventListener('input', event => this.applyTextValueFromInput(event.target.value));
        UIDom.texts.fontSize?.addEventListener('change', event => this.applyTextFontSizeFromInput(event.target.value));
        UIDom.texts.angle?.addEventListener('change', event => this.applyTextAngleFromInput(event.target.value));
        UIDom.texts.addFreeBtn?.addEventListener('click', () => this.addFreeTextForSelection());
        UIDom.texts.addAttachedBtn?.addEventListener('click', () => this.addAttachedTextForSelection());
        UIDom.texts.attachBtn?.addEventListener('click', () => this.attachSelectedTextToSelectionContour());
        UIDom.texts.detachBtn?.addEventListener('click', () => this.detachSelectedText());
        UIDom.texts.deleteBtn?.addEventListener('click', () => this.deleteSelectedText());
    }


    syncWorkspaceScaleInput() {
        if (!UIDom.inputs.workspaceScale) {
            return;
        }
        UIDom.inputs.workspaceScale.value = Math.round(this.workspaceScale * 100);
    }

    bindStatusHintEvents() {
        const statusHint = UIDom.status.hint;
        if (!statusHint) {
            return;
        }

        document.querySelectorAll('[data-hint]').forEach(element => {
            const showHint = () => {
                statusHint.textContent = element.dataset.hint || '';
            };
            const clearHint = () => {
                statusHint.textContent = '';
            };

            element.addEventListener('mouseenter', showHint);
            element.addEventListener('focus', showHint);
            element.addEventListener('mouseleave', clearHint);
            element.addEventListener('blur', clearHint);
        });
    }

    bindCatalogEvents() {
        UIDom.catalog.breadcrumbAll.addEventListener('click', () => {
            this.setCurrentCategory(null);
        });

        UIDom.catalog.categorySelect.addEventListener('change', event => {
            const value = event.target.value;
            this.setCurrentCategory(value || null);
        });

        UIDom.catalog.searchInput.addEventListener('input', event => {
            this.catalogQuery = event.target.value || '';
            this.renderCatalogList();
        });
    }

   
    withViewportReset(callback) {
        const saved = this.canvas.viewportTransform?.slice?.() || [1, 0, 0, 1, 0, 0];
        this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        this.canvas.requestRenderAll();

        try {
            return callback();
        } finally {
            this.canvas.setViewportTransform(saved);
            this.canvas.requestRenderAll();
        }
    }

    // Выполнить с временным  scale=1

    async performWithScaleOne(action) {
        return await this.withViewportReset(action);
    }

    getArrangeSelectionObjects() {
        const active = this.canvas.getActiveObject();
        return this.resolveActionTargets(active, 'arrange');
    }

    temporarilyUngroupActiveSelection() {
        const active = this.canvas.getActiveObject();
        if (!active || active.type !== 'activeSelection') {
            return { objects: null };
        }

        const objects = active.getObjects();
        this.canvas.discardActiveObject();
        this.canvas.requestRenderAll();
        return { objects };
    }

    restoreActiveSelection(objects) {
        if (!objects || !objects.length) {
            return;
        }

        if (objects.length === 1) {
            this.canvas.setActiveObject(objects[0]);
            objects[0].setCoords();
            this.canvas.requestRenderAll();
            return;
        }

        const selection = new fabric.ActiveSelection(objects, { canvas: this.canvas });
        this.canvas.setActiveObject(selection);
        selection.setCoords();
        this.canvas.requestRenderAll();
    }

    isContourObject(obj) {
        return !!obj && !obj.primitiveType && !obj.isTextObject && obj !== this.layment && obj !== this.safeArea;
    }

    syncObjectTextState(obj, { rememberContourLastPosition = false } = {}) {
        if (!obj) {
            return;
        }

        if (obj.type === 'activeSelection') {
            obj.getObjects().forEach(item => this.syncObjectTextState(item, { rememberContourLastPosition }));
            obj.setCoords();
            return;
        }

        if (this.isContourObject(obj)) {
            if (rememberContourLastPosition) {
                obj._lastLeft = obj.left;
                obj._lastTop = obj.top;
            }
            obj.setCoords();
            this.textManager.syncAttachedTextsForContour(obj);
            return;
        }

        if (obj.isTextObject) {
            if (obj.kind === 'attached') {
                this.textManager.clampTextToContourBounds(obj);
                this.textManager.updateAttachedTextAnchorFromAbsolute(obj);
            }
            obj.setCoords();
            return;
        }

        obj.setCoords();
    }

    applyDeltaToObject(obj, deltaX, deltaY) {
        obj.set({
            left: obj.left + deltaX,
            top: obj.top + deltaY
        });
        this.syncObjectTextState(obj, { rememberContourLastPosition: true });
    }

    finalizeArrangeOperation() {
        this.canvas.requestRenderAll();
        this.updateStatusBar();
        this.scheduleWorkspaceSave();
    }

    alignSelected(mode) {
        const selected = this.getArrangeSelectionObjects();
        if (selected.length < 2) {
            return;
        }

        this.temporarilyUngroupActiveSelection();

        const boxes = selected.map(obj => ({ obj, bbox: obj.getBoundingRect(true) }));
        const minLeft = Math.min(...boxes.map(item => item.bbox.left));
        const maxRight = Math.max(...boxes.map(item => item.bbox.left + item.bbox.width));
        const minTop = Math.min(...boxes.map(item => item.bbox.top));
        const maxBottom = Math.max(...boxes.map(item => item.bbox.top + item.bbox.height));
        const centerX = minLeft + ((maxRight - minLeft) / 2);
        const centerY = minTop + ((maxBottom - minTop) / 2);

        for (const item of boxes) {
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
            this.applyDeltaToObject(item.obj, deltaX, deltaY);
        }

        this.finalizeArrangeOperation();
        this.restoreActiveSelection(selected);
        this.updateButtons();
        this.syncPrimitiveControlsFromSelection();
        this.syncTextControlsFromSelection();
    }

    distributeSelected(mode) {
        const selected = this.getArrangeSelectionObjects();
        if (selected.length < 3) {
            return;
        }

        this.temporarilyUngroupActiveSelection();

        const axis = mode === 'horizontal-gaps' ? 'x' : 'y';
        const boxes = selected.map(obj => ({ obj, bbox: obj.getBoundingRect(true) }));
        const sorted = boxes.sort((a, b) => axis === 'x' ? a.bbox.left - b.bbox.left : a.bbox.top - b.bbox.top);

        if (axis === 'x') {
            const totalWidth = sorted.reduce((sum, item) => sum + item.bbox.width, 0);
            const span = (sorted[sorted.length - 1].bbox.left + sorted[sorted.length - 1].bbox.width) - sorted[0].bbox.left;
            const gap = (span - totalWidth) / (sorted.length - 1);
            let cursor = sorted[0].bbox.left + sorted[0].bbox.width + gap;

            for (let i = 1; i < sorted.length - 1; i += 1) {
                const targetLeft = cursor;
                const deltaX = targetLeft - sorted[i].bbox.left;
                this.applyDeltaToObject(sorted[i].obj, deltaX, 0);
                cursor += sorted[i].bbox.width + gap;
            }
        } else {
            const totalHeight = sorted.reduce((sum, item) => sum + item.bbox.height, 0);
            const span = (sorted[sorted.length - 1].bbox.top + sorted[sorted.length - 1].bbox.height) - sorted[0].bbox.top;
            const gap = (span - totalHeight) / (sorted.length - 1);
            let cursor = sorted[0].bbox.top + sorted[0].bbox.height + gap;

            for (let i = 1; i < sorted.length - 1; i += 1) {
                const targetTop = cursor;
                const deltaY = targetTop - sorted[i].bbox.top;
                this.applyDeltaToObject(sorted[i].obj, 0, deltaY);
                cursor += sorted[i].bbox.height + gap;
            }
        }

        this.finalizeArrangeOperation();
        this.restoreActiveSelection(selected);
        this.updateButtons();
        this.syncPrimitiveControlsFromSelection();
        this.syncTextControlsFromSelection();
    }

    snapSelectedToSide(side) {
        const selected = this.getArrangeSelectionObjects();
        if (selected.length < 1) {
            return;
        }
         // важно: разгруппировать ПОСЛЕ того, как мы получили список объектов
        this.temporarilyUngroupActiveSelection();

        const targetArea = (this.safeArea || this.layment).getBoundingRect(true);
        const clearanceMm = 3;
        const clearancePx = clearanceMm;

        for (const obj of selected) {
            const bbox = obj.getBoundingRect(true);
            let deltaX = 0;
            let deltaY = 0;

            if (side === 'left') {
                const targetLeft = targetArea.left + clearancePx;
                deltaX = targetLeft - bbox.left;
            } else if (side === 'right') {
                const targetLeft = targetArea.left + targetArea.width - clearancePx - bbox.width;
                deltaX = targetLeft - bbox.left;
            } else if (side === 'top') {
                const targetTop = targetArea.top + clearancePx;
                deltaY = targetTop - bbox.top;
            } else if (side === 'bottom') {
                const targetTop = targetArea.top + targetArea.height - clearancePx - bbox.height;
                deltaY = targetTop - bbox.top;
            }

            this.applyDeltaToObject(obj, deltaX, deltaY);
        }

        this.finalizeArrangeOperation();
        this.restoreActiveSelection(selected);
        this.updateButtons();
        this.syncPrimitiveControlsFromSelection();
        this.syncTextControlsFromSelection();
    }

    updateButtons() {
        const selected = this.getArrangeSelectionObjects();
        const selectedCount = selected.length;
        const active = this.canvas.getActiveObject();
        const has = !!active;

        const deleteAllowed = has && this.resolveActionTargets(active, 'delete').length > 0;
        const rotateAllowed = this.resolveActionTargets(active, 'rotate').length > 0;

        UIDom.buttons.delete.disabled = !deleteAllowed;
        UIDom.buttons.rotate.disabled = !rotateAllowed;

        const duplicateTargets = this.getDuplicateSelectionObjects();
        UIDom.buttons.duplicate.disabled = duplicateTargets.length < 1;

        const alignDisabled = selectedCount < 2;
        UIDom.buttons.alignLeft.disabled = alignDisabled;
        UIDom.buttons.alignCenterX.disabled = alignDisabled;
        UIDom.buttons.alignRight.disabled = alignDisabled;
        UIDom.buttons.alignTop.disabled = alignDisabled;
        UIDom.buttons.alignCenterY.disabled = alignDisabled;
        UIDom.buttons.alignBottom.disabled = alignDisabled;

        const distributeDisabled = selectedCount < 3;
        UIDom.buttons.distributeHorizontalGaps.disabled = distributeDisabled;
        UIDom.buttons.distributeVerticalGaps.disabled = distributeDisabled;

        const snapDisabled = selectedCount < 1;
        UIDom.buttons.snapLeft.disabled = snapDisabled;
        UIDom.buttons.snapRight.disabled = snapDisabled;
        UIDom.buttons.snapTop.disabled = snapDisabled;
        UIDom.buttons.snapBottom.disabled = snapDisabled;
    }


    getDuplicateSelectionObjects() {
        const active = this.canvas.getActiveObject();
        return this.resolveActionTargets(active, 'duplicate');
    }

    getSingleSelectedPrimitive() {
        const active = this.canvas.getActiveObject();
        if (!active || active.type === 'activeSelection') {
            return null;
        }
        return active.primitiveType ? active : null;
    }

    setPrimitiveControlsEnabled(enabled) {
        const controls = UIDom.panels.primitiveControls;
        if (!controls) {
            return;
        }
        controls.setAttribute('aria-disabled', enabled ? 'false' : 'true');
        UIDom.inputs.primitiveWidth.disabled = !enabled;
        UIDom.inputs.primitiveHeight.disabled = !enabled;
        UIDom.inputs.primitiveRadius.disabled = !enabled;
    }

    syncPrimitiveControlsFromSelection() {
        const primitive = this.getSingleSelectedPrimitive();
        this.isSyncingPrimitiveControls = true;
        const typeRow = UIDom.primitive.typeLabel?.parentElement;

        if (!primitive) {
            UIDom.primitive.typeLabel.textContent = '—';
            if (typeRow) {
                typeRow.style.display = 'none';
            }
            UIDom.inputs.primitiveWidth.value = '';
            UIDom.inputs.primitiveHeight.value = '';
            UIDom.inputs.primitiveRadius.value = '';
            UIDom.primitive.widthRow.style.display = 'none';
            UIDom.primitive.heightRow.style.display = 'none';
            UIDom.primitive.radiusRow.style.display = 'none';
            this.setPrimitiveControlsEnabled(false);
            this.isSyncingPrimitiveControls = false;
            return;
        }

        const dimensions = this.primitiveManager.getPrimitiveDimensions(primitive);
        if (typeRow) {
            typeRow.style.display = 'none';
        }

        if (dimensions.type === 'rect') {
            UIDom.inputs.primitiveWidth.value = dimensions.width;
            UIDom.inputs.primitiveHeight.value = dimensions.height;
            UIDom.inputs.primitiveRadius.value = '';
            UIDom.primitive.widthRow.style.display = 'block';
            UIDom.primitive.heightRow.style.display = 'block';
            UIDom.primitive.radiusRow.style.display = 'none';
            UIDom.inputs.primitiveWidth.min = Config.GEOMETRY.PRIMITIVES.RECT.MIN_WIDTH;
            UIDom.inputs.primitiveWidth.max = Config.GEOMETRY.PRIMITIVES.RECT.MAX_WIDTH;
            UIDom.inputs.primitiveHeight.min = Config.GEOMETRY.PRIMITIVES.RECT.MIN_HEIGHT;
            UIDom.inputs.primitiveHeight.max = Config.GEOMETRY.PRIMITIVES.RECT.MAX_HEIGHT;
        } else {
            UIDom.inputs.primitiveWidth.value = '';
            UIDom.inputs.primitiveHeight.value = '';
            UIDom.inputs.primitiveRadius.value = dimensions.radius;
            UIDom.primitive.widthRow.style.display = 'none';
            UIDom.primitive.heightRow.style.display = 'none';
            UIDom.primitive.radiusRow.style.display = 'block';
            UIDom.inputs.primitiveRadius.min = Config.GEOMETRY.PRIMITIVES.CIRCLE.MIN_RADIUS;
            UIDom.inputs.primitiveRadius.max = Config.GEOMETRY.PRIMITIVES.CIRCLE.MAX_RADIUS;
        }

        this.setPrimitiveControlsEnabled(true);
        this.isSyncingPrimitiveControls = false;
    }


    getSelectedContourForText() {
        const active = this.canvas.getActiveObject();
        if (!active || active.type === 'activeSelection' || active.primitiveType || active.isTextObject || active === this.layment || active === this.safeArea) {
            return null;
        }
        return active;
    }

    getSelectedTextObject() {
        const active = this.canvas.getActiveObject();
        if (!active || active.type === 'activeSelection') {
            return null;
        }
        return active.isTextObject ? active : null;
    }

    setTextPanelEnabled(enabled) {
        const panel = UIDom.texts.panel;
        if (!panel) return;
        panel.hidden = !enabled;
        panel.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    }

    getAttachedTextsForContour(contour) {
        if (!contour?.placementId) return [];
        return this.textManager.texts.filter(textObj => textObj.kind === 'attached' && textObj.ownerPlacementId === contour.placementId);
    }

    fillTextForm(textObj) {
        if (UIDom.texts.value) UIDom.texts.value.value = textObj?.text || '';
        if (UIDom.texts.fontSize) UIDom.texts.fontSize.value = Number(textObj?.fontSize) || '';
        if (UIDom.texts.angle) UIDom.texts.angle.value = Number(textObj?.angle) || 0;
        if (UIDom.texts.kind) UIDom.texts.kind.textContent = textObj?.kind || '—';
        if (UIDom.texts.role) UIDom.texts.role.textContent = textObj?.role || '—';
        if (UIDom.texts.owner) UIDom.texts.owner.textContent = Number.isFinite(textObj?.ownerPlacementId) ? String(textObj.ownerPlacementId) : '—';
    }

    syncTextControlsFromSelection() {
        const contour = this.getSelectedContourForText();
        const selectedText = this.getSelectedTextObject();
        const ownerContour = selectedText?.kind === 'attached' ? this.textManager.getContourByPlacementId(selectedText.ownerPlacementId) : null;
        const targetContour = contour || ownerContour;
        const list = UIDom.texts.list;

        if (!selectedText && !targetContour) {
            this.setTextPanelEnabled(false);
            if (list) list.innerHTML = '';
            this.fillTextForm(null);
            return;
        }

        this.setTextPanelEnabled(true);
        const freeTexts = this.textManager.texts.filter(textObj => textObj.kind === 'free');
        const listTexts = targetContour
            ? [...this.getAttachedTextsForContour(targetContour), ...freeTexts]
            : (selectedText ? [selectedText] : []);

        if (list) {
            this.isSyncingTextControls = true;
            list.innerHTML = '';
            listTexts.forEach((textObj, index) => {
                textObj.uiId = textObj.uiId || `text-${Date.now()}-${index}`;
                const option = document.createElement('option');
                option.value = textObj.uiId;
                option.textContent = `${index + 1}. ${textObj.kind} · ${textObj.role} · owner ${Number.isFinite(textObj.ownerPlacementId) ? textObj.ownerPlacementId : '—'}`;
                list.appendChild(option);
            });
            if (selectedText?.uiId) list.value = selectedText.uiId;
            list.disabled = listTexts.length === 0;
            this.isSyncingTextControls = false;
        }

        const fromList = listTexts.find(textObj => textObj.uiId === list?.value) || null;
        const formText = selectedText || fromList || listTexts[0] || null;
        if (list && formText?.uiId) {
            this.isSyncingTextControls = true;
            list.value = formText.uiId;
            this.isSyncingTextControls = false;
        }
        this.fillTextForm(formText);

        if (UIDom.texts.value) UIDom.texts.value.disabled = !formText;
        if (UIDom.texts.fontSize) UIDom.texts.fontSize.disabled = !formText;
        if (UIDom.texts.angle) UIDom.texts.angle.disabled = !formText;
        if (UIDom.texts.addFreeBtn) UIDom.texts.addFreeBtn.disabled = false;
        if (UIDom.texts.addAttachedBtn) UIDom.texts.addAttachedBtn.disabled = !targetContour;
        if (UIDom.texts.attachBtn) UIDom.texts.attachBtn.disabled = !(formText && formText.kind === 'free' && targetContour);
        if (UIDom.texts.detachBtn) UIDom.texts.detachBtn.disabled = !(formText && formText.kind === 'attached');
        if (UIDom.texts.deleteBtn) UIDom.texts.deleteBtn.disabled = !formText;
    }

    getEditingTextObject() {
        const selected = this.getSelectedTextObject();
        if (selected) return selected;
        const listValue = UIDom.texts.list?.value;
        return this.textManager.texts.find(textObj => textObj.uiId === listValue) || null;
    }

    applyTextValueFromInput(value) {
        const textObj = this.getEditingTextObject();
        if (!textObj) return;
        textObj.set({ text: value });
        textObj.dirty = true;
        textObj.setCoords();
        this.canvas.requestRenderAll();
        this.scheduleWorkspaceSave();
    }

    applyTextFontSizeFromInput(value) {
        const textObj = this.getEditingTextObject();
        const fontSize = Number(value);
        if (!textObj || !Number.isFinite(fontSize) || fontSize <= 0) return;
        textObj.set({ fontSize });
        textObj.fontSizeMm = fontSize;
        textObj.setCoords();
        this.canvas.requestRenderAll();
        this.scheduleWorkspaceSave();
    }

    applyTextAngleFromInput(value) {
        const textObj = this.getEditingTextObject();
        const angle = Number(value);
        if (!textObj || !Number.isFinite(angle)) return;
        textObj.set({ angle });
        if (textObj.kind === 'attached') {
            this.textManager.updateAttachedTextAnchorFromAbsolute(textObj);
        }
        textObj.setCoords();
        this.canvas.requestRenderAll();
        this.scheduleWorkspaceSave();
    }

    addFreeTextForSelection() {
        const text = UIDom.texts.value?.value || '';
        const left = this.layment.left + 20;
        const top = this.layment.top + 20;
        const textObj = this.textManager.createFreeText({ text, left, top, role: 'user-text' });
        this.canvas.setActiveObject(textObj);
        this.canvas.requestRenderAll();
        this.syncTextControlsFromSelection();
        this.scheduleWorkspaceSave();
    }

    addAttachedTextForSelection() {
        const selectedText = this.getSelectedTextObject();
        const contour = this.getSelectedContourForText() || (selectedText?.kind === 'attached' ? this.textManager.getContourByPlacementId(selectedText.ownerPlacementId) : null);
        if (!contour) return;
        const text = UIDom.texts.value?.value || '';
        const textObj = this.textManager.createAttachedText(contour, { text, role: 'user-text' });
        if (!textObj) return;
        this.canvas.setActiveObject(textObj);
        this.canvas.requestRenderAll();
        this.syncTextControlsFromSelection();
        this.scheduleWorkspaceSave();
    }

    attachSelectedTextToSelectionContour() {
        const textObj = this.getEditingTextObject();
        const contour = this.getSelectedContourForText();
        if (!textObj || !contour) return;
        this.textManager.attachTextToContour(textObj, contour, 'user-text');
        this.canvas.requestRenderAll();
        this.syncTextControlsFromSelection();
        this.scheduleWorkspaceSave();
    }

    detachSelectedText() {
        const textObj = this.getEditingTextObject();
        if (!textObj || textObj.kind !== 'attached') return;
        this.textManager.detachText(textObj);
        this.canvas.requestRenderAll();
        this.syncTextControlsFromSelection();
        this.scheduleWorkspaceSave();
    }

    deleteSelectedText() {
        const selectedText = this.getEditingTextObject();
        if (!selectedText) return;
        this.textManager.removeText(selectedText);
        this.canvas.discardActiveObject();
        this.canvas.requestRenderAll();
        this.syncTextControlsFromSelection();
        this.scheduleWorkspaceSave();
    }

    applyPrimitiveDimensionsFromInputs() {
        if (this.isSyncingPrimitiveControls) {
            return;
        }

        const primitive = this.getSingleSelectedPrimitive();
        if (!primitive) {
            return;
        }

        const dimensions = this.primitiveManager.getPrimitiveDimensions(primitive);
        const prevDimensions = { ...dimensions };
        let applied = false;

        if (dimensions.type === 'rect') {
            const width = parseInt(UIDom.inputs.primitiveWidth.value, 10);
            const height = parseInt(UIDom.inputs.primitiveHeight.value, 10);
            if (!Number.isFinite(width) || !Number.isFinite(height)) {
                return;
            }
            applied = this.primitiveManager.applyDimensions(primitive, { width, height });
        } else if (dimensions.type === 'circle') {
            const radius = parseInt(UIDom.inputs.primitiveRadius.value, 10);
            if (!Number.isFinite(radius)) {
                return;
            }
            applied = this.primitiveManager.applyDimensions(primitive, { radius });
        }

        this.syncPrimitiveControlsFromSelection();
        this.updateStatusBar();

        if (applied) {
            const nextDimensions = this.primitiveManager.getPrimitiveDimensions(primitive);
            const changed = JSON.stringify(prevDimensions) !== JSON.stringify(nextDimensions);
            if (changed) {
                this.scheduleWorkspaceSave();
            }
        }
    }

    //  подписка на события для статус-бара
    setupStatusBarUpdates() {
        this.canvas.on('selection:created', () => this.updateStatusBar());
        this.canvas.on('selection:updated', () => this.updateStatusBar());
        this.canvas.on('selection:cleared', () => this.updateStatusBar());

        // Обновление при перемещении и вращении
        this.canvas.on('object:moving', () => this.updateStatusBar());
        this.canvas.on('object:rotating', () => this.updateStatusBar());
        this.canvas.on('object:modified', () => this.updateStatusBar());
    }

    buildCategories(items) {
        const categories = new Map();
        items.forEach(item => {
            const label = this.getCategoryLabel(item);
            if (!categories.has(label)) {
                categories.set(label, label);
            }
        });
        return Array.from(categories.keys()).sort((a, b) => a.localeCompare(b, 'ru'));
    }

    buildArticleEntries(items) {
        const entries = new Map();
        items.forEach(item => {
            const article = (item?.article || item?.id || "").trim();
            if (!article) {
                return;
            }
            if (!entries.has(article)) {
                entries.set(article, {
                    article,
                    name: item.name || "",
                    category: item.category || "",
                    variants: []
                });
            }
            const entry = entries.get(article);
            entry.variants.push(item);
            if (!entry.name && item.name) {
                entry.name = item.name;
            }
        });

        return Array.from(entries.values())
            .map(entry => ({
                ...entry,
                variants: entry.variants.slice().sort((a, b) => ((a.poseLabel || a.poseKey || "").localeCompare(b.poseLabel || b.poseKey || "", "ru")))
            }))
            .sort((a, b) => `${a.article} ${a.name}`.localeCompare(`${b.article} ${b.name}`, "ru"));
    }

    getVariantDisplayLabel(item) {
        if (!item) {
            return "Базовый";
        }
        return item.poseLabel || item.poseKey || "Базовый";
    }

    getCategoryLabel(item) {
        const raw = (item.category || '').trim();
        if (!raw) {
            return 'Без категории';
        }
        const label = this.categoryLabels?.[raw]?.label;
        return label ? label.trim() || raw : raw;
    }

    setCurrentCategory(category) {
        this.currentCategory = category;
        this.renderCatalogNav();
        this.renderCatalogList();
    }

    ensureValidCategory() {
        if (this.currentCategory && !this.availableCategories.includes(this.currentCategory)) {
            this.currentCategory = null;
        }
    }

    renderCatalogNav() {
        const hasCategory = !!this.currentCategory;
        UIDom.catalog.breadcrumbSeparator.style.display = hasCategory ? 'inline' : 'none';
        UIDom.catalog.breadcrumbCurrent.style.display = hasCategory ? 'inline' : 'none';
        UIDom.catalog.breadcrumbCurrent.textContent = hasCategory ? this.currentCategory : '';

        UIDom.catalog.categorySelect.innerHTML = '';
        const allOption = document.createElement('option');
        allOption.value = '';
        allOption.textContent = 'Все категории';
        UIDom.catalog.categorySelect.appendChild(allOption);

        this.availableCategories.forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            UIDom.catalog.categorySelect.appendChild(option);
        });

        UIDom.catalog.categorySelect.value = this.currentCategory || '';
    }

    renderCatalogList() {
        const list = UIDom.panels.catalogList;
        list.innerHTML = '';

        if (!this.availableArticleEntries.length) {
            return;
        }

        const hasQuery = Boolean(this.catalogQuery.trim());

        if (!this.currentCategory) {
            if (!hasQuery) {
                this.renderFolderRows(list, this.availableCategories);
                return;
            }

            const items = this.availableArticleEntries.filter(item => this.matchesItemQuery(item));
            this.renderItemRows(list, items, { showCategoryLabel: true });
            return;
        }

        const items = this.availableArticleEntries
            .filter(item => this.getCategoryLabel(item) === this.currentCategory)
            .filter(item => this.matchesItemQuery(item));
        this.renderItemRows(list, items);
    }

    matchesItemQuery(item) {
        const query = this.catalogQuery.trim().toLowerCase();
        if (!query) {
            return true;
        }

        const variants = Array.isArray(item.variants) ? item.variants : [item];
        const fields = [
            item.article,
            item.name,
            ...variants.map(variant => variant?.poseLabel),
            ...variants.map(variant => variant?.poseKey),
            ...variants.map(variant => variant?.name)
        ]
            .filter(Boolean)
            .map(value => String(value).toLowerCase());
        return fields.some(value => value.includes(query));
    }

    renderFolderRows(list, categories) {
        if (!categories.length) {
            const empty = document.createElement('div');
            empty.className = 'catalog-row';
            empty.textContent = 'Категории не найдены';
            list.appendChild(empty);
            return;
        }

        categories.forEach(category => {
            const row = document.createElement('div');
            row.className = 'catalog-row';
            row.addEventListener('click', () => this.setCurrentCategory(category));

            const icon = document.createElement('span');
            icon.className = 'catalog-folder-icon';
            icon.textContent = '📁';

            const name = document.createElement('span');
            name.className = 'catalog-folder-name';
            name.textContent = category;

            row.appendChild(icon);
            row.appendChild(name);
            list.appendChild(row);
        });
    }

    renderItemRows(list, items, options = {}) {
        const { showCategoryLabel = false } = options;

        if (!items.length) {
            const empty = document.createElement('div');
            empty.className = 'catalog-row';
            empty.textContent = 'Контуры не найдены';
            list.appendChild(empty);
            return;
        }

        items.forEach(entry => {
            const selectedVariant = entry.variants[0];
            const row = document.createElement('div');
            row.className = 'catalog-row';

            const previewWrapper = this.createPreviewElement(selectedVariant);

            const meta = document.createElement('div');
            meta.className = 'catalog-item-meta';

            const article = document.createElement('div');
            article.className = 'catalog-item-article';
            article.textContent = entry.article || '';

            const name = document.createElement('div');
            name.className = 'catalog-item-name';
            name.textContent = entry.name || selectedVariant?.name || '';

            meta.appendChild(article);
            meta.appendChild(name);

            if (entry.variants.length > 1) {
                const variantSelect = document.createElement('select');
                variantSelect.className = 'catalog-variant-select';
                entry.variants.forEach((variant, index) => {
                    const option = document.createElement('option');
                    option.value = String(index);
                    option.textContent = this.getVariantDisplayLabel(variant);
                    variantSelect.appendChild(option);
                });
                variantSelect.addEventListener('click', event => event.stopPropagation());
                variantSelect.addEventListener('change', event => {
                    const variant = entry.variants[Number(event.target.value)] || entry.variants[0];
                    row.dataset.selectedVariantIndex = event.target.value;
                    name.textContent = variant?.name || entry.name || '';
                });
                meta.appendChild(variantSelect);
            }

            if (showCategoryLabel) {
                const category = this.getCategoryLabel(entry);
                if (category) {
                    const categoryLabel = document.createElement('div');
                    categoryLabel.className = 'catalog-item-article';
                    categoryLabel.textContent = category;
                    meta.appendChild(categoryLabel);
                }
            }

            const addButton = document.createElement('button');
            addButton.type = 'button';
            addButton.className = 'catalog-add-button';
            addButton.textContent = '+';
            addButton.addEventListener('click', event => {
                event.stopPropagation();
                const variantIndex = Number(row.dataset.selectedVariantIndex || 0);
                const variant = entry.variants[variantIndex] || entry.variants[0];
                this.addContour(variant);
            });

            row.addEventListener('click', () => {
                const variantIndex = Number(row.dataset.selectedVariantIndex || 0);
                const variant = entry.variants[variantIndex] || entry.variants[0];
                this.addContour(variant);
            });

            row.appendChild(previewWrapper);
            row.appendChild(meta);
            row.appendChild(addButton);
            list.appendChild(row);
        });
    }

    createPreviewElement(item) {
        const previewAsset = item.assets?.preview;
        if (previewAsset) {
            const img = document.createElement('img');
            img.className = 'catalog-item-preview';
            img.alt = item.name || '';
            img.loading = 'lazy';
            img.src = `/contours/${previewAsset}`;
            img.onerror = () => {
                const placeholder = this.createPreviewPlaceholder();
                img.replaceWith(placeholder);
            };
            return img;
        }
        return this.createPreviewPlaceholder();
    }

    createPreviewPlaceholder() {
        const placeholder = document.createElement('div');
        placeholder.className = 'catalog-preview-placeholder';
        placeholder.textContent = 'Нет превью';
        return placeholder;
    }

    // обновление строки состояния
    updateStatusBar() {
        const statusEl = UIDom.status.info;
        const active = this.canvas.getActiveObject();

        if (!active || active.type === 'activeSelection') {
            statusEl.textContent = 'Выберите контур или выемку';
            return;
        }

        if (active.primitiveType === 'rect' || active.primitiveType === 'circle') {
            const dimensions = this.primitiveManager.getPrimitiveDimensions(active);
            const laymentBbox = this.layment.getBoundingRect(true);

            if (active.primitiveType === 'rect') {
                const bbox = active.getBoundingRect(true);
                const realX = (bbox.left - laymentBbox.left).toFixed(1);
                const realY = (bbox.top - laymentBbox.top).toFixed(1);
                statusEl.innerHTML = `<strong>Выемка · прямоугольная</strong> X ${realX} мм · Y ${realY} мм · W ${dimensions.width} мм · H ${dimensions.height} мм`;
                return;
            }

            const realX = (active.left - laymentBbox.left).toFixed(1);
            const realY = (active.top - laymentBbox.top).toFixed(1);
            statusEl.innerHTML = `<strong>Выемка · круглая</strong> X ${realX} мм · Y ${realY} мм · R ${dimensions.radius} мм`;
            return;
        }

        // Находим оригинальную группу контура в массиве contourManager.contours
        const contour = this.contourManager.contours.find(c =>
            c === active || (active.getObjects && active.getObjects().includes(c))
        );

        if (!contour) {
            statusEl.textContent = 'Контур не найден';
            return;
        }

        const meta = this.contourManager.metadataMap.get(contour);
        const tl = contour.aCoords.tl;  //берем координаты левыго верхнего угла контура
        const realX = (tl.x - this.layment.left).toFixed(1);
        const realY = (tl.y - this.layment.top).toFixed(1);

        const article = meta.article || '—';
        statusEl.innerHTML = `<strong>${meta.name}</strong> арт. ${article} · X ${realX} мм · Y ${realY} мм · ${contour.angle}°`; 
    }

    deleteSelected() {
        const active = this.canvas.getActiveObject();
        if (!active) return;

        const objects = this.resolveActionTargets(active, 'delete');
        // КРИТИЧНО: сначала убираем activeSelection, потом удаляем объекты
        this.batchRender(() => {
            this.canvas.discardActiveObject();
            for (const o of objects) {
              if (!o) continue;
              if (o.isTextObject) {
                this.textManager.removeText(o);
                continue;
              }

              if (o.primitiveType) {
                this.primitiveManager.removePrimitive(o, false);
                continue;
              }
              // contour
              if (this.textManager.removeTextsForPlacementId && o.placementId != null) {
                this.textManager.removeTextsForPlacementId(o.placementId);
              }

              this.contourManager.removeContour(o, false);
            }
        });

      if (this.actionExecutor?.finalizeCanvasAction) {
          const ctx = this.actionExecutor.buildActionContext(this, 'delete');
          this.actionExecutor.finalizeCanvasAction(ctx);
      } else {
          this.updateButtons();
          this.updateStatusBar?.();
          this.syncPrimitiveControlsFromSelection();
          this.syncTextControlsFromSelection();
          this.scheduleWorkspaceSave();
      }
    }


    async duplicateSelected() {
        const DUPLICATE_OFFSET = 16;
        const selected = this.getDuplicateSelectionObjects();
        if (!selected.length) {
            return;
        }

        const newObjects = [];

        await this.batchRender(async () => {
            this.canvas.discardActiveObject();

            for (const obj of selected) {
                if (obj.primitiveType === 'rect') {
                    const copy = this.primitiveManager.addPrimitive(
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
                    const copy = this.primitiveManager.addPrimitive(
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

                const meta = this.contourManager.metadataMap.get(obj);
                if (!meta?.assets?.svg) {
                    continue;
                }

                const contourCenter = obj.getCenterPoint();
                await this.contourManager.addContour(
                    `/contours/${meta.assets.svg}`,
                    { x: contourCenter.x + DUPLICATE_OFFSET, y: contourCenter.y + DUPLICATE_OFFSET },
                    meta
                );
                const duplicatedContour = this.contourManager.contours[this.contourManager.contours.length - 1];
                duplicatedContour.set({ angle: obj.angle || 0 });
                duplicatedContour.setCoords();
                newObjects.push(duplicatedContour);

                const sourceLabel = this.textManager.getAttachedTextByPlacementId(obj.placementId);
                if (sourceLabel) {
                    const duplicatedLabel = this.textManager.createAttachedText(duplicatedContour, {
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
            }
        });

        this.restoreActiveSelection(newObjects);
        this.canvas.requestRenderAll();
        this.updateButtons();
        this.updateStatusBar();
        this.syncPrimitiveControlsFromSelection();
        this.syncTextControlsFromSelection();
        this.scheduleWorkspaceSave();
    }

    rotateSelected() {
        const active = this.canvas.getActiveObject();
        const [obj] = this.resolveActionTargets(active, 'rotate');
        if (!obj) {
            return;
        }
        const next = (obj.angle + 90) % 360;
        this.contourManager.rotateContour(obj, next);
        this.scheduleWorkspaceSave();
    }

    shouldAutosaveForObject(obj) {
        if (!obj || this.isRestoringWorkspace) {
            return false;
        }
        return obj !== this.layment && obj !== this.safeArea;
    }

    cancelAutosave() {
        if (this.autosaveTimer) {
            clearTimeout(this.autosaveTimer);
            this.autosaveTimer = null;
        }
    }

    scheduleWorkspaceSave() {
        if (this.isRestoringWorkspace) {
            return;
        }
        this.cancelAutosave();
        this.autosaveTimer = setTimeout(() => {
            this.autosaveTimer = null;
            this.saveWorkspace('autosave');
        }, AUTOSAVE_DEBOUNCE_MS);
    }

    buildWorkspaceSnapshot() {
        const layment = this.canvas.layment;
        return {
            schemaVersion: 3,
            savedAt: new Date().toISOString(),
            layment: {
                width: Math.round(layment.width),
                height: Math.round(layment.height),
                offset: layment.left
            },
            workspaceScale: 1,
            baseMaterialColor: this.baseMaterialColor,
            laymentThicknessMm: this.laymentThicknessMm,
            contours: this.contourManager.getWorkspaceContoursData(),
            primitives: this.contourManager.getPrimitivesData(),
            texts: this.textManager.getWorkspaceTextsData()
        };
    }

    async saveWorkspace(mode = 'autosave') {
        const key = mode === 'manual' ? WORKSPACE_MANUAL_KEY : WORKSPACE_STORAGE_KEY;
        try {
            await this.performWithScaleOne(() => {
                const payload = this.buildWorkspaceSnapshot();
                localStorage.setItem(key, JSON.stringify(payload));
            });
        } catch (err) {
            console.error('Ошибка сохранения workspace', err);
        }
    }

    async loadWorkspaceFromStorage(mode = 'autosave') {
        this.cancelAutosave();
        const key = mode === 'manual' ? WORKSPACE_MANUAL_KEY : WORKSPACE_STORAGE_KEY;
        const raw = localStorage.getItem(key);
        if (!raw) {
            return false;
        }

        let data;
        try {
            data = JSON.parse(raw);
        } catch (err) {
            console.error('Ошибка чтения workspace', err);
            return false;
        }

        if (data.schemaVersion !== 3) {
            console.warn('Неподдерживаемая версия workspace', data.schemaVersion);
            return false;
        }

        try {
            await this.loadWorkspace(data);
            return true;
        } finally {
            this.fitToLayment();
        }
    }

    async loadWorkspace(data) {
        this.cancelAutosave();
        this.isRestoringWorkspace = true;
        try {
            await this.performWithScaleOne(async () => {
                await this.batchRender(() => {
                    this.canvas.discardActiveObject();
                    this.contourManager.clearContours();
                    this.primitiveManager.clearPrimitives();
                    this.textManager.clearTexts();
                });

            const offset = typeof data.layment?.offset === 'number' ? data.layment.offset : this.laymentOffset;
            const width = data.layment?.width || Config.LAYMENT_DEFAULT_WIDTH;
            const height = data.layment?.height || Config.LAYMENT_DEFAULT_HEIGHT;
            this.laymentOffset = offset;

            this.baseMaterialColor = Config.MATERIAL_COLORS[data.baseMaterialColor]
                ? data.baseMaterialColor
                : Config.DEFAULT_MATERIAL_COLOR;
            if (UIDom.inputs.baseMaterialColor) {
                UIDom.inputs.baseMaterialColor.value = this.baseMaterialColor;
            }
            this.applyMaterialColorToCutouts();

            this.laymentThicknessMm = this.getValidLaymentThickness(data.laymentThicknessMm);
            if (UIDom.inputs.laymentThicknessMm) {
                UIDom.inputs.laymentThicknessMm.value = String(this.laymentThicknessMm);
            }

            UIDom.inputs.laymentWidth.value = width;
            UIDom.inputs.laymentHeight.value = height;
            this.syncLaymentPresetBySize(width, height);
            this.updateLaymentSize(width, height);
            this.layment.set({ left: offset, top: offset });
            this.layment.setCoords();
            this.syncSafeAreaRect();

            await this.batchRender(async () => {
                for (const contour of data.contours || []) {
                    const meta = this.manifest?.[contour.id];
                    if (!meta) {
                        console.warn('Контур не найден в manifest', contour.id);
                        continue;
                    }
                    const metadata = {
                        ...meta,
                        article: contour.article || meta.article,
                        name: contour.name || meta.name,
                        poseKey: contour.poseKey || meta.poseKey,
                        poseLabel: contour.poseLabel || meta.poseLabel,
                        scaleOverride: contour.scaleOverride ?? meta.scaleOverride,
                        depthOverrideMm: Number.isFinite(contour.depthOverrideMm)
                            ? contour.depthOverrideMm
                            : (Number.isFinite(meta.depthOverrideMm) ? meta.depthOverrideMm : undefined)
                    };
                    await this.contourManager.addContour(
                        `/contours/${metadata.assets.svg}`,
                        { x: this.layment.left, y: this.layment.top },
                        metadata
                    );
                    const added = this.contourManager.contours[this.contourManager.contours.length - 1];
                    added.placementId = contour.placementId;
                    added.angle = contour.angle || 0;
                    added.setCoords();
                    const targetX = this.layment.left + contour.x;
                    const targetY = this.layment.top + contour.y;
                    const tl = added.aCoords.tl;
                    added.set({
                        left: added.left + (targetX - tl.x),
                        top: added.top + (targetY - tl.y)
                    });
                    added.setCoords();
                }
            });

            const placementIds = this.contourManager.contours
                .map(c => c.placementId)
                .filter(id => Number.isFinite(id));
            const maxPlacementId = placementIds.length ? Math.max(...placementIds) : 0;
            this.contourManager.nextPlacementSeq = maxPlacementId + 1;

            const savedTexts = this.textManager.normalizeWorkspaceTexts(data.texts);
            for (const savedText of savedTexts) {
                if (savedText.kind === 'free') {
                    this.textManager.createFreeText({
                        text: savedText.text,
                        role: savedText.role,
                        left: this.layment.left + savedText.x,
                        top: this.layment.top + savedText.y,
                        fontSizeMm: savedText.fontSizeMm
                    });
                    continue;
                }

                const contour = this.contourManager.contours.find(c => c.placementId === savedText.ownerPlacementId);
                if (!contour) {
                    continue;
                }
                this.textManager.createAttachedText(contour, {
                    text: savedText.text,
                    role: savedText.role,
                    left: this.layment.left + savedText.x,
                    top: this.layment.top + savedText.y,
                    fontSizeMm: savedText.fontSizeMm,
                    localOffsetX: savedText.localOffsetX,
                    localOffsetY: savedText.localOffsetY,
                    localAngle: savedText.localAngle
                });
            }

            await this.batchRender(() => {
                for (const primitive of data.primitives || []) {
                    const x = this.layment.left + primitive.x;
                    const y = this.layment.top + primitive.y;
                    if (primitive.type === 'rect') {
                        this.primitiveManager.addPrimitive('rect', { x, y }, { width: primitive.width, height: primitive.height }, { pocketDepthMm: primitive.pocketDepthMm });
                    } else if (primitive.type === 'circle') {
                        this.primitiveManager.addPrimitive('circle', { x, y }, { radius: primitive.radius }, { pocketDepthMm: primitive.pocketDepthMm });
                    }
                }
            });

                this.applyMaterialColorToCutouts();
                this.canvas.requestRenderAll();
                this.updateButtons();
                this.updateStatusBar();
                this.syncPrimitiveControlsFromSelection();
                this.syncTextControlsFromSelection();
            });
        } finally {
            this.isRestoringWorkspace = false;
        }
        this.syncWorkspaceScaleInput();
    }

    getTotalCuttingLength() {
        return this.contourManager.getPlacedContourIds()
        .reduce((sum, id) => {
            const item = this.manifest?.[id];
            return sum + (item?.cuttingLengthMeters || 0);
      }, 0);
    }


    formatLayoutIssuesMessage(issues) {
        const lines = [];
        const hasOutOfBounds = (issues.outOfBoundsContours + issues.outOfBoundsPrimitives) > 0;
        const hasCollision = issues.collisionContours > 0;

        if (hasOutOfBounds) {
            lines.push(Config.MESSAGES.OUT_OF_BOUNDS_ERROR);
        }
        if (hasCollision) {
            lines.push(Config.MESSAGES.TOO_CLOSE_ERROR);
        }

        if (lines.length === 0) {
            return Config.MESSAGES.EXPORT_ERROR;
        }

        return lines.join('\n');
    }

    clearOrderResult() {
        const orderResult = UIDom.orderResult;
        if (!orderResult.container) return;

        orderResult.container.hidden = true;
        orderResult.container.classList.remove('order-result-success', 'order-result-error', 'order-result-info', 'order-result-loading');
        orderResult.title.textContent = '';
        orderResult.message.textContent = '';
        orderResult.details.hidden = true;
        orderResult.orderNumber.textContent = '—';
        orderResult.orderId.textContent = '—';
        orderResult.statusLinkRow.hidden = true;
        orderResult.paymentLink.textContent = 'Перейти к странице статуса';
        orderResult.paymentLink.href = '#';
        orderResult.meta.hidden = true;
        orderResult.meta.textContent = '';
        this.lastOrderResult = null;
    }

    showOrderResultLoading(message = 'Создаём заказ. Это может занять несколько секунд.') {
        const orderResult = UIDom.orderResult;
        if (!orderResult.container) return;

        orderResult.container.hidden = false;
        orderResult.container.classList.remove('order-result-success', 'order-result-error', 'order-result-info');
        orderResult.container.classList.add('order-result-loading');
        orderResult.title.textContent = 'Оформление заказа';
        orderResult.message.textContent = message;
        orderResult.details.hidden = true;
    }

    showOrderResultSuccess({ orderId, orderNumber, paymentUrl, width, height, laymentThicknessMm, total }) {
        const orderResult = UIDom.orderResult;
        if (!orderResult.container) return;

        orderResult.container.hidden = false;
        orderResult.container.classList.remove('order-result-error', 'order-result-info', 'order-result-loading');
        orderResult.container.classList.add('order-result-success');
        orderResult.title.textContent = 'Заказ создан';
        orderResult.message.textContent = 'Мы приняли заказ в обработку. Вы можете отслеживать статус по ссылке ниже.';

        orderResult.details.hidden = false;
        orderResult.orderNumber.textContent = orderNumber || '—';
        orderResult.orderId.textContent = orderId;
        orderResult.paymentLink.href = paymentUrl;
        orderResult.statusLinkRow.hidden = false;
        orderResult.meta.hidden = false;
        orderResult.meta.textContent = `Размер: ${width}×${height}×${laymentThicknessMm ?? 35} мм • Стоимость: ${total} ₽`;
        this.lastOrderResult = { orderId, orderNumber, paymentUrl, width, height, laymentThicknessMm, total };
    }

    showOrderResultError(message) {
        const orderResult = UIDom.orderResult;
        if (!orderResult.container) return;

        orderResult.container.hidden = false;
        orderResult.container.classList.remove('order-result-success', 'order-result-info', 'order-result-loading');
        orderResult.container.classList.add('order-result-error');
        orderResult.title.textContent = 'Не удалось создать заказ';
        orderResult.message.textContent = message;
        orderResult.details.hidden = true;
    }

    show3dPreviewError(message) {
        const orderResult = UIDom.orderResult;
        if (!orderResult.container) return;

        orderResult.container.hidden = false;
        orderResult.container.classList.remove('order-result-success', 'order-result-loading');
        orderResult.container.classList.add('order-result-error');
        orderResult.title.textContent = '3D предпросмотр недоступен';
        orderResult.message.textContent = message;
        orderResult.details.hidden = true;
    }

    checkOutOfBoundsOnlyAndHighlight() {
        const issues = {
            outOfBoundsContours: 0,
            collisionContours: 0,
            outOfBoundsPrimitives: 0
        };

        const layment = this.canvas?.layment;
        if (!layment) {
            return { ok: true, issues };
        }

        const problematic = new Set();

        this.contourManager.contours.forEach(obj => {
            this.contourManager.resetPropertiesRecursive(obj, {
                stroke: Config.COLORS.CONTOUR.NORMAL,
                strokeWidth: Config.COLORS.CONTOUR.NORMAL_STROKE_WIDTH,
                opacity: 1,
                borderColor: Config.COLORS.SELECTION.BORDER,
                cornerColor: Config.COLORS.SELECTION.CORNER,
                fill: Config.COLORS.CONTOUR.FILL
            });
        });

        this.primitiveManager.primitives.forEach(obj => {
            this.contourManager.resetPropertiesRecursive(obj, {
                stroke: Config.COLORS.PRIMITIVE.STROKE,
                strokeWidth: 1,
                opacity: 1,
                borderColor: Config.COLORS.SELECTION.BORDER,
                cornerColor: Config.COLORS.SELECTION.CORNER,
                fill: Config.COLORS.PRIMITIVE.FILL
            });
        });

        const padding = Config.GEOMETRY.LAYMENT_PADDING * layment.scaleX;
        const lWidth = layment.width * layment.scaleX;
        const lHeight = layment.height * layment.scaleY;

        this.contourManager.contours.forEach(obj => {
            const box = obj.getBoundingRect(true);
            if (box.left < layment.left + padding
                || box.top < layment.top + padding
                || box.left + box.width > layment.left + lWidth - padding
                || box.top + box.height > layment.top + lHeight - padding) {
                problematic.add(obj);
                issues.outOfBoundsContours += 1;
            }
        });

        this.primitiveManager.primitives.forEach(obj => {
            const box = obj.getBoundingRect(true);
            if (box.left < layment.left + padding
                || box.top < layment.top + padding
                || box.left + box.width > layment.left + lWidth - padding
                || box.top + box.height > layment.top + lHeight - padding) {
                problematic.add(obj);
                issues.outOfBoundsPrimitives += 1;
            }
        });

        problematic.forEach(obj => {
            if (obj.primitiveType) {
                obj.set({
                    stroke: Config.COLORS.PRIMITIVE.ERROR,
                    strokeWidth: 3,
                    opacity: 0.85
                });
            } else {
                this.contourManager.resetPropertiesRecursive(obj, {
                    stroke: Config.COLORS.CONTOUR.ERROR,
                    strokeWidth: Config.COLORS.CONTOUR.ERROR_STROKE_WIDTH,
                    opacity: 0.85,
                    borderColor: Config.COLORS.SELECTION.ERROR_BORDER,
                    cornerColor: Config.COLORS.SELECTION.ERROR_CORNER
                });
            }
            obj.setCoords();
        });

        this.canvas.renderAll();
        return {
            ok: problematic.size === 0,
            issues
        };
    }

    formatOutOfBoundsOnlyMessage(issues) {
        const hasOutOfBounds = (issues.outOfBoundsContours + issues.outOfBoundsPrimitives) > 0;
        if (!hasOutOfBounds) {
            return Config.MESSAGES.EXPORT_ERROR;
        }
        return Config.MESSAGES.OUT_OF_BOUNDS_ERROR;
    }

    open3dPreview() {
        this.performWithScaleOne(() => {
            const boundsValidation = this.checkOutOfBoundsOnlyAndHighlight();
            if (!boundsValidation.ok) {
                this.show3dPreviewError(this.formatOutOfBoundsOnlyMessage(boundsValidation.issues));
                return;
            }

            let svg;
            try {
                svg = this.buildPreviewSvg();
            } catch (error) {
                console.error(error);
                this.show3dPreviewError('Не удалось собрать SVG для 3D предпросмотра. Попробуйте ещё раз.');
                return;
            }

            try {
                const payloadKey = this.storePreviewSvgPayload(svg);
                const viewerUrl = new URL(Config.VIEWER_3D.URL, window.location.origin);
                viewerUrl.searchParams.set('payloadKey', payloadKey);
                window.open(viewerUrl.toString(), '_blank', 'noopener');
            } catch (error) {
                console.error(error);
                this.show3dPreviewError('Не удалось подготовить данные для 3D предпросмотра (localStorage недоступен или переполнен).');
            }
        });
    }

    buildPreviewSvg() {
        const labels = this.canvas.getObjects().filter(obj => obj?.isTextObject);
        const prev = labels.map(label => ({
            label,
            visible: label.visible
        }));

        labels.forEach(label => label.set('visible', false));
        this.canvas.requestRenderAll();

        try {
            return this.canvas.toSVG();
        } finally {
            prev.forEach(({ label, visible }) => label.set('visible', visible));
            this.canvas.requestRenderAll();
        }
    }

    generatePreviewPayloadKey() {
        const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        return `${Config.VIEWER_3D.PAYLOAD_PREFIX}${rand}`;
    }

    cleanupOldPreviewPayloads() {
        const prefix = Config.VIEWER_3D.PAYLOAD_PREFIX;
        const now = Date.now();
        const maxAgeMs = 1000 * 60 * 30;

        for (let i = localStorage.length - 1; i >= 0; i -= 1) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith(prefix)) {
                continue;
            }

            try {
                const raw = localStorage.getItem(key);
                if (!raw) {
                    localStorage.removeItem(key);
                    continue;
                }
                const payload = JSON.parse(raw);
                const createdAt = Number(payload?.createdAt || 0);
                if (!Number.isFinite(createdAt) || (now - createdAt) > maxAgeMs) {
                    localStorage.removeItem(key);
                }
            } catch (_error) {
                localStorage.removeItem(key);
            }
        }
    }

    storePreviewSvgPayload(svg) {
        if (!svg || typeof svg !== 'string') {
            throw new Error('Preview SVG payload is empty');
        }

        this.cleanupOldPreviewPayloads();

        const key = this.generatePreviewPayloadKey();
        const payload = {
            version: 2,
            svg,
            baseMaterialColor: this.baseMaterialColor,
            laymentThicknessMm: this.laymentThicknessMm,
            createdAt: Date.now()
        };

        localStorage.setItem(key, JSON.stringify(payload));
        return key;
    }



    getColorLabel(colorKey) {
        if (colorKey === 'blue') {
            return 'синий';
        }
        return 'зелёный';
    }

    buildCustomerModalSummaryData() {
        const width = Math.round(this.layment?.width || 0);
        const height = Math.round(this.layment?.height || 0);
        const thickness = this.getValidLaymentThickness(this.laymentThicknessMm);
        const colorLabel = this.getColorLabel(this.baseMaterialColor);

        const grouped = new Map();
        for (const contour of this.contourManager.contours) {
            const meta = this.contourManager.metadataMap.get(contour) || {};
            const key = (meta.article || meta.id || contour.contourId || '—').toString();
            const name = meta.name ? String(meta.name) : '';
            if (!grouped.has(key)) {
                grouped.set(key, { article: key, name, count: 0 });
            }
            const item = grouped.get(key);
            item.count += 1;
            if (!item.name && name) {
                item.name = name;
            }
        }

        const composition = Array.from(grouped.values()).sort((a, b) => a.article.localeCompare(b.article, 'ru'));

        return { width, height, thickness, colorLabel, composition };
    }

    renderCustomerModalSummary() {
        const modal = UIDom.customerModal;
        if (!modal?.summaryMeta || !modal.summaryComposition || !modal.summaryEmpty) {
            return;
        }

        const summary = this.buildCustomerModalSummaryData();
        modal.summaryMeta.innerHTML = `
            <div><strong>Размер:</strong> ${summary.width} × ${summary.height} мм</div>
            <div><strong>Толщина:</strong> ${summary.thickness} мм</div>
            <div><strong>Цвет:</strong> ${summary.colorLabel}</div>
        `;

        modal.summaryComposition.innerHTML = '';
        if (!summary.composition.length) {
            modal.summaryEmpty.hidden = false;
            return;
        }

        modal.summaryEmpty.hidden = true;
        for (const item of summary.composition) {
            const li = document.createElement('li');
            const suffix = item.name ? ` — ${item.name}` : '';
            li.textContent = `${item.article}${suffix} × ${item.count}`;
            modal.summaryComposition.appendChild(li);
        }
    }

    openCustomerModal() {
        const modal = UIDom.customerModal;
        if (!modal?.overlay) {
            return;
        }
        modal.overlay.hidden = false;
        this.clearCustomerModalFeedback();
        this.renderCustomerModalSummary();
        if (modal.confirmButton) {
            modal.confirmButton.disabled = !(modal.nameInput?.value.trim() && modal.contactInput?.value.trim());
        }
        modal.nameInput?.focus();
    }

    closeCustomerModal() {
        const modal = UIDom.customerModal;
        if (!modal?.overlay) {
            return;
        }
        modal.overlay.hidden = true;
        this.clearCustomerModalFeedback();
    }

    setCustomerModalFeedback(message) {
        const modal = UIDom.customerModal;
        if (!modal?.feedback) {
            return;
        }
        modal.feedback.hidden = false;
        modal.feedback.textContent = message;
    }

    clearCustomerModalFeedback() {
        const modal = UIDom.customerModal;
        if (!modal?.feedback) {
            return;
        }
        modal.feedback.hidden = true;
        modal.feedback.textContent = '';
    }

    getSanitizedCustomerFromModal() {
        const modal = UIDom.customerModal;
        const name = (modal?.nameInput?.value || '').trim().replace(/\s+/g, ' ');
        const rawContact = (modal?.contactInput?.value || '').trim();
        const contact = rawContact.replace(/[^0-9A-Za-zА-Яа-яЁё+@.-]/g, '');

        return { name, contact };
    }

    async handleCustomerModalConfirm() {
        const customer = this.getSanitizedCustomerFromModal();
        if (!customer.name || !customer.contact) {
            this.setCustomerModalFeedback('Заполните имя и контакт, чтобы создать заказ.');
            return;
        }

        this.pendingCustomer = customer;
        this.closeCustomerModal();

        await this.withExportCooldown(() => this.performWithScaleOne(() => this.exportData()));
    }

    async withExportCooldown(action) {
        if (this.exportInProgress) {
            return;
        }

        const exportButton = UIDom.buttons.export;
        this.exportInProgress = true;
        const startedAt = Date.now();
        exportButton.disabled = true;
        exportButton.textContent = 'Создаём заказ…';
        this.showOrderResultLoading();

        try {
            await action();
        } finally {
            const elapsed = Date.now() - startedAt;
            const waitMs = Math.max(0, this.exportCooldownMs - elapsed);
            if (waitMs > 0) {
                await new Promise(resolve => setTimeout(resolve, waitMs));
            }
            exportButton.disabled = false;
            exportButton.textContent = this.exportButtonDefaultText;
            this.exportInProgress = false;
        }
    }

    async exportData() {

        const validation = this.contourManager.checkCollisionsAndHighlight();
        if (!validation.ok) {
            this.showOrderResultError(this.formatLayoutIssuesMessage(validation.issues));
            return;
        }

        const realWidth = Math.round(this.layment.width);
        const realHeight = Math.round(this.layment.height);

        const layoutPng = this.createLaymentPreviewPng(16);
        const layoutSvg = this.canvas.toSVG();
        const laymentType = (this.contourManager.contours.length > 0 || this.primitiveManager.primitives.length > 0)
            ? "with-tools"
            : "empty";

        const contours = this.buildExportContours();
        const primitives = this.buildExportPrimitives();
        const texts = this.buildExportTexts();

        //  КОНТРАКТ
        const data = {
            orderMeta: {
            width: realWidth,
            height: realHeight,
            units: "mm",
            coordinateSystem: "origin-top-left",
            baseMaterialColor: this.baseMaterialColor,
            laymentThicknessMm: this.laymentThicknessMm,
            laymentType,
            canvasPng: layoutPng,
            workspaceSnapshot: this.buildWorkspaceSnapshot()
            },
            layoutPng,
            layoutSvg,

            contours,
            primitives,
            texts,
            customer: this.pendingCustomer
        };

        console.log('Заказ:', data);

        try {
            const response = await fetch(Config.API.BASE_URL + Config.API.EXPORT_Layment, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Не удалось создать заказ.');
            }

            const result = await response.json();
            const orderId = result?.orderId || '—';
            const orderNumber = result?.orderNumber || '—';
            const statusUrl = `status.html?orderId=${encodeURIComponent(orderId)}`;

            this.showOrderResultSuccess({
                orderId,
                orderNumber,
                paymentUrl: statusUrl,
                width: realWidth,
                height: realHeight,
                laymentThicknessMm: result?.pricePreview?.laymentThicknessMm ?? 35,
                total: result?.pricePreview?.total ?? '—'
            });
        } catch (err) {
            console.error(err);
            this.showOrderResultError('Не получилось оформить заказ. Проверьте данные и попробуйте снова. ' + (err?.message || ''));
        } finally {
            this.pendingCustomer = null;
        }
    }

    buildExportContours() {
        return this.contourManager.getContoursData();
    }

    buildExportPrimitives() {
        return this.contourManager.getPrimitivesData();
    }

    buildExportTexts() {
        const layment = this.canvas?.layment;
        if (!layment) {
            return [];
        }

        return this.textManager.texts
            .map(textObj => {
                if (!textObj?.isTextObject) {
                    return null;
                }

                const isAttached = textObj.kind === 'attached';
                const ownerContourId = isAttached && Number.isFinite(textObj.ownerPlacementId)
                    ? String(textObj.ownerPlacementId)
                    : null;

                const absolute = isAttached
                    ? this.textManager.computeAbsoluteTextPosition(textObj)
                    : {
                        left: textObj.left ?? 0,
                        top: textObj.top ?? 0,
                        angle: textObj.angle ?? 0
                    };

                return {
                    kind: isAttached ? 'attached' : 'free',
                    text: typeof textObj.text === 'string' ? textObj.text : '',
                    x: Math.round((absolute.left ?? 0) - layment.left),
                    y: Math.round((absolute.top ?? 0) - layment.top),
                    angle: Number.isFinite(absolute.angle) ? absolute.angle : 0,
                    fontSizeMm: Number(textObj.fontSize) || Config.LABELS.FONT_SIZE_MM,
                    ownerContourId
                };
            })
            .filter(Boolean);
    }

    createLaymentPreviewPng(padPx = 20) {
        if (!this.layment) {
            return this.withViewportReset(() => this.canvas.toDataURL({
                format: 'png',
                multiplier: 1
            }));
        }

        return this.withViewportReset(() => {
            const rect = this.layment.getBoundingRect(true, true);
            const left = Math.max(0, rect.left - padPx);
            const top = Math.max(0, rect.top - padPx);
            const width = Math.ceil(rect.width + padPx * 2);
            const height = Math.ceil(rect.height + padPx * 2);

            return this.canvas.toDataURL({
                format: 'png',
                multiplier: 1,
                left,
                top,
                width,
                height
            });
        });
    }
}


document.addEventListener('DOMContentLoaded', () => new ContourApp());
