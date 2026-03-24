// app.js

// Sections overview:
// - Constants
// - ContourApp lifecycle / bootstrap
// - Canvas / Fabric runtime / viewport
// - Services / managers initialization
// - Selection / soft groups / pointer bridge
// - Layment / safe area / workspace geometry
// - Material color / thickness
// - Contours / primitives / texts commands
// - UI sync / controls / status / modal-related app methods
// - Workspace snapshot / save / restore
// - Export / preview / order flow
// - Low-level helpers
// - Global export / bootstrap at file end

// =========================
// Constants
// =========================
const AUTOSAVE_DEBOUNCE_MS = 5000;
const VIEWPORT_RESIZE_FIT_DEBOUNCE_MS = 120;

// =========================
// ContourApp: lifecycle / bootstrap
// =========================
class ContourApp {
    constructor(options = {}) {
        this.options = options || {};
        this.host = this.options.host || {};
        this.editorCallbacks = this.options.callbacks || {};
        this.canvas = null;
        this.layment = null;                  
        this.safeArea = null;
        this.workspaceScale = Config.WORKSPACE_SCALE.DEFAULT;
        this.laymentOffset = Config.LAYMENT_OFFSET;
        this.autosaveTimer = null;
        this.isRestoringWorkspace = false;
        this.baseMaterialColor = Config.DEFAULT_MATERIAL_COLOR;
        this.laymentThicknessMm = 35;
        this.selectionExpandInProgress = false;
        this.viewportResizeFitTimer = null;
        this.viewportFeedbackActive = false;

        this.objectMetaApi = window.ObjectMeta || null;
        this.interactionPolicy = window.InteractionPolicy || null;
        this.actionExecutor = window.ActionExecutor || null;
        this.selectionPointerController = window.SelectionPointerController?.create?.(
            this,
            this.host?.pointerGuards || {}
        ) || null;
        this.canvasScrollContainer = this.host?.canvasScrollContainer || null;
        this.resizeCanvasHandler = null;

        this.ready = this.init();
    }

    async init() {
        this.initializeCanvas();
        this.configureFabricRuntime();
        this.initializeServices();
        this.initializeMaterialColor();
        this.initializeLaymentThickness();
        this.createLayment();
        this.setupEventListeners();
        this.requestControlsStateRefresh();
        this.fitToLayment();
        this.emitEditorCallback('onReady', { document: this.getDocumentState() });
        return this;
    }

    emitEditorCallback(name, payload) {
        const callback = this.editorCallbacks?.[name];
        if (typeof callback === 'function') {
            callback(payload, this);
        }
    }

    destroy() {
        this.cancelAutosave();
        this.resetPointerInteraction?.({ soft: true });
        this.closeCustomerModal?.();
        if (this.resizeCanvasHandler) {
            window.removeEventListener('resize', this.resizeCanvasHandler);
            this.resizeCanvasHandler = null;
        }
        if (this.canvas?.dispose) {
            this.canvas.dispose();
        }
        this.canvas = null;
        this.emitEditorCallback('onDestroy', { destroyed: true });
    }

    // =========================
    // Canvas / Fabric runtime / viewport
    // =========================

    initializeCanvas() {
        const canvasElement = this.host?.canvasElement;
        if (!(canvasElement instanceof HTMLCanvasElement)) {
            throw new Error('ContourApp initialization failed: host.canvasElement (HTMLCanvasElement) is required.');
        }

        const getCanvasSize = () => this.getViewportSize();

        const initialSize = getCanvasSize();
        this.canvas = new fabric.Canvas(canvasElement, {
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
                const canvasWidth = this.canvas.getWidth();
                const canvasHeight = this.canvas.getHeight();
                const sizeChanged = canvasWidth !== size.width || canvasHeight !== size.height;
                this.canvas.setDimensions({ width: size.width, height: size.height });
                if (sizeChanged) {
                    this.scheduleViewportRefit();
                } else {
                    this.canvas.renderAll();
                }
            }
        };

        this.resizeCanvasHandler = resizeCanvas;
        window.addEventListener('resize', this.resizeCanvasHandler);
        requestAnimationFrame(resizeCanvas);
    }

