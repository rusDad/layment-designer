// app.js

const WORKSPACE_STORAGE_KEY = 'laymentDesigner.workspace.v2';

class ContourApp {
    constructor() {
        this.canvas = null;
        this.layment = null;                  
        this.safeArea = null;
        this.workspaceScale = Config.WORKSPACE_SCALE.DEFAULT;
        this.laymentOffset = Config.LAYMENT_OFFSET;
        this.availableContours = [];
        this.availableCategories = [];
        this.categoryLabels = {};
        this.currentCategory = null;
        this.catalogQuery = '';
        this.autosaveTimer = null;
        this.isRestoringWorkspace = false;
        this.isSyncingPrimitiveControls = false;
        this.exportButtonDefaultText = UIDom.buttons.export?.textContent || 'Завершить';
        this.exportCooldownMs = 5000;
        this.exportInProgress = false;
        this.lastOrderResult = null;
        this.baseMaterialColor = Config.DEFAULT_MATERIAL_COLOR;

        this.init();
    }

    async init() {
        this.initializeCanvas();
        this.initializeServices();
        this.createLayment();
        this.initializeMaterialColor();
        await this.loadAvailableContours();
        this.setupEventListeners();
        this.syncPrimitiveControlsFromSelection();
        this.syncLabelControlsFromSelection();
        await this.loadWorkspaceFromStorage();
    }

    initializeCanvas() {
        const container = document.querySelector('.canvas-scroll-container');
        const getCanvasSize = () => {
            if (!container) {
                return {
                    width: window.innerWidth - Config.UI.PANEL_WIDTH - Config.UI.CANVAS_PADDING,
                    height: window.innerHeight - Config.UI.HEADER_HEIGHT
                };
            }
            const rect = container.getBoundingClientRect();
            return {
                width: Math.max(0, Math.floor(rect.width)),
                height: Math.max(0, Math.floor(rect.height))
            };
        };

        const initialSize = getCanvasSize();
        this.canvas = new fabric.Canvas('workspaceCanvas', {
            width: initialSize.width,
            height: initialSize.height,
            backgroundColor: Config.UI.CANVAS_BACKGROUND,
            selection: true,
            preserveObjectStacking: true
        });

        const resizeCanvas = () => {
            const size = getCanvasSize();
            if (size.width > 0 && size.height > 0) {
                this.canvas.setDimensions({ width: size.width, height: size.height });
                this.canvas.renderAll();
            }
        };

        window.addEventListener('resize', resizeCanvas);
        requestAnimationFrame(resizeCanvas);
    }