    configureFabricRuntime() {
        if (!fabric?.ActiveSelection?.prototype?.set) {
            return;
        }

        fabric.ActiveSelection.prototype.set(Config.FABRIC_CONFIG.GROUP);
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

    // =========================
    // Services / managers initialization
    // =========================

    initializeServices() {
        this.contourManager = new ContourManager(this.canvas, this);  // Pass this (app) to ContourManager
        this.primitiveManager = new PrimitiveManager(this.canvas, this);  // Новый менеджер для примитивов
        this.textManager = new TextManager(this.canvas, this, this.contourManager);
    }

    // =========================
    // Selection / soft groups / pointer bridge
    // =========================

    resolveActionTargets(activeObject, actionName = null) {
        if (this.interactionPolicy?.resolveActionTargets) {
            return this.interactionPolicy.resolveActionTargets(this, activeObject, actionName);
        }

        if (!activeObject) {
            return [];
        }
        return activeObject.type === 'activeSelection' ? activeObject.getObjects().filter(Boolean) : [activeObject];
    }

    generateSoftGroupId() {
        if (window.crypto?.randomUUID) {
            return `grp_${window.crypto.randomUUID()}`;
        }
        return `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }

    getSelectableWorkspaceObjects() {
        return this.canvas.getObjects().filter(obj => {
            return obj
                && obj !== this.layment
                && obj !== this.safeArea
                && obj.type !== 'activeSelection';
        });
    }

    getSoftGroupMembers(groupId) {
        const normalizedGroupId = this.objectMetaApi?.normalizeGroupId?.(groupId) || null;
        if (!normalizedGroupId) {
            return [];
        }
        return this.getSelectableWorkspaceObjects().filter(obj => {
            return this.objectMetaApi?.getGroupId?.(obj) === normalizedGroupId;
        });
    }

    getSelectionObjects(activeObject = this.canvas.getActiveObject()) {
        if (!activeObject) {
            return [];
        }
        return activeObject.type === 'activeSelection'
            ? activeObject.getObjects().filter(Boolean)
            : [activeObject];
    }


    getExpandedSelectionWithSoftGroups(objects, predicate = null) {
        const list = Array.isArray(objects) ? objects.filter(Boolean) : [];
        if (!list.length) {
            return [];
        }

        if (this.interactionPolicy?.expandTargetsWithSoftGroups) {
            return this.interactionPolicy.expandTargetsWithSoftGroups(this, list, predicate);
        }

        const expanded = [];
        const seen = new Set();
        const addObject = (obj) => {
            if (!obj || seen.has(obj)) {
                return;
            }
            if (typeof predicate === 'function' && predicate(obj) === false) {
                return;
            }
            seen.add(obj);
            expanded.push(obj);
        };

        list.forEach(obj => {
            addObject(obj);
            const groupId = this.objectMetaApi?.getGroupId?.(obj);
            if (!groupId) {
                return;
            }
            this.getSoftGroupMembers(groupId).forEach(member => addObject(member));
        });

        return expanded;
    }

    hasSameObjectSet(left, right) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
            return false;
        }
        const rightSet = new Set(right);
        return left.every(obj => rightSet.has(obj));
    }

    expandActiveSelectionWithSoftGroupsIfNeeded(active, source) {
        if (!active || this.selectionExpandInProgress) {
            return false;
        }

        const selectedObjects = this.getSelectionObjects(active);
        if (!selectedObjects.length) {
            return false;
        }

        const expandedObjects = this.getExpandedSelectionWithSoftGroups(selectedObjects, obj => {
            return this.interactionPolicy?.canSelect?.(this, obj) !== false;
        });
        if (!expandedObjects.length) {
            return false;
        }

        const alreadyExpanded = this.hasSameObjectSet(selectedObjects, expandedObjects);
        if (alreadyExpanded && (active.type === 'activeSelection' || expandedObjects.length <= 1)) {
            return false;
        }

        this.selectionExpandInProgress = true;
        try {
            this.canvas.discardActiveObject();
            if (expandedObjects.length === 1) {
                this.setActiveObjectWithSelectionSource(expandedObjects[0], source || 'programmatic');
                expandedObjects[0].setCoords?.();
                this.canvas.requestRenderAll();
            } else {
                this.restoreActiveSelection(expandedObjects, { source: source || 'programmatic' });
            }
        } finally {
            this.selectionExpandInProgress = false;
        }

        return true;
    }

    getGroupSelectionObjects(activeObject = this.canvas.getActiveObject()) {
        return this.getSelectionObjects(activeObject)
            .filter(obj => this.interactionPolicy?.canJoinGroup?.(this, obj) === true);
    }

    getUngroupSelectionObjects(activeObject = this.canvas.getActiveObject()) {
        return this.getSelectionObjects(activeObject)
            .filter(obj => !!this.objectMetaApi?.getGroupId?.(obj));
    }

    hasGroupSelection(activeObject = this.canvas.getActiveObject()) {
        const selectedObjects = this.getSelectionObjects(activeObject);
        const groupableObjects = this.getGroupSelectionObjects(activeObject);
        return selectedObjects.length >= 2 && groupableObjects.length === selectedObjects.length;
    }

    hasUngroupSelection(activeObject = this.canvas.getActiveObject()) {
        return this.getUngroupSelectionObjects(activeObject).length >= 1;
    }

    groupSelected() {
        return this.actionExecutor?.executeAction?.('group', {}, this) || false;
    }

    ungroupSelected() {
        return this.actionExecutor?.executeAction?.('ungroup', {}, this) || false;
    }

    handleSoftGroupObjectMoving(target) {
        this.selectionPointerController?.handleSoftGroupObjectMoving(target);
    }

    finalizeSoftGroupMove(target) {
        return this.selectionPointerController?.finalizeSoftGroupMove(target) || [];
    }

    beginSoftGroupMove(target, selectedObjects = this.resolveActionTargets(target, 'move')) {
        return this.selectionPointerController?.beginSoftGroupMove(target, selectedObjects) || null;
    }

    markNextSelectionSource(source) {
        this.selectionPointerController?.markNextSelectionSource(source);
    }

    consumeSelectionSource(activeObject, fallback = null) {
        return this.selectionPointerController?.consumeSelectionSource(activeObject, fallback) || null;
    }

    detectSelectionSourceFromPointerEvent(event) {
        return this.selectionPointerController?.detectSelectionSourceFromPointerEvent(event) || null;
    }

    setActiveObjectWithSelectionSource(obj, source = 'programmatic') {
        this.selectionPointerController?.setActiveObjectWithSelectionSource(obj, source);
    }

    sanitizeActiveSelectionIfNeeded(active, source) {
        return this.selectionPointerController?.sanitizeActiveSelectionIfNeeded(active, source) || false;
    }

    finalizeSelectionChange(active = this.canvas.getActiveObject(), source = null) {
        this.selectionPointerController?.finalizeSelectionChange(active, source);
    }

    handleSelectionChanged(_eventName) {
        this.selectionPointerController?.handleSelectionChanged();
    }

    // =========================
    // Layment / safe area / workspace geometry
    // =========================

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
        const width = Config.LAYMENT_DEFAULT_WIDTH;
        const height = Config.LAYMENT_DEFAULT_HEIGHT;

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
    }

    resolveLaymentPreset(width, height) {
        const presetEntry = Object.entries(Config.LAYMENT_PRESETS || {}).find(([, size]) => {
            return size.width === width && size.height === height;
        });
        return presetEntry ? presetEntry[0] : 'CUSTOM';
    }

    applyLaymentPreset(presetName) {
        const preset = Config.LAYMENT_PRESETS?.[presetName];
        if (!preset) {
            return;
        }

        this.updateLaymentSize(preset.width, preset.height);
    }

    // =========================
    // Material color / thickness
    // =========================

    initializeMaterialColor() {
        if (!Config.MATERIAL_COLORS[this.baseMaterialColor]) {
            this.baseMaterialColor = Config.DEFAULT_MATERIAL_COLOR;
        }
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


    setBaseMaterialColor(colorKey) {
        if (!Config.MATERIAL_COLORS[colorKey]) {
            return false;
        }

        this.baseMaterialColor = colorKey;
        this.applyMaterialColorToCutouts();
        this.requestControlsStateRefresh();
        this.scheduleWorkspaceSave();
        return true;
    }

    setLaymentThickness(value) {
        const thickness = this.getValidLaymentThickness(value);
        this.laymentThicknessMm = thickness;
        this.requestControlsStateRefresh();
        this.scheduleWorkspaceSave();
        return thickness;
    }

    // =========================
    // Contours / primitives / texts commands
    // =========================

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

    async addContourCommand(itemOrId) {
        if (typeof itemOrId === 'string') {
            throw new Error('addContourCommand requires contour metadata object. String id is no longer supported.');
        }

        const item = itemOrId && typeof itemOrId === 'object' ? itemOrId : null;
        if (!item?.assets?.svg) {
            throw new Error('Contour metadata with assets.svg is required.');
        }

        await this.addContour(item);
        return this.getSelectionState();
    }

    addPrimitiveCommand(payload = {}) {
        const type = payload.type === 'circle' ? 'circle' : 'rect';
        const defaultCenterX = this.layment.left + this.layment.width / 2;
        const defaultCenterY = this.layment.top + this.layment.height / 2;
        const x = Number.isFinite(payload.x) ? payload.x : defaultCenterX;
        const y = Number.isFinite(payload.y) ? payload.y : defaultCenterY;

        let primitive = null;
        if (type === 'circle') {
            const radius = Number.isFinite(payload.radius) ? payload.radius : 25;
            primitive = this.primitiveManager.addPrimitive('circle', { x, y }, { radius }, { pocketDepthMm: payload.pocketDepthMm });
        } else {
            const width = Number.isFinite(payload.width) ? payload.width : 50;
            const height = Number.isFinite(payload.height) ? payload.height : 50;
            primitive = this.primitiveManager.addPrimitive('rect', { x, y }, { width, height }, { pocketDepthMm: payload.pocketDepthMm });
        }

        if (primitive) {
            this.setActiveObjectWithSelectionSource(primitive, 'programmatic');
            this.canvas.requestRenderAll();
            this.scheduleWorkspaceSave();
        }

        return primitive ? this.getSelectionState() : null;
    }

    addTextCommand(payload = {}) {
        const kind = payload.kind === 'attached' ? 'attached' : 'free';
        const text = typeof payload.text === 'string' ? payload.text : '';
        const fontSizeMm = Number.isFinite(payload.fontSizeMm) ? payload.fontSizeMm : undefined;
        const role = typeof payload.role === 'string' && payload.role.trim() ? payload.role.trim() : 'user-text';

        let textObject = null;
        if (kind === 'attached') {
            const ownerPlacementId = Number.isFinite(payload.ownerPlacementId) ? payload.ownerPlacementId : null;
            const contour = ownerPlacementId != null
                ? this.textManager.getContourByPlacementId(ownerPlacementId)
                : this.getSelectedContourForText();
            if (!contour) {
                throw new Error('Attached text requires ownerPlacementId or a selected contour.');
            }
            textObject = this.textManager.createAttachedText(contour, { text, role, fontSizeMm });
        } else {
            const left = Number.isFinite(payload.x) ? payload.x : this.layment.left + 20;
            const top = Number.isFinite(payload.y) ? payload.y : this.layment.top + 20;
            textObject = this.textManager.createFreeText({ text, role, fontSizeMm, left, top });
        }

        if (textObject) {
            this.setActiveObjectWithSelectionSource(textObject, 'programmatic');
            this.canvas.requestRenderAll();
            this.scheduleWorkspaceSave();
        }

        return textObject ? this.getSelectionState() : null;
    }

    moveSelectionCommand(payload = {}) {
        const deltaX = Number(payload.deltaX ?? payload.dx) || 0;
        const deltaY = Number(payload.deltaY ?? payload.dy) || 0;
        const moved = this.moveSelectedBy(deltaX, deltaY);
        return { moved, selection: this.getSelectionState() };
    }

    rotateSelectionCommand() {
        this.rotateSelected();
        return this.getSelectionState();
    }

    deleteSelectionCommand() {
        this.deleteSelected();
        return this.getSelectionState();
    }

    groupSelectionCommand() {
        this.groupSelected();
        return this.getSelectionState();
    }

    ungroupSelectionCommand() {
        this.ungroupSelected();
        return this.getSelectionState();
    }

    updateLaymentSize(width, height) {
        this.layment.set({ width, height });
        this.layment.setCoords();
        this.syncSafeAreaRect();
        if (!this.isRestoringWorkspace) {
            this.fitViewportAfterLaymentResize();
        }
        this.canvas.requestRenderAll();
        this.requestControlsStateRefresh();
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
        this.requestStatusBarRefresh();
        this.restoreActiveSelection(saved.objects);
    }

    getViewportUnionBounds(objects = []) {
        const targetObjects = (Array.isArray(objects) ? objects : [objects])
            .filter(obj => !!obj && typeof obj.getBoundingRect === 'function');

        if (!targetObjects.length) {
            return null;
        }

        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;

        targetObjects.forEach(obj => {
            obj.setCoords?.();
            const rect = obj.getBoundingRect(true, true);
            left = Math.min(left, rect.left);
            top = Math.min(top, rect.top);
            right = Math.max(right, rect.left + rect.width);
            bottom = Math.max(bottom, rect.top + rect.height);
        });

        if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
            return null;
        }

        return {
            left,
            top,
            width: Math.max(1, right - left),
            height: Math.max(1, bottom - top)
        };
    }

    fitViewportToObjects(objects, options = {}) {
        if (!this.canvas || !this.layment) {
            return false;
        }

        const viewport = this.getViewportSize();
        if (!viewport.width || !viewport.height) {
            return false;
        }

        const rect = this.getViewportUnionBounds(objects);
        if (!rect) {
            return false;
        }

        const padding = Number.isFinite(options.padding) ? options.padding : 20;
        this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
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
        return true;
    }

    fitToLayment(options = {}) {
        return this.fitViewportToObjects([this.layment], options);
    }

    getOutOfBoundsWorkspaceObjects() {
        return this.contourManager?.getOutOfBoundsWorkspaceObjects?.() || [];
    }

    showOrderResultInfo(message, title = Config.MESSAGES.VIEWPORT_OUT_OF_BOUNDS_TITLE) {
        const orderResult = UIDom.orderResult;
        if (!orderResult.container) return;

        orderResult.container.hidden = false;
        orderResult.container.classList.remove('order-result-success', 'order-result-error', 'order-result-loading');
        orderResult.container.classList.add('order-result-info');
        orderResult.title.textContent = title;
        orderResult.message.textContent = message;
        orderResult.details.hidden = true;
        orderResult.orderNumber.textContent = '—';
        orderResult.orderId.textContent = '—';
        orderResult.statusLinkRow.hidden = true;
        orderResult.paymentLink.href = '#';
        orderResult.meta.hidden = true;
        orderResult.meta.textContent = '';
    }

    clearViewportIssueFeedback() {
        if (!this.viewportFeedbackActive) {
            return;
        }

        this.viewportFeedbackActive = false;
        const orderResult = UIDom.orderResult;
        if (orderResult.container?.classList.contains('order-result-info')) {
            this.clearOrderResult();
        }
    }

    updateViewportIssueFeedback(offendingObjects) {
        if (!offendingObjects.length) {
            this.clearViewportIssueFeedback();
            return;
        }

        const message = offendingObjects.length === 1
            ? Config.MESSAGES.VIEWPORT_OUT_OF_BOUNDS_SINGLE
            : Config.MESSAGES.VIEWPORT_OUT_OF_BOUNDS_MULTIPLE;

        this.viewportFeedbackActive = true;
        this.showOrderResultInfo(message);
    }

    focusWorkspaceObjects(objects, { padding = 40, selectionSource = 'programmatic' } = {}) {
        const targetObjects = (Array.isArray(objects) ? objects : [objects]).filter(Boolean);
        if (!targetObjects.length) {
            return false;
        }

        const fitObjects = [this.layment, ...targetObjects];
        const fitted = this.fitViewportToObjects(fitObjects, { padding });

        if (targetObjects.length === 1) {
            this.setActiveObjectWithSelectionSource(targetObjects[0], selectionSource);
            targetObjects[0].setCoords?.();
            this.canvas.requestRenderAll();
        } else {
            this.restoreActiveSelection(targetObjects, { source: selectionSource });
        }

        return fitted;
    }

    fitViewportAfterLaymentResize() {
        const offendingObjects = this.getOutOfBoundsWorkspaceObjects();
        if (!offendingObjects.length) {
            this.clearViewportIssueFeedback();
            return this.fitToLayment();
        }

        this.updateViewportIssueFeedback(offendingObjects);
        return this.focusWorkspaceObjects(offendingObjects, {
            padding: 40,
            selectionSource: 'programmatic'
        });
    }

    fitViewportForCurrentWorkspaceState() {
        const offendingObjects = this.getOutOfBoundsWorkspaceObjects();
        if (!offendingObjects.length) {
            this.clearViewportIssueFeedback();
            return this.fitToLayment();
        }
        return this.fitViewportToObjects([this.layment, ...offendingObjects], { padding: 40 });
    }

    scheduleViewportRefit() {
        if (this.viewportResizeFitTimer) {
            clearTimeout(this.viewportResizeFitTimer);
        }

        this.viewportResizeFitTimer = setTimeout(() => {
            this.viewportResizeFitTimer = null;
            this.fitViewportForCurrentWorkspaceState();
        }, VIEWPORT_RESIZE_FIT_DEBOUNCE_MS);
    }

    isSpacePanModifier(mouseEvent) {
        return this.selectionPointerController?.isSpacePanModifier(mouseEvent) || false;
    }

    canStartPanning(mouseEvent) {
        return this.selectionPointerController?.canStartPanning(mouseEvent) || false;
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
        this.requestStatusBarRefresh();
    }

    setPanCursor(isGrabbing) {
        if (!this.canvasScrollContainer) {
            return;
        }
        this.canvasScrollContainer.classList.toggle('is-panning', isGrabbing);
    }

    stopPanning() {
        this.selectionPointerController?.stopPanning();
    }

    isInsideCanvas(target) {
        return this.selectionPointerController?.isInsideCanvas(target) || false;
    }

    isProtectedUiTarget(target) {
        return this.selectionPointerController?.isProtectedUiTarget(target) || false;
    }

    clearBrowserSelection() {
        this.selectionPointerController?.clearBrowserSelection();
    }

    isEditableElement(element) {
        return this.selectionPointerController?.isEditableElement(element) || false;
    }

    isEditableTarget(target) {
        return this.selectionPointerController?.isEditableTarget(target) || false;
    }

    logPointerFocus(eventName, target) {
        this.selectionPointerController?.logPointerFocus(eventName, target);
    }

    schedulePointerResetRender() {
        this.selectionPointerController?.schedulePointerResetRender();
    }

    finishActiveTextEditing() {
        this.selectionPointerController?.finishActiveTextEditing();
    }

    resetPointerInteraction({ soft = false } = {}) {
        this.selectionPointerController?.resetPointerInteraction({ soft });
    }

    setupEventListeners() {
        this.bindGlobalPointerSafety();
        this.bindCanvasEvents();
        this.bindKeyboardInteractionRuntime();
        this.bindKeyboardShortcuts();
        this.syncWorkspaceScaleInput();
    }

    bindGlobalPointerSafety() {
        this.selectionPointerController?.bindGlobalPointerSafety();
    }

    bindKeyboardInteractionRuntime() {
        this.selectionPointerController?.bindKeyboardEvents();
    }

    bindKeyboardShortcuts() {
        document.addEventListener('keydown', event => {
            const isModalOpen = !UIDom.customerModal?.overlay?.hidden;
            if (event.defaultPrevented || isModalOpen || (this.shouldIgnoreKeyboardShortcut(event) && !(isModalOpen && event.key === 'Escape'))) {
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
                    if (this.canvas.getActiveObject()) {
                        event.preventDefault();
                        this.canvas.discardActiveObject();
                        this.canvas.requestRenderAll();
                        this.requestControlsStateRefresh();
                        this.requestStatusBarRefresh();
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
        const targets = this.resolveActionTargets(active, 'move');
        const deltaX = Number(dx) || 0;
        const deltaY = Number(dy) || 0;

        if (!targets.length || (!deltaX && !deltaY)) {
            return false;
        }

        this.actionExecutor?.executeAction?.('move', { deltaX, deltaY }, this);
        return true;
    }

    bindCanvasEvents() {
        this.selectionPointerController?.bindCanvasEvents();
    }

    syncWorkspaceScaleInput() {
        if (!UIDom.inputs.workspaceScale) {
            return;
        }
        UIDom.inputs.workspaceScale.value = Math.round(this.workspaceScale * 100);
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

    getLockSelectionObjects(activeObject = this.canvas.getActiveObject()) {
        if (this.interactionPolicy?.getLockSelectionObjects) {
            const targets = activeObject?.type === 'activeSelection'
                ? activeObject.getObjects().filter(Boolean)
                : (activeObject ? [activeObject] : []);
            return this.interactionPolicy.getLockSelectionObjects(this, targets);
        }

        return this.resolveActionTargets(activeObject, 'toggleLock');
    }

    getSelectionLockState(activeObject = this.canvas.getActiveObject()) {
        if (this.interactionPolicy?.getSelectionLockState) {
            const targets = activeObject?.type === 'activeSelection'
                ? activeObject.getObjects().filter(Boolean)
                : (activeObject ? [activeObject] : []);
            return this.interactionPolicy.getSelectionLockState(this, targets);
        }

        const lockableObjects = this.getLockSelectionObjects(activeObject);
        const anyLocked = lockableObjects.some(obj => this.interactionPolicy?.isSemanticallyLocked?.(obj) === true);
        return {
            anyLocked,
            allLocked: anyLocked && lockableObjects.every(obj => this.interactionPolicy?.isSemanticallyLocked?.(obj) === true),
            lockableCount: lockableObjects.length
        };
    }

    getObjectVisualPriority(obj) {
        if (!obj) {
            return 'normal';
        }
        if (obj.layoutVisualState === 'error') {
            return 'error';
        }
        if (this.interactionPolicy?.isSemanticallyLocked?.(obj) === true) {
            return 'locked';
        }
        return 'normal';
    }

    getObjectVisualStyle(obj) {
        const priority = this.getObjectVisualPriority(obj);
        const isPrimitive = !!obj?.primitiveType;
        const baseStyle = isPrimitive
            ? {
                stroke: Config.COLORS.PRIMITIVE.STROKE,
                strokeWidth: 1,
                fill: Config.COLORS.PRIMITIVE.FILL,
                opacity: 1,
                borderColor: Config.COLORS.SELECTION.BORDER,
                cornerColor: Config.COLORS.SELECTION.CORNER
            }
            : {
                stroke: Config.COLORS.CONTOUR.NORMAL,
                strokeWidth: Config.COLORS.CONTOUR.NORMAL_STROKE_WIDTH,
                fill: Config.COLORS.CONTOUR.FILL,
                opacity: 1,
                borderColor: Config.COLORS.SELECTION.BORDER,
                cornerColor: Config.COLORS.SELECTION.CORNER
            };

        if (priority === 'error') {
            return isPrimitive
                ? {
                    ...baseStyle,
                    stroke: Config.COLORS.PRIMITIVE.ERROR,
                    strokeWidth: 3,
                    opacity: 0.85,
                    borderColor: Config.COLORS.SELECTION.ERROR_BORDER,
                    cornerColor: Config.COLORS.SELECTION.ERROR_CORNER
                }
                : {
                    ...baseStyle,
                    stroke: Config.COLORS.CONTOUR.ERROR,
                    strokeWidth: Config.COLORS.CONTOUR.ERROR_STROKE_WIDTH,
                    opacity: 0.85,
                    borderColor: Config.COLORS.SELECTION.ERROR_BORDER,
                    cornerColor: Config.COLORS.SELECTION.ERROR_CORNER
                };
        }

        if (priority === 'locked') {
            return isPrimitive
                ? {
                    ...baseStyle,
                    stroke: Config.COLORS.PRIMITIVE.LOCKED,
                    strokeWidth: Config.COLORS.PRIMITIVE.LOCKED_STROKE_WIDTH,
                    borderColor: Config.COLORS.SELECTION.LOCKED_BORDER,
                    cornerColor: Config.COLORS.SELECTION.LOCKED_CORNER
                }
                : {
                    ...baseStyle,
                    stroke: Config.COLORS.CONTOUR.LOCKED,
                    strokeWidth: Config.COLORS.CONTOUR.LOCKED_STROKE_WIDTH,
                    borderColor: Config.COLORS.SELECTION.LOCKED_BORDER,
                    cornerColor: Config.COLORS.SELECTION.LOCKED_CORNER
                };
        }

        return baseStyle;
    }

    applyObjectVisualState(obj) {
        if (!obj || obj === this.layment || obj === this.safeArea || obj.type === 'activeSelection' || obj.isTextObject) {
            return;
        }

        const style = this.getObjectVisualStyle(obj);
        this.contourManager?.resetPropertiesRecursive?.(obj, style);
        obj.setCoords?.();
    }

    applyVisualStateToObjects(objects) {
        const list = Array.isArray(objects) ? objects.filter(Boolean) : [];
        list.forEach(obj => this.applyObjectVisualState(obj));
    }

    resetWorkspaceVisualStateIssues() {
        this.getSelectableWorkspaceObjects().forEach(obj => {
            obj.layoutVisualState = null;
            this.applyObjectVisualState(obj);
        });
    }

    setObjectsVisualState(objects, state = null) {
        const list = Array.isArray(objects) ? objects.filter(Boolean) : [];
        list.forEach(obj => {
            obj.layoutVisualState = state;
            this.applyObjectVisualState(obj);
        });
    }

    syncSelectionVisualState(active = this.canvas.getActiveObject()) {
        if (!active) {
            return;
        }

        if (active.type !== 'activeSelection') {
            this.applyObjectVisualState(active);
            return;
        }

        const selectionObjects = active.getObjects().filter(Boolean);
        this.applyVisualStateToObjects(selectionObjects);

        const priority = selectionObjects.some(obj => this.getObjectVisualPriority(obj) === 'error')
            ? 'error'
            : (selectionObjects.some(obj => this.getObjectVisualPriority(obj) === 'locked') ? 'locked' : 'normal');

        if (priority === 'error') {
            active.borderColor = Config.COLORS.SELECTION.ERROR_BORDER;
            active.cornerColor = Config.COLORS.SELECTION.ERROR_CORNER;
        } else if (priority === 'locked') {
            active.borderColor = Config.COLORS.SELECTION.LOCKED_BORDER;
            active.cornerColor = Config.COLORS.SELECTION.LOCKED_CORNER;
        } else {
            active.borderColor = Config.COLORS.SELECTION.BORDER;
            active.cornerColor = Config.COLORS.SELECTION.CORNER;
        }
    }

    syncActiveSelectionInteractionState(active = this.canvas.getActiveObject()) {
        if (!active || active.type !== 'activeSelection') {
            return;
        }

        const selectedObjects = active.getObjects().filter(Boolean);
        const canGroupMove = this.interactionPolicy?.canGroupMoveSelection
            ? this.interactionPolicy.canGroupMoveSelection(this, selectedObjects)
            : selectedObjects.every(obj => this.interactionPolicy?.canMove?.(this, obj) !== false);

        active.lockMovementX = !canGroupMove;
        active.lockMovementY = !canGroupMove;
        active.lockRotation = true;
        active.lockScalingX = true;
        active.lockScalingY = true;
        active.hasControls = false;
        active.hasBorders = true;
        active.setControlsVisibility?.({
            tl: false,
            tr: false,
            br: false,
            bl: false,
            ml: false,
            mt: false,
            mr: false,
            mb: false,
            mtr: false
        });
        active.setCoords?.();
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

    restoreActiveSelection(objects, { source = 'restoreActiveSelection' } = {}) {
        if (!objects || !objects.length) {
            return;
        }

        if (objects.length === 1) {
            this.setActiveObjectWithSelectionSource(objects[0], source);
            objects[0].setCoords();
            this.canvas.requestRenderAll();
            return;
        }

        const selection = new fabric.ActiveSelection(objects, { canvas: this.canvas });
        this.markNextSelectionSource(source);
        this.canvas.setActiveObject(selection);
        this.syncActiveSelectionInteractionState(selection);
        selection.setCoords();
        this.canvas.requestRenderAll();
    }

    isContourObject(obj) {
        return !!obj && !obj.primitiveType && !obj.isTextObject && obj !== this.layment && obj !== this.safeArea;
    }

    syncAttachedTextFollowersForOwner(obj, { rememberContourLastPosition = false } = {}) {
        if (!this.isContourObject(obj)) {
            return;
        }

        if (rememberContourLastPosition) {
            obj._lastLeft = obj.left;
            obj._lastTop = obj.top;
        }

        this.textManager.syncAttachedTextsForContour(obj);
    }

    syncObjectTextState(obj, { rememberContourLastPosition = false } = {}) {
        if (!obj) {
            return;
        }

        if (obj.type === 'activeSelection') {
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

    getUniqueObjects(objects) {
        const list = Array.isArray(objects) ? objects : (objects ? [objects] : []);
        const unique = [];
        const seen = new Set();

        list.forEach(obj => {
            if (!obj || seen.has(obj)) {
                return;
            }
            seen.add(obj);
            unique.push(obj);
        });

        return unique;
    }

    applySharedMoveInvariants(objects, {
        rememberContourLastPosition = false,
        syncFollowers = true
    } = {}) {
        const changedObjects = this.getUniqueObjects(objects);
        if (!changedObjects.length) {
            return [];
        }

        changedObjects.forEach(obj => {
            this.syncObjectTextState(obj, { rememberContourLastPosition });
        });

        if (syncFollowers && this.actionExecutor?.collectFollowers && this.actionExecutor?.applyFollowerUpdates) {
            const followerCtx = {
                app: this,
                actionName: 'pointer-finalize',
                policy: this.interactionPolicy || window.InteractionPolicy || null
            };
            const followers = this.actionExecutor.collectFollowers(changedObjects, followerCtx, this);
            this.actionExecutor.applyFollowerUpdates(followers, followerCtx.actionName, {}, followerCtx, this);
        }

        return changedObjects;
    }

    refreshCanvasMutationState({ scheduleWorkspaceSave = false } = {}) {
        this.canvas.requestRenderAll();
        this.requestControlsStateRefresh();
        this.requestStatusBarRefresh();

        if (scheduleWorkspaceSave) {
            this.scheduleWorkspaceSave();
        }
    }

    finalizePointerDrivenTransform(target) {
        if (!target) {
            this.refreshCanvasMutationState();
            return false;
        }

        const softGroupObjects = this.finalizeSoftGroupMove(target);
        if (target.type === 'activeSelection') {
            const selectionObjects = target.getObjects().filter(Boolean);
            if (!selectionObjects.length) {
                this.refreshCanvasMutationState();
                return false;
            }

            this.canvas.discardActiveObject();
            this.applySharedMoveInvariants(
                [...selectionObjects, ...softGroupObjects],
                { rememberContourLastPosition: true }
            );
            this.restoreActiveSelection(selectionObjects, {
                source: this.selectionPointerController?.getActiveSelectionSource?.() || 'programmatic'
            });
            this.refreshCanvasMutationState({ scheduleWorkspaceSave: true });
            return true;
        }

        const changedObjects = this.getUniqueObjects([target, ...softGroupObjects]);
        this.applySharedMoveInvariants(changedObjects, {
            rememberContourLastPosition: true
        });
        this.refreshCanvasMutationState({
            scheduleWorkspaceSave: changedObjects.some(obj => this.shouldAutosaveForObject(obj))
        });
        return changedObjects.length > 0;
    }

    finalizeActiveSelectionTransform(target) {
        if (!target || target.type !== 'activeSelection') {
            return false;
        }

        const objects = target.getObjects().filter(Boolean);
        if (!objects.length) {
            return false;
        }

        this.canvas.discardActiveObject();
        this.applySharedMoveInvariants(objects, { rememberContourLastPosition: true });
        this.restoreActiveSelection(objects, {
            source: this.selectionPointerController?.getActiveSelectionSource?.() || 'programmatic'
        });
        return true;
    }

    alignSelected(mode) {
        this.actionExecutor?.executeAction?.('align', { mode }, this);
    }

    distributeSelected(mode) {
        this.actionExecutor?.executeAction?.('distribute', { mode }, this);
    }

    snapSelectedToSide(side) {
        this.actionExecutor?.executeAction?.('snap', { side }, this);
    }

    // =========================
    // UI sync / controls / status / modal-related app methods
    // =========================

    buildControlsState() {
        const selected = this.getArrangeSelectionObjects();
        const selectedCount = selected.length;
        const active = this.canvas.getActiveObject();
        const hasSelection = !!active;
        const lockState = this.getSelectionLockState(active);

        const duplicateTargets = this.getDuplicateSelectionObjects();
        const canDelete = hasSelection && this.resolveActionTargets(active, 'delete').length > 0;
        const canRotate = this.resolveActionTargets(active, 'rotate').length > 0;
        const canDuplicate = duplicateTargets.length > 0;
        const canToggleLock = lockState.lockableCount > 0;
        const canGroup = this.hasGroupSelection(active);
        const canUngroup = this.hasUngroupSelection(active);
        const canAlign = selectedCount >= 2;
        const canDistribute = selectedCount >= 3;
        const canSnap = selectedCount >= 1;
        const lockStateValue = selectedCount < 1
            ? 'none'
            : (lockState.hasLocked && lockState.hasUnlocked
                ? 'mixed'
                : (lockState.allLocked ? 'locked' : 'unlocked'));

        return {
            hasSelection,
            selectedCount,
            canDelete,
            canRotate,
            canDuplicate,
            canToggleLock,
            lockState: lockStateValue,
            canGroup,
            canUngroup,
            canAlign,
            canDistribute,
            canSnap,
            lockButtonLabel: lockState.allLocked ? 'Разблокировать' : 'Заблокировать',
            lockButtonHint: lockState.allLocked
                ? 'Снять блокировку с выделенного'
                : 'Заблокировать выделенное от случайных изменений',
            lockButtonPressed: lockState.allLocked
        };
    }

    getControlsState() {
        return this.buildControlsState();
    }

    requestControlsStateRefresh() {
        this.emitEditorCallback('onControlsStateChanged', {
            controlsState: this.getControlsState()
        });
    }

    updateButtons() {
        this.requestControlsStateRefresh();
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

    getPrimitiveInspectorState() {
        const primitive = this.getSingleSelectedPrimitive();

        const limits = {
            rect: {
                minWidth: Config.GEOMETRY.PRIMITIVES.RECT.MIN_WIDTH,
                maxWidth: Config.GEOMETRY.PRIMITIVES.RECT.MAX_WIDTH,
                minHeight: Config.GEOMETRY.PRIMITIVES.RECT.MIN_HEIGHT,
                maxHeight: Config.GEOMETRY.PRIMITIVES.RECT.MAX_HEIGHT
            },
            circle: {
                minRadius: Config.GEOMETRY.PRIMITIVES.CIRCLE.MIN_RADIUS,
                maxRadius: Config.GEOMETRY.PRIMITIVES.CIRCLE.MAX_RADIUS
            }
        };

        if (!primitive) {
            return {
                mode: 'empty',
                primitive: null,
                limits
            };
        }

        const dimensions = this.primitiveManager.getPrimitiveDimensions(primitive);

        if (dimensions.type === 'rect') {
            return {
                mode: 'rect',
                primitive: {
                    type: 'rect',
                    width: dimensions.width,
                    height: dimensions.height
                },
                limits
            };
        }

        return {
            mode: 'circle',
            primitive: {
                type: 'circle',
                radius: dimensions.radius
            },
            limits
        };
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

    getAttachedTextsForContour(contour) {
        if (!contour?.placementId) return [];
        return this.textManager.getAttachedTextsForContour(contour);
    }

    getTextInspectorState() {
        const contour = this.getSelectedContourForText();
        const selectedText = this.getSelectedTextObject();
        const ownerContour = selectedText?.kind === 'attached' ? this.textManager.getContourByPlacementId(selectedText.ownerPlacementId) : null;
        const targetContour = contour || ownerContour;

        if (!selectedText && !targetContour) {
            return {
                mode: 'hidden',
                selectedText: null,
                targetContour: null,
                capabilities: {
                    canEditValue: false,
                    canEditFontSize: false,
                    canEditAngle: false,
                    canAddFree: true,
                    canAddAttached: false,
                    canAttach: false,
                    canDetach: false,
                    canDelete: false
                }
            };
        }

        const formText = selectedText || null;
        return {
            mode: 'context',
            selectedText: formText ? {
                kind: formText.kind === 'attached' ? 'attached' : 'free',
                text: formText.text || '',
                fontSize: Number.isFinite(Number(formText.fontSize)) ? Number(formText.fontSize) : null,
                angle: Number.isFinite(Number(formText.angle)) ? Number(formText.angle) : 0,
                role: formText.role || null,
                ownerPlacementId: Number.isFinite(formText.ownerPlacementId) ? formText.ownerPlacementId : null
            } : null,
            targetContour: targetContour ? {
                placementId: Number.isFinite(targetContour.placementId) ? targetContour.placementId : null
            } : null,
            capabilities: {
                canEditValue: !!formText,
                canEditFontSize: !!formText,
                canEditAngle: !!formText,
                canAddFree: true,
                canAddAttached: !!targetContour,
                canAttach: !!(formText && formText.kind === 'free' && targetContour),
                canDetach: !!(formText && formText.kind === 'attached'),
                canDelete: !!formText
            }
        };
    }

    getEditingTextObject() {
        return this.getSelectedTextObject();
    }

    finalizeTextMutation(textObj, {
        shouldNormalize = true,
        shouldSyncControls = true,
        shouldUpdateButtons = false,
        shouldUpdateStatusBar = false,
        shouldScheduleWorkspaceSave = true
    } = {}) {
        if (shouldNormalize && textObj?.isTextObject) {
            this.syncObjectTextState(textObj);
        }

        this.canvas.requestRenderAll();

        if (shouldSyncControls) {
            this.requestControlsStateRefresh();
        }
        if (shouldUpdateButtons) {
            this.requestControlsStateRefresh();
        }
        if (shouldUpdateStatusBar) {
            this.requestStatusBarRefresh();
        }
        if (shouldScheduleWorkspaceSave) {
            this.scheduleWorkspaceSave();
        }
    }

    finalizePrimitivePropertyMutation(primitive, {
        prevDimensions = null,
        applied = false,
        shouldScheduleWorkspaceSave = true
    } = {}) {
        if (!primitive) {
            return false;
        }

        this.requestControlsStateRefresh();
        this.requestStatusBarRefresh();

        if (!applied) {
            return false;
        }

        const nextDimensions = this.primitiveManager.getPrimitiveDimensions(primitive);
        const changed = JSON.stringify(prevDimensions) !== JSON.stringify(nextDimensions);

        if (changed && shouldScheduleWorkspaceSave) {
            this.scheduleWorkspaceSave();
        }

        return changed;
    }

    applyTextValueFromInput(value) {
        this.actionExecutor?.executeAction?.('textPropertyUpdate', {
            property: 'text',
            value
        }, this);
    }

    applyTextFontSizeFromInput(value) {
        this.actionExecutor?.executeAction?.('textPropertyUpdate', {
            property: 'fontSize',
            value
        }, this);
    }

    applyTextAngleFromInput(value) {
        this.actionExecutor?.executeAction?.('textPropertyUpdate', {
            property: 'angle',
            value
        }, this);
    }

    addFreeTextForSelection() {
        const text = UIDom.texts.value?.value || '';
        const left = this.layment.left + 20;
        const top = this.layment.top + 20;
        const textObj = this.textManager.createFreeText({ text, left, top, role: 'user-text' });
        this.setActiveObjectWithSelectionSource(textObj, 'programmatic');
        this.canvas.requestRenderAll();
        this.requestControlsStateRefresh();
        this.scheduleWorkspaceSave();
    }

    addAttachedTextForSelection() {
        const selectedText = this.getSelectedTextObject();
        const contour = this.getSelectedContourForText() || (selectedText?.kind === 'attached' ? this.textManager.getContourByPlacementId(selectedText.ownerPlacementId) : null);
        if (!contour) return;
        const text = UIDom.texts.value?.value || '';
        const textObj = this.textManager.createAttachedText(contour, { text, role: 'user-text' });
        if (!textObj) return;
        this.setActiveObjectWithSelectionSource(textObj, 'programmatic');
        this.canvas.requestRenderAll();
        this.requestControlsStateRefresh();
        this.scheduleWorkspaceSave();
    }

    attachSelectedTextToSelectionContour() {
        this.actionExecutor?.executeAction?.('textAttach', {
            role: 'user-text'
        }, this);
    }

    detachSelectedText() {
        this.actionExecutor?.executeAction?.('textDetach', {}, this);
    }

    deleteSelectedText() {
        const selectedText = this.getEditingTextObject();
        if (!selectedText) return;
        this.textManager.removeText(selectedText);
        this.canvas.discardActiveObject();
        this.finalizeTextMutation(null);
    }

    async applyPrimitiveDimensions(payload = {}) {
        const primitive = this.getSingleSelectedPrimitive();
        if (!primitive) {
            return false;
        }

        const dimensions = this.primitiveManager.getPrimitiveDimensions(primitive);
        const prevDimensions = { ...dimensions };
        let applied = false;

        if (dimensions.type === 'rect') {
            const width = parseInt(payload.width, 10);
            const height = parseInt(payload.height, 10);
            if (!Number.isFinite(width) || !Number.isFinite(height)) {
                return false;
            }
            applied = await this.actionExecutor?.executeAction?.('primitiveDimensionUpdate', {
                primitive,
                dimensions: { width, height }
            }, this);
        } else if (dimensions.type === 'circle') {
            const radius = parseInt(payload.radius, 10);
            if (!Number.isFinite(radius)) {
                return false;
            }
            applied = await this.actionExecutor?.executeAction?.('primitiveDimensionUpdate', {
                primitive,
                dimensions: { radius }
            }, this);
        }

        return this.finalizePrimitivePropertyMutation(primitive, { prevDimensions, applied: Boolean(applied), shouldScheduleWorkspaceSave: false });
    }

    getVariantDisplayLabel(item) {
        if (!item) {
            return "Базовый";
        }
        return item.poseLabel || item.poseKey || "Базовый";
    }

    getStatusBarState() {
        const defaultMessage = 'Выберите контур или выемку';
        const active = this.canvas.getActiveObject();
        if (!active) {
            return {
                mode: 'empty',
                message: defaultMessage,
                isWarning: false
            };
        }

        if (active.type === 'activeSelection') {
            const selectedObjects = active.getObjects().filter(Boolean);
            const outOfBoundsObjects = new Set(this.getOutOfBoundsWorkspaceObjects());
            if (selectedObjects.length > 0 && selectedObjects.every(obj => outOfBoundsObjects.has(obj))) {
                return {
                    mode: 'selection',
                    message: selectedObjects.length === 1
                        ? 'Элемент вне границ ложемента — исправьте положение перед заказом'
                        : `Выбрано ${selectedObjects.length} элементов вне границ ложемента — исправьте положение перед заказом`,
                    isWarning: true,
                    selection: {
                        count: selectedObjects.length,
                        allOutOfBounds: true
                    }
                };
            }

            return {
                mode: 'selection',
                message: defaultMessage,
                isWarning: false,
                selection: {
                    count: selectedObjects.length,
                    allOutOfBounds: false
                }
            };
        }

        const isOutOfBounds = this.contourManager?.isObjectOutOfLaymentBounds?.(active) === true;

        if (active.primitiveType === 'rect' || active.primitiveType === 'circle') {
            const dimensions = this.primitiveManager.getPrimitiveDimensions(active);
            const laymentBbox = this.layment.getBoundingRect(true);

            if (active.primitiveType === 'rect') {
                const bbox = active.getBoundingRect(true);
                const realX = (bbox.left - laymentBbox.left).toFixed(1);
                const realY = (bbox.top - laymentBbox.top).toFixed(1);
                return {
                    mode: 'primitive',
                    isWarning: isOutOfBounds,
                    primitive: {
                        type: 'rect',
                        x: realX,
                        y: realY,
                        width: dimensions.width,
                        height: dimensions.height,
                        outOfBounds: isOutOfBounds
                    }
                };
            }

            const realX = (active.left - laymentBbox.left).toFixed(1);
            const realY = (active.top - laymentBbox.top).toFixed(1);
            return {
                mode: 'primitive',
                isWarning: isOutOfBounds,
                primitive: {
                    type: 'circle',
                    x: realX,
                    y: realY,
                    radius: dimensions.radius,
                    outOfBounds: isOutOfBounds
                }
            };
        }

        // Находим оригинальную группу контура в массиве contourManager.contours
        const contour = this.contourManager.contours.find(c =>
            c === active || (active.getObjects && active.getObjects().includes(c))
        );

        if (!contour) {
            return {
                mode: 'message',
                message: 'Контур не найден',
                isWarning: false
            };
        }

        const meta = this.contourManager.metadataMap.get(contour) || {};
        const tl = contour.aCoords.tl;  //берем координаты левыго верхнего угла контура
        const realX = (tl.x - this.layment.left).toFixed(1);
        const realY = (tl.y - this.layment.top).toFixed(1);

        return {
            mode: 'contour',
            isWarning: isOutOfBounds,
            contour: {
                name: meta.name || '—',
                article: meta.article || '—',
                x: realX,
                y: realY,
                angle: contour.angle,
                poseLabel: meta.poseLabel || null,
                outOfBounds: isOutOfBounds
            }
        };
    }

    requestStatusBarRefresh() {
        this.emitEditorCallback('onStatusBarChanged', {
            statusBar: this.getStatusBarState()
        });
    }

    deleteSelected() {
        this.actionExecutor?.executeAction?.('delete', {}, this);
    }


    async duplicateSelected() {
        await this.actionExecutor?.executeAction?.('duplicate', {}, this);
    }

    rotateSelected() {
        this.actionExecutor?.executeAction?.('rotate', {}, this);
    }

    toggleLockSelected() {
        this.actionExecutor?.executeAction?.('toggleLock', {}, this);
    }

    // =========================
    // Workspace snapshot / save / restore
    // =========================

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
            this.emitEditorCallback('onAutosaveRequested', { mode: 'autosave' });
        }, AUTOSAVE_DEBOUNCE_MS);
    }

    buildWorkspaceSnapshot(options = {}) {
        const includeEditorState = options.includeEditorState !== false;
        const layment = this.canvas.layment;
        return {
            schemaVersion: 4,
            savedAt: new Date().toISOString(),
            layment: {
                width: Math.round(layment.width),
                height: Math.round(layment.height),
                offset: layment.left
            },
            workspaceScale: 1,
            baseMaterialColor: this.baseMaterialColor,
            laymentThicknessMm: this.laymentThicknessMm,
            contours: this.contourManager.getWorkspaceContoursData({ includeEditorState }),
            primitives: this.contourManager.getPrimitivesData({ includeEditorState }),
            texts: this.textManager.getWorkspaceTextsData({ includeEditorState })
        };
    }

    getDocumentState() {
        return {
            width: Math.round(this.layment?.width || 0),
            height: Math.round(this.layment?.height || 0),
            baseMaterialColor: this.baseMaterialColor,
            laymentThicknessMm: this.laymentThicknessMm,
            workspaceScale: this.workspaceScale,
            contourCount: this.contourManager?.contours?.length || 0,
            primitiveCount: this.primitiveManager?.primitives?.length || 0,
            textCount: this.textManager?.texts?.length || 0
        };
    }

    getLaymentSettingsState() {
        const width = Math.round(this.layment?.width || Config.LAYMENT_DEFAULT_WIDTH);
        const height = Math.round(this.layment?.height || Config.LAYMENT_DEFAULT_HEIGHT);
        return {
            width,
            height,
            preset: this.resolveLaymentPreset(width, height),
            baseMaterialColor: this.baseMaterialColor,
            laymentThicknessMm: this.laymentThicknessMm
        };
    }

    async getWorkspaceState(options = {}) {
        return await this.performWithScaleOne(() => this.buildWorkspaceSnapshot(options));
    }

    getSelectionState() {
        const active = this.canvas?.getActiveObject?.() || null;
        const selectedObjects = this.getSelectionObjects(active);

        return {
            hasSelection: selectedObjects.length > 0,
            selectionType: active?.type === 'activeSelection' ? 'multi' : (selectedObjects.length ? 'single' : 'empty'),
            count: selectedObjects.length,
            objects: selectedObjects.map(obj => this.buildSelectionObjectSnapshot(obj)).filter(Boolean)
        };
    }

    buildSelectionObjectSnapshot(obj) {
        if (!obj) {
            return null;
        }

        const meta = this.objectMetaApi?.getObjectMeta?.(obj) || {};
        const base = {
            objectRole: meta.objectRole || (obj.isTextObject ? 'text' : (obj.primitiveType ? 'primitive' : 'contour')),
            placementId: Number.isFinite(obj.placementId) ? obj.placementId : (Number.isFinite(meta.placementId) ? meta.placementId : null),
            groupId: this.objectMetaApi?.getGroupId?.(obj) || null,
            isLocked: this.interactionPolicy?.isSemanticallyLocked?.(obj) === true,
            angle: Number.isFinite(obj.angle) ? obj.angle : 0,
            boundsMm: this.getObjectBoundsRelativeToLayment(obj)
        };

        if (obj.isTextObject) {
            return {
                ...base,
                type: obj.kind === 'attached' ? 'attached-text' : 'free-text',
                text: typeof obj.text === 'string' ? obj.text : '',
                fontSizeMm: Number(obj.fontSize) || null,
                ownerPlacementId: Number.isFinite(obj.ownerPlacementId) ? obj.ownerPlacementId : null,
                role: obj.role || 'user-text'
            };
        }

        if (obj.primitiveType) {
            const dimensions = this.primitiveManager.getPrimitiveDimensions(obj);
            return {
                ...base,
                type: obj.primitiveType,
                dimensionsMm: dimensions
            };
        }

        const contourMeta = this.contourManager?.metadataMap?.get?.(obj) || {};
        return {
            ...base,
            type: 'contour',
            id: contourMeta.id || obj.contourId || null,
            article: contourMeta.article || null,
            name: contourMeta.name || null,
            poseKey: contourMeta.poseKey || null,
            poseLabel: contourMeta.poseLabel || null
        };
    }

    getObjectBoundsRelativeToLayment(obj) {
        if (!obj || !this.layment || typeof obj.getBoundingRect !== 'function') {
            return null;
        }

        const rect = obj.getBoundingRect(true, true);
        return {
            x: Math.round(rect.left - this.layment.left),
            y: Math.round(rect.top - this.layment.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
        };
    }

    // =========================
    // Export / preview / order flow
    // =========================

    async validateLayoutCommand() {
        return await this.performWithScaleOne(() => {
            const validation = this.contourManager.checkCollisionsAndHighlight();
            return {
                ok: validation.ok,
                issues: validation.issues,
                message: validation.ok
                    ? Config.MESSAGES.VALID_LAYOUT
                    : this.formatLayoutIssuesMessage(validation.issues)
            };
        });
    }

    buildExportPayload(options = {}) {
        const includePreview = options.includePreview !== false;
        const includeWorkspaceSnapshot = options.includeWorkspaceSnapshot !== false;
        const realWidth = Math.round(this.layment.width);
        const realHeight = Math.round(this.layment.height);
        const laymentType = (this.contourManager.contours.length > 0 || this.primitiveManager.primitives.length > 0)
            ? 'with-tools'
            : 'empty';

        const layoutPng = includePreview ? this.createLaymentPreviewPng(16) : null;
        const layoutSvg = includePreview ? this.canvas.toSVG() : null;

        return {
            orderMeta: {
                width: realWidth,
                height: realHeight,
                units: 'mm',
                coordinateSystem: 'origin-top-left',
                baseMaterialColor: this.baseMaterialColor,
                laymentThicknessMm: this.laymentThicknessMm,
                laymentType,
                ...(includePreview ? { canvasPng: layoutPng } : {}),
                ...(includeWorkspaceSnapshot ? { workspaceSnapshot: this.buildWorkspaceSnapshot({ includeEditorState: false }) } : {})
            },
            ...(includePreview ? { layoutPng, layoutSvg } : {}),
            contours: this.buildExportContours(),
            primitives: this.buildExportPrimitives(),
            texts: this.buildExportTexts(),
            customer: options.customer ?? null
        };
    }

    async getExportState(options = {}) {
        return await this.performWithScaleOne(() => this.buildExportPayload(options));
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
            this.applyMaterialColorToCutouts();

            this.laymentThicknessMm = this.getValidLaymentThickness(data.laymentThicknessMm);
            this.updateLaymentSize(width, height);
            this.layment.set({ left: offset, top: offset });
            this.layment.setCoords();
            this.syncSafeAreaRect();

            await this.batchRender(async () => {
                for (const contour of data.contours || []) {
                    const contourAssetSvg = contour?.assets?.svg;
                    if (!contourAssetSvg) {
                        console.warn('Не удалось восстановить contour без assets.svg', contour?.id);
                        continue;
                    }
                    const metadata = {
                        id: contour.id || null,
                        article: contour.article || '',
                        name: contour.name || '',
                        poseKey: contour.poseKey || null,
                        poseLabel: contour.poseLabel || null,
                        scaleOverride: contour.scaleOverride ?? 1,
                        cuttingLengthMeters: Number.isFinite(contour.cuttingLengthMeters) ? contour.cuttingLengthMeters : 0,
                        assets: {
                            ...(contour.assets || {}),
                            svg: contourAssetSvg
                        },
                        depthOverrideMm: Number.isFinite(contour.depthOverrideMm) ? contour.depthOverrideMm : undefined
                    };
                    await this.contourManager.addContour(
                        `/contours/${contourAssetSvg}`,
                        { x: this.layment.left, y: this.layment.top },
                        metadata
                    );
                    const added = this.contourManager.contours[this.contourManager.contours.length - 1];
                    added.placementId = contour.placementId;
                    this.objectMetaApi?.patchObjectMeta?.(added, {
                        placementId: contour.placementId,
                        isLocked: contour.isLocked === true,
                        groupId: contour.editorState?.groupId ?? contour.groupId ?? null
                    });
                    this.objectMetaApi?.applyInteractionState?.(added);
                    this.applyObjectVisualState(added);
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
                    const textObj = this.textManager.createFreeText({
                        text: savedText.text,
                        role: savedText.role,
                        left: this.layment.left + savedText.x,
                        top: this.layment.top + savedText.y,
                        fontSizeMm: savedText.fontSizeMm
                    });
                    this.objectMetaApi?.patchObjectMeta?.(textObj, {
                        isLocked: savedText.isLocked === true,
                        groupId: savedText.editorState?.groupId ?? null
                    });
                    this.objectMetaApi?.applyInteractionState?.(textObj);
                    this.applyObjectVisualState(textObj);
                    continue;
                }

                const contour = this.contourManager.contours.find(c => c.placementId === savedText.ownerPlacementId);
                if (!contour) {
                    continue;
                }
                const textObj = this.textManager.createAttachedText(contour, {
                    text: savedText.text,
                    role: savedText.role,
                    left: this.layment.left + savedText.x,
                    top: this.layment.top + savedText.y,
                    fontSizeMm: savedText.fontSizeMm,
                    localOffsetX: savedText.localOffsetX,
                    localOffsetY: savedText.localOffsetY,
                    localAngle: savedText.localAngle
                });
                this.objectMetaApi?.patchObjectMeta?.(textObj, {
                    isLocked: savedText.isLocked === true,
                    groupId: savedText.editorState?.groupId ?? null
                });
                this.objectMetaApi?.applyInteractionState?.(textObj);
                this.applyObjectVisualState(textObj);
            }

            await this.batchRender(() => {
                for (const primitive of data.primitives || []) {
                    const x = this.layment.left + primitive.x;
                    const y = this.layment.top + primitive.y;
                    let addedPrimitive = null;
                    if (primitive.type === 'rect') {
                        addedPrimitive = this.primitiveManager.addPrimitive('rect', { x, y }, { width: primitive.width, height: primitive.height }, { pocketDepthMm: primitive.pocketDepthMm });
                    } else if (primitive.type === 'circle') {
                        addedPrimitive = this.primitiveManager.addPrimitive('circle', { x, y }, { radius: primitive.radius }, { pocketDepthMm: primitive.pocketDepthMm });
                    }

                    if (addedPrimitive) {
                        this.objectMetaApi?.patchObjectMeta?.(addedPrimitive, {
                            isLocked: primitive.isLocked === true,
                            groupId: primitive.editorState?.groupId ?? primitive.groupId ?? null
                        });
                        this.objectMetaApi?.applyInteractionState?.(addedPrimitive);
                        this.applyObjectVisualState(addedPrimitive);
                    }
                }
            });

                this.applyMaterialColorToCutouts();
                this.canvas.requestRenderAll();
                this.requestControlsStateRefresh();
                this.requestStatusBarRefresh();
            });
        } finally {
            this.isRestoringWorkspace = false;
        }
        this.fitToLayment();
        this.syncWorkspaceScaleInput();
    }

    getTotalCuttingLength() {
        return this.contourManager.contours.reduce((sum, contour) => {
            const meta = this.contourManager.metadataMap.get(contour) || {};
            return sum + (Number(meta.cuttingLengthMeters) || 0);
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

        this.viewportFeedbackActive = false;
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

        this.resetWorkspaceVisualStateIssues();

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

        this.setObjectsVisualState(Array.from(problematic), 'error');

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

    build3dPreviewPayload() {
        return this.performWithScaleOne(() => {
            const boundsValidation = this.checkOutOfBoundsOnlyAndHighlight();
            if (!boundsValidation.ok) {
                return {
                    ok: false,
                    error: {
                        code: 'preview_out_of_bounds',
                        message: this.formatOutOfBoundsOnlyMessage(boundsValidation.issues)
                    }
                };
            }

            let svg;
            try {
                svg = this.buildPreviewSvg();
            } catch (error) {
                console.error(error);
                return {
                    ok: false,
                    error: {
                        code: 'preview_svg_build_failed',
                        message: 'Не удалось собрать SVG для 3D предпросмотра. Попробуйте ещё раз.'
                    }
                };
            }

            const texts = this.textManager?.buildExportTexts?.() || [];

            return {
                ok: true,
                result: {
                    version: 3,
                    svg,
                    texts: Array.isArray(texts) ? texts : [],
                    baseMaterialColor: this.baseMaterialColor,
                    laymentThicknessMm: this.laymentThicknessMm
                }
            };
        });
    }

    buildPreviewSvg() {
        const textObjects = this.canvas.getObjects().filter(obj => obj?.isTextObject);
        const prev = textObjects.map(textObj => ({
            textObj,
            visible: textObj.visible
        }));

        textObjects.forEach(textObj => textObj.set('visible', false));
        this.canvas.requestRenderAll();

        try {
            return this.canvas.toSVG();
        } finally {
            prev.forEach(({ textObj, visible }) => textObj.set('visible', visible));
            this.canvas.requestRenderAll();
        }
    }

    // =========================
    // Low-level helpers
    // =========================

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

    async validateForOrder() {
        const validation = await this.validateLayoutCommand();
        if (!validation.ok) {
            return {
                ok: false,
                message: validation.message
            };
        }

        return { ok: true };
    }

    async buildOrderRequest(customer) {
        const normalizedCustomer = {
            name: (customer?.name || '').trim().replace(/\s+/g, ' '),
            contact: (customer?.contact || '').trim().replace(/[^0-9A-Za-zА-Яа-яЁё+@.-]/g, '')
        };

        if (!normalizedCustomer.name || !normalizedCustomer.contact) {
            return {
                ok: false,
                error: {
                    code: 'order_customer_required',
                    message: 'Заполните имя и контакт, чтобы создать заказ.'
                }
            };
        }

        try {
            const validation = await this.validateForOrder();
            if (!validation.ok) {
                return {
                    ok: false,
                    error: {
                        code: 'order_validation_failed',
                        message: validation.message
                    }
                };
            }

            const data = this.buildExportPayload({
                includePreview: true,
                includeWorkspaceSnapshot: true,
                customer: normalizedCustomer
            });

            return {
                ok: true,
                result: data
            };
        } catch (err) {
            console.error(err);
            return {
                ok: false,
                error: {
                    code: 'order_build_failed',
                    message: 'Не получилось подготовить заказ. Проверьте данные и попробуйте снова. ' + (err?.message || '')
                }
            };
        }
    }

    buildExportContours() {
        return this.contourManager.getContoursData();
    }

    buildExportPrimitives() {
        return this.contourManager.getPrimitivesData({ includeEditorState: false });
    }

    buildExportTexts() {
        const layment = this.canvas?.layment;
        if (!layment) {
            return [];
        }

        return this.textManager.buildExportTexts();
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

// =========================
// Global export / bootstrap at file end
// =========================
window.ContourApp = ContourApp;
window.EditorFacade?.registerEditorFactory?.((options) => new ContourApp(options));