    initializeServices() {
        this.contourManager = new ContourManager(this.canvas, this);  // Pass this (app) to ContourManager
        this.primitiveManager = new PrimitiveManager(this.canvas, this);  // Новый менеджер для примитивов
        this.labelManager = new LabelManager(this.canvas, this, this.contourManager);
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
            this.availableCategories = this.buildCategories(this.availableContours);
            this.ensureValidCategory();
            this.renderCatalogNav();
            this.renderCatalogList();
        } catch (err) {
                console.error('Ошибка загрузки manifest', err);
                alert(Config.MESSAGES.LOADING_ERROR);
        }
    }

    async addContour(item) {
        const centerX = this.layment.left + this.layment.width / 2;
        const centerY = this.layment.top + this.layment.height / 2;

        await this.contourManager.addContour(
            `/contours/${item.assets.svg}`,
            { x: centerX, y: centerY },
            this.workspaceScale,
            item
        );

        const contourObj = this.contourManager.contours[this.contourManager.contours.length - 1];
        this.labelManager.ensureDefaultLabelForContour(contourObj, item.defaultLabel);
        this.scheduleWorkspaceSave();
    }

    updateLaymentSize(width, height) {
        this.layment.set({ width, height });
        this.layment.setCoords();
        this.syncSafeAreaRect();
        this.canvas.renderAll();
        this.scheduleWorkspaceSave();
    }

    updateWorkspaceScale(newScale) {
        if (newScale < Config.WORKSPACE_SCALE.MIN || newScale > Config.WORKSPACE_SCALE.MAX) return;

        const saved = this.temporarilyUngroupActiveSelection();
        const ratio = newScale / this.workspaceScale;
        this.workspaceScale = newScale;

        this.canvas.getObjects().forEach(obj => {
            if (obj === this.safeArea) {
                return;
            }

            obj.set({
                left: obj.left * ratio,
                top: obj.top * ratio,
                scaleX: obj.scaleX * ratio,
                scaleY: obj.scaleY * ratio
            });
            obj.setCoords();
        });

        this.syncSafeAreaRect();

        // рассчитываем bounding box всех объектов и устанавливаем размер canvas
        const allObjects = this.canvas.getObjects();
        if (allObjects.length > 0) {
          const boundingRect = fabric.util.makeBoundingBoxFromPoints(
             allObjects.flatMap(obj => Object.values(obj.aCoords))
            );
          const newWidth = Math.max(this.canvas.width, boundingRect.left + boundingRect.width + 100); // +100 для запаса
          const newHeight = Math.max(this.canvas.height, boundingRect.top + boundingRect.height + 100);
          this.canvas.setDimensions({ width: newWidth, height: newHeight });
        }

        this.canvas.renderAll();
        this.updateStatusBar();
        this.restoreActiveSelection(saved.objects);
    }

    setupEventListeners() {
        this.bindCanvasEvents();
        this.bindUIButtonEvents();
        this.bindInputEvents();
        this.bindCatalogEvents();
        this.bindKeyboardShortcuts();
    }

    bindKeyboardShortcuts() {
        document.addEventListener('keydown', event => {
            if (event.defaultPrevented || this.shouldIgnoreKeyboardShortcut(event)) {
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
                        this.updateButtons();
                        this.updateStatusBar();
                        this.syncPrimitiveControlsFromSelection();
                        this.syncLabelControlsFromSelection();
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
                if (!obj.primitiveType && !obj.isLabel && obj !== this.layment && obj !== this.safeArea) {
                    obj._lastLeft = obj.left;
                    obj._lastTop = obj.top;
                }
                obj.set({
                    left: obj.left + dx,
                    top: obj.top + dy
                });
                obj.setCoords();
                if (!obj.primitiveType && !obj.isLabel && obj !== this.layment && obj !== this.safeArea) {
                    this.labelManager.onContourMoving(obj);
                }
            });
            active.setCoords();
        } else {
            if (!active.primitiveType && !active.isLabel && active !== this.layment && active !== this.safeArea) {
                active._lastLeft = active.left;
                active._lastTop = active.top;
            }
            active.set({
                left: active.left + dx,
                top: active.top + dy
            });
            active.setCoords();
            if (!active.primitiveType && !active.isLabel && active !== this.layment && active !== this.safeArea) {
                this.labelManager.onContourMoving(active);
            }
        }

        this.canvas.requestRenderAll();
        this.updateStatusBar();
        this.scheduleWorkspaceSave();
        return true;
    }

    bindCanvasEvents() {
        this.canvas.on('selection:created', () => {
            this.updateButtons();
            this.updateStatusBar();
            this.syncPrimitiveControlsFromSelection();
            this.syncLabelControlsFromSelection();
        });

        this.canvas.on('selection:updated', () => {
            this.updateButtons();
            this.updateStatusBar();
            this.syncPrimitiveControlsFromSelection();
            this.syncLabelControlsFromSelection();
        });

        this.canvas.on('selection:cleared', () => {
            this.updateButtons();
            this.updateStatusBar();
            this.syncPrimitiveControlsFromSelection();
            this.syncLabelControlsFromSelection();
        });

        this.canvas.on('object:moving', event => {
            const target = event.target;
            if (target && !target.primitiveType && !target.isLabel && target !== this.layment && target !== this.safeArea) {
                this.labelManager.onContourMoving(target);
            }
            this.updateStatusBar();
        });

        this.canvas.on('object:modified', event => {
            const target = event.target;
            if (target && !target.primitiveType && !target.isLabel && target !== this.layment && target !== this.safeArea) {
                this.labelManager.onContourModified(target);
            }
            if (this.shouldAutosaveForObject(target)) {
                this.scheduleWorkspaceSave();
            }
            this.syncPrimitiveControlsFromSelection();
            this.syncLabelControlsFromSelection();
            this.updateStatusBar();
        });
    }    
    bindUIButtonEvents() {
        UIDom.buttons.delete.onclick = () => this.deleteSelected();
        UIDom.buttons.rotate.onclick = () => this.rotateSelected();
        UIDom.buttons.saveWorkspace.onclick = () => this.saveWorkspace();
        UIDom.buttons.loadWorkspace.onclick = () => this.loadWorkspaceFromStorage();

        UIDom.buttons.export.onclick = () => this.withExportCooldown(() => this.performWithScaleOne(() => this.exportData()));

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

        UIDom.inputs.workspaceScale.addEventListener('change', e => {
            const s = parseFloat(e.target.value);
            if (s >= Config.WORKSPACE_SCALE.MIN && s <= Config.WORKSPACE_SCALE.MAX) {
            this.updateWorkspaceScale(s);
            } else {
            e.target.value = this.workspaceScale;
            }
        });

        // зум колёсиком
        const scaleInput = UIDom.inputs.workspaceScale;
        this.canvas.wrapperEl.addEventListener('wheel', e => {
           e.preventDefault();
           const step = e.ctrlKey ? 0.05 : 0.1;        // с Ctrl — мелкий шаг
           const delta = e.deltaY > 0 ? -step : step;
            let val = parseFloat(scaleInput.value) || 1;

            val = Math.max(0.5, Math.min(10, val + delta));
            val = Math.round(val * 100) / 100;

            scaleInput.value = val;
            scaleInput.dispatchEvent(new Event('change'));
        }, { passive: false });

        UIDom.inputs.primitiveWidth.addEventListener('change', () => this.applyPrimitiveDimensionsFromInputs());
        UIDom.inputs.primitiveHeight.addEventListener('change', () => this.applyPrimitiveDimensionsFromInputs());
        UIDom.inputs.primitiveRadius.addEventListener('change', () => this.applyPrimitiveDimensionsFromInputs());

        UIDom.labels.textInput?.addEventListener('input', event => this.applyLabelTextFromInput(event.target.value));
        UIDom.labels.addBtn?.addEventListener('click', () => this.addLabelForSelection());
        UIDom.labels.deleteBtn?.addEventListener('click', () => this.deleteLabelForSelection());
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

   
    // Выполнить с временным  scale=1

    async performWithScaleOne(action) {
        const oldScale = this.workspaceScale;
        this.updateWorkspaceScale(1);
        const result = await action();
        this.updateWorkspaceScale(oldScale);
        return result;
    }

    getArrangeSelectionObjects() {
        const active = this.canvas.getActiveObject();
        if (!active) {
            return [];
        }
        if (active.type === 'activeSelection') {
            return active.getObjects().filter(obj => this.shouldAutosaveForObject(obj));
        }
        return this.shouldAutosaveForObject(active) ? [active] : [];
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

        const selection = new fabric.ActiveSelection(objects, { canvas: this.canvas });
        this.canvas.setActiveObject(selection);
        selection.setCoords();
        this.canvas.requestRenderAll();
    }

    applyDeltaToObject(obj, deltaX, deltaY) {
        const isContour = !obj.primitiveType && !obj.isLabel && obj !== this.layment && obj !== this.safeArea;
        if (isContour) {
            obj._lastLeft = obj.left;
            obj._lastTop = obj.top;
        }

        obj.set({
            left: obj.left + deltaX,
            top: obj.top + deltaY
        });
        obj.setCoords();

        if (isContour) {
            this.labelManager.onContourMoving(obj);
        }
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
    }

    distributeSelected(mode) {
        const selected = this.getArrangeSelectionObjects();
        if (selected.length < 3) {
            return;
        }

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
    }

    snapSelectedToSide(side) {
        const saved = this.temporarilyUngroupActiveSelection();
        const selected = this.getArrangeSelectionObjects();
        if (selected.length < 1) {
            this.restoreActiveSelection(saved.objects);
            return;
        }

        const targetArea = (this.safeArea || this.layment).getBoundingRect(true);
        const clearanceMm = 3;
        const clearancePx = clearanceMm * (this.workspaceScale || 1);

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
        this.restoreActiveSelection(saved.objects);
    }

    updateButtons() {
        const selected = this.getArrangeSelectionObjects();
        const selectedCount = selected.length;
        const active = this.canvas.getActiveObject();
        const has = !!active;

        UIDom.buttons.delete.disabled = !has;
        UIDom.buttons.rotate.disabled = !has || !!active?.primitiveType;

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


    getSelectedContourForLabel() {
        const active = this.canvas.getActiveObject();
        if (!active || active.type === 'activeSelection' || active.primitiveType || active.isLabel || active === this.layment || active === this.safeArea) {
            return null;
        }
        return active;
    }

    getSelectedLabelObject() {
        const active = this.canvas.getActiveObject();
        if (!active || active.type === 'activeSelection') {
            return null;
        }
        return active.isLabel ? active : null;
    }

    setLabelPanelEnabled(enabled) {
        const panel = UIDom.labels.panel;
        if (!panel) {
            return;
        }
        panel.hidden = !enabled;
        panel.setAttribute('aria-disabled', enabled ? 'false' : 'true');
        if (UIDom.labels.textInput) UIDom.labels.textInput.disabled = !enabled;
        if (!enabled) {
            if (UIDom.labels.addBtn) UIDom.labels.addBtn.disabled = true;
            if (UIDom.labels.deleteBtn) UIDom.labels.deleteBtn.disabled = true;
        }
    }

    syncLabelControlsFromSelection() {
        const contour = this.getSelectedContourForLabel();
        const selectedLabel = this.getSelectedLabelObject();

        if (!contour && !selectedLabel) {
            this.setLabelPanelEnabled(false);
            if (UIDom.labels.textInput) UIDom.labels.textInput.value = '';
            return;
        }

        this.setLabelPanelEnabled(true);

        if (selectedLabel) {
            if (UIDom.labels.textInput) UIDom.labels.textInput.value = selectedLabel.text || '';
            if (UIDom.labels.addBtn) UIDom.labels.addBtn.disabled = true;
            if (UIDom.labels.deleteBtn) UIDom.labels.deleteBtn.disabled = false;
            return;
        }

        const label = this.labelManager.getLabelByPlacementId(contour.placementId);
        const meta = this.contourManager.metadataMap.get(contour);
        if (UIDom.labels.textInput) {
            UIDom.labels.textInput.value = label ? (label.text || '') : (meta?.defaultLabel || '');
        }
        if (UIDom.labels.addBtn) UIDom.labels.addBtn.disabled = Boolean(label);
        if (UIDom.labels.deleteBtn) UIDom.labels.deleteBtn.disabled = !label;
    }

    applyLabelTextFromInput(value) {
        const selectedLabel = this.getSelectedLabelObject();
        const contour = this.getSelectedContourForLabel();
        const targetLabel = selectedLabel || (contour ? this.labelManager.getLabelByPlacementId(contour.placementId) : null);

        if (!targetLabel) {
            return;
        }

        targetLabel.set({ text: value });
        targetLabel.dirty = true;
        targetLabel.setCoords();
        this.canvas.requestRenderAll();
        this.scheduleWorkspaceSave();
        this.syncLabelControlsFromSelection();
    }

    addLabelForSelection() {
        const contour = this.getSelectedContourForLabel();
        if (!contour) {
            return;
        }

        const text = UIDom.labels.textInput?.value ?? '';
        const label = this.labelManager.createOrUpdateLabelForContour(contour, text);
        if (!label) {
            return;
        }

        this.canvas.setActiveObject(label);
        this.canvas.requestRenderAll();
        this.syncLabelControlsFromSelection();
        this.scheduleWorkspaceSave();
    }

    deleteLabelForSelection() {
        const selectedLabel = this.getSelectedLabelObject();
        if (selectedLabel) {
            this.labelManager.removeLabel(selectedLabel);
            this.canvas.discardActiveObject();
            this.canvas.requestRenderAll();
            this.syncLabelControlsFromSelection();
            this.scheduleWorkspaceSave();
            return;
        }

        const contour = this.getSelectedContourForLabel();
        if (!contour) {
            return;
        }

        const label = this.labelManager.getLabelByPlacementId(contour.placementId);
        if (!label) {
            return;
        }

        this.labelManager.removeLabel(label);
        this.canvas.requestRenderAll();
        this.syncLabelControlsFromSelection();
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

        if (!this.availableContours.length) {
            return;
        }

        const hasQuery = Boolean(this.catalogQuery.trim());

        if (!this.currentCategory) {
            if (!hasQuery) {
                this.renderFolderRows(list, this.availableCategories);
                return;
            }

            const items = this.availableContours.filter(item => this.matchesItemQuery(item));
            this.renderItemRows(list, items, { showCategoryLabel: true });
            return;
        }

        const items = this.availableContours
            .filter(item => this.getCategoryLabel(item) === this.currentCategory)
            .filter(item => this.matchesItemQuery(item));
        this.renderItemRows(list, items);
    }

    matchesItemQuery(item) {
        const query = this.catalogQuery.trim().toLowerCase();
        if (!query) {
            return true;
        }
        const fields = [
            item.article,
            item.name
        ]
            .filter(Boolean)
            .map(value => value.toLowerCase());
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

        items.forEach(item => {
            const row = document.createElement('div');
            row.className = 'catalog-row';
            row.addEventListener('click', () => this.addContour(item));

            const previewWrapper = this.createPreviewElement(item);

            const meta = document.createElement('div');
            meta.className = 'catalog-item-meta';

            const article = document.createElement('div');
            article.className = 'catalog-item-article';
            article.textContent = item.article || '';

            const name = document.createElement('div');
            name.className = 'catalog-item-name';
            name.textContent = item.name || '';

            meta.appendChild(article);
            meta.appendChild(name);

            if (showCategoryLabel) {
                const category = this.getCategoryLabel(item);
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
                this.addContour(item);
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
            statusEl.textContent = 'Ничего не выделено';
            return;
        }

        if (active.primitiveType === 'rect' || active.primitiveType === 'circle') {
            const dimensions = this.primitiveManager.getPrimitiveDimensions(active);
            const laymentBbox = this.layment.getBoundingRect(true);

            if (active.primitiveType === 'rect') {
                const bbox = active.getBoundingRect(true);
                const realX = ((bbox.left - laymentBbox.left) / this.workspaceScale).toFixed(1);
                const realY = ((bbox.top - laymentBbox.top) / this.workspaceScale).toFixed(1);
                statusEl.innerHTML = `
                <strong>Выемка: Прямоугольная</strong>
                X: ${realX} мм  Y: ${realY} мм  W: ${dimensions.width} мм  H: ${dimensions.height} мм`;
                return;
            }

            const realX = ((active.left - laymentBbox.left) / this.workspaceScale).toFixed(1);
            const realY = ((active.top - laymentBbox.top) / this.workspaceScale).toFixed(1);
            statusEl.innerHTML = `
            <strong>Выемка: Круглая</strong>
            X: ${realX} мм  Y: ${realY} мм  R: ${dimensions.radius} мм`;
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
        const realX = ((tl.x - this.layment.left) / this.workspaceScale).toFixed(1);
        const realY = ((tl.y - this.layment.top) / this.workspaceScale).toFixed(1);

        const article = meta.article || '—';
        statusEl.innerHTML = `
        <strong>${meta.name}</strong><br>
        article: ${article}<br>
        X: ${realX} мм  Y: ${realY} мм  Угол: ${contour.angle}°`;
    }

    deleteSelected() {
        const obj = this.canvas.getActiveObject();
        if (!obj) return;
        if (obj.type === 'activeSelection') {
            obj.forEachObject(o => {
                if (o.isLabel) {
                    this.labelManager.removeLabel(o);
                } else if (o.primitiveType) {
                    this.primitiveManager.removePrimitive(o);
                } else {
                    this.labelManager.removeLabelsForPlacementId(o.placementId);
                    this.contourManager.removeContour(o);
                }
            });
        } else {
            if (obj.isLabel) {
                this.labelManager.removeLabel(obj);
            } else if (obj.primitiveType) {
                this.primitiveManager.removePrimitive(obj);
            } else {
                this.labelManager.removeLabelsForPlacementId(obj.placementId);
                this.contourManager.removeContour(obj);
            }
        }
        this.canvas.discardActiveObject();
        this.canvas.renderAll();
        this.updateButtons();
        this.syncLabelControlsFromSelection();
        this.scheduleWorkspaceSave();
    }

    rotateSelected() {
        const obj = this.canvas.getActiveObject();
        if (!obj || obj.primitiveType || obj.isLabel) return;  // Нет поворота для примитивов и labels
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

    scheduleWorkspaceSave() {
        if (this.isRestoringWorkspace) {
            return;
        }
        if (this.autosaveTimer) {
            clearTimeout(this.autosaveTimer);
        }
        this.autosaveTimer = setTimeout(() => {
            this.saveWorkspace();
        }, 400);
    }

    buildWorkspaceSnapshot() {
        const layment = this.canvas.layment;
        return {
            schemaVersion: 2,
            savedAt: new Date().toISOString(),
            layment: {
                width: Math.round(layment.width),
                height: Math.round(layment.height),
                offset: layment.left
            },
            workspaceScale: 1,
            baseMaterialColor: this.baseMaterialColor,
            contours: this.contourManager.getWorkspaceContoursData(),
            primitives: this.contourManager.getPrimitivesData(),
            labels: this.labelManager.getWorkspaceLabelsData()
        };
    }

    async saveWorkspace() {
        try {
            await this.performWithScaleOne(() => {
                const payload = this.buildWorkspaceSnapshot();
                localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(payload));
            });
        } catch (err) {
            console.error('Ошибка сохранения workspace', err);
        }
    }

    async loadWorkspaceFromStorage() {
        const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
        if (!raw) {
            return;
        }

        let data;
        try {
            data = JSON.parse(raw);
        } catch (err) {
            console.error('Ошибка чтения workspace', err);
            return;
        }

        if (data.schemaVersion !== 2) {
            console.warn('Неподдерживаемая версия workspace', data.schemaVersion);
            return;
        }

        await this.loadWorkspace(data);
    }

    async loadWorkspace(data) {
        this.isRestoringWorkspace = true;
        await this.performWithScaleOne(async () => {
            this.canvas.discardActiveObject();
            this.contourManager.clearContours();
            this.primitiveManager.clearPrimitives();
            this.labelManager.clearLabels();

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

            UIDom.inputs.laymentWidth.value = width;
            UIDom.inputs.laymentHeight.value = height;
            this.syncLaymentPresetBySize(width, height);
            this.updateLaymentSize(width, height);
            this.layment.set({ left: offset, top: offset });
            this.layment.setCoords();
            this.syncSafeAreaRect();

            for (const contour of data.contours || []) {
                const meta = this.manifest?.[contour.id];
                if (!meta) {
                    console.warn('Контур не найден в manifest', contour.id);
                    continue;
                }
                const metadata = { ...meta, scaleOverride: contour.scaleOverride ?? meta.scaleOverride };
                await this.contourManager.addContour(
                    `/contours/${metadata.assets.svg}`,
                    { x: this.layment.left, y: this.layment.top },
                    this.workspaceScale,
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

            const placementIds = this.contourManager.contours
                .map(c => c.placementId)
                .filter(id => Number.isFinite(id));
            const maxPlacementId = placementIds.length ? Math.max(...placementIds) : 0;
            this.contourManager.nextPlacementSeq = maxPlacementId + 1;

            if (Array.isArray(data.labels)) {
                for (const labelData of data.labels) {
                    const contour = this.contourManager.contours.find(c => c.placementId === labelData.placementId);
                    if (!contour) {
                        continue;
                    }
                    this.labelManager.createLabel({
                        placementId: labelData.placementId,
                        text: labelData.text,
                        left: this.layment.left + labelData.x,
                        top: this.layment.top + labelData.y,
                        fontSize: labelData.fontSizeMm
                    });
                }
            } else {
                for (const contour of this.contourManager.contours) {
                    const meta = this.contourManager.metadataMap.get(contour);
                    this.labelManager.ensureDefaultLabelForContour(contour, meta?.defaultLabel);
                }
            }

            for (const primitive of data.primitives || []) {
                const x = this.layment.left + primitive.x;
                const y = this.layment.top + primitive.y;
                if (primitive.type === 'rect') {
                    this.primitiveManager.addPrimitive('rect', { x, y }, { width: primitive.width, height: primitive.height });
                } else if (primitive.type === 'circle') {
                    this.primitiveManager.addPrimitive('circle', { x, y }, { radius: primitive.radius });
                }
            }

            this.applyMaterialColorToCutouts();
            this.canvas.renderAll();
            this.updateButtons();
            this.updateStatusBar();
            this.syncPrimitiveControlsFromSelection();
            this.syncLabelControlsFromSelection();
        });
        this.isRestoringWorkspace = false;
        UIDom.inputs.workspaceScale.value = this.workspaceScale;
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
        orderResult.container.classList.remove('order-result-success', 'order-result-error');
        orderResult.message.textContent = '';
        orderResult.details.hidden = true;
        orderResult.orderId.textContent = '—';
        orderResult.paymentLink.textContent = '';
        orderResult.paymentLink.href = '#';
        orderResult.meta.hidden = true;
        orderResult.meta.textContent = '';
        this.lastOrderResult = null;
    }

    showOrderResultSuccess({ orderId, paymentUrl, width, height, total }) {
        const orderResult = UIDom.orderResult;
        if (!orderResult.container) return;

        orderResult.container.hidden = false;
        orderResult.container.classList.remove('order-result-error');
        orderResult.container.classList.add('order-result-success');
        orderResult.message.textContent = 'Заказ успешно создан.';
        alert('заказ создан');

        orderResult.details.hidden = false;
        orderResult.orderId.textContent = orderId;
        orderResult.paymentLink.href = paymentUrl;
        orderResult.paymentLink.textContent = paymentUrl;
        orderResult.meta.hidden = false;
        orderResult.meta.textContent = `Размер: ${width}×${height} мм • Стоимость: ${total} ₽`;
        this.lastOrderResult = { orderId, paymentUrl, width, height, total };
    }

    showOrderResultError(message) {
        const orderResult = UIDom.orderResult;
        if (!orderResult.container) return;

        orderResult.container.hidden = false;
        orderResult.container.classList.remove('order-result-success');
        orderResult.container.classList.add('order-result-error');
        orderResult.message.innerHTML = message.replace(/\n/g, '<br>');
        alert(message);
        orderResult.details.hidden = true;
    }


    async withExportCooldown(action) {
        if (this.exportInProgress) {
            return;
        }

        const exportButton = UIDom.buttons.export;
        this.exportInProgress = true;
        const startedAt = Date.now();
        exportButton.disabled = true;
        exportButton.textContent = 'Отправка…';

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
        this.clearOrderResult();

        const validation = this.contourManager.checkCollisionsAndHighlight();
        if (!validation.ok) {
            this.showOrderResultError(this.formatLayoutIssuesMessage(validation.issues));
            return;
        }

        const realWidth = Math.round(this.layment.width);
        const realHeight = Math.round(this.layment.height);

        //  Расчёт цены (оставляем пока здесь)
        const OUTER_CONTOUR_PASSES = 3;
        const areaM2 = (realWidth * realHeight) / 1_000_000;
        const perimeterM = ((realWidth + realHeight) * 2) / 1000;
        const cuttingM = OUTER_CONTOUR_PASSES * perimeterM + this.getTotalCuttingLength();

        const priceMaterial = Math.round(
            areaM2 *
            Config.PRICES.MATERIAL_TECHNICAL_WASTE_K *
            Config.PRICES.MATERIAL_PRICE_PER_M2
        );

        const priceCutting = Math.round(
            cuttingM * Config.PRICES.CUTTING_PRICE_PER_METER
        );

        const total = Math.round(
            (priceMaterial + priceCutting) *
            Config.PRICES.RRC_PRICE_MULTIPLIER
        );

        const layoutPng = this.canvas.toDataURL({ format: 'png' });
        const layoutSvg = this.canvas.toSVG();
        const laymentType = (this.contourManager.contours.length > 0 || this.primitiveManager.primitives.length > 0)
            ? "with-tools"
            : "empty";

        //  КОНТРАКТ
        const data = {
            orderMeta: {
            width: realWidth,
            height: realHeight,
            units: "mm",
            coordinateSystem: "origin-top-left",
            baseMaterialColor: this.baseMaterialColor,
            laymentType,
            canvasPng: layoutPng,
            pricePreview: {
                material: priceMaterial,
                cutting: priceCutting,
                total
            },
            workspaceSnapshot: this.buildWorkspaceSnapshot()
            },
            layoutPng,
            layoutSvg,

            contours: this.contourManager.getContoursData(),
            primitives: this.contourManager.getPrimitivesData(),
            labels: this.labelManager.getExportLabelsData()
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
            const statusUrl = `status.html?orderId=${encodeURIComponent(orderId)}`;

            this.showOrderResultSuccess({
                orderId,
                paymentUrl: statusUrl,
                width: realWidth,
                height: realHeight,
                total: result?.pricePreview?.total ?? total
            });
        } catch (err) {
            console.error(err);
            this.showOrderResultError('Ошибка при создании заказа: ' + err.message);
        }
    }
}


document.addEventListener('DOMContentLoaded', () => new ContourApp());
