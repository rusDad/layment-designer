// app.js

const WORKSPACE_STORAGE_KEY = 'laymentDesigner.workspace.v1';

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
            top: this.layment.top + padding
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

        const ratio = newScale / this.workspaceScale;
        this.workspaceScale = newScale;

        this.canvas.getObjects().forEach(obj => {
            obj.set({
                left: obj.left * ratio,
                top: obj.top * ratio,
                scaleX: obj.scaleX * ratio,
                scaleY: obj.scaleY * ratio
            });
            obj.setCoords();
        });

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
                obj.setCoords();
            });
            active.setCoords();
        } else {
            active.set({
                left: active.left + dx,
                top: active.top + dy
            });
            active.setCoords();
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
        });

        this.canvas.on('selection:updated', () => {
            this.updateButtons();
            this.updateStatusBar();
            this.syncPrimitiveControlsFromSelection();
        });

        this.canvas.on('selection:cleared', () => {
            this.updateButtons();
            this.updateStatusBar();
            this.syncPrimitiveControlsFromSelection();
        });

        this.canvas.on('object:moving', () => {
            this.updateStatusBar();
        });

        this.canvas.on('object:modified', event => {
            if (this.shouldAutosaveForObject(event.target)) {
                this.scheduleWorkspaceSave();
            }
            this.syncPrimitiveControlsFromSelection();
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

    updateButtons() {
        const has = !!this.canvas.getActiveObject();
        UIDom.buttons.delete.disabled = !has;
        const active = this.canvas.getActiveObject();
        UIDom.buttons.rotate.disabled = !has || !!active?.primitiveType;
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
                if (o.primitiveType) {
                    this.primitiveManager.removePrimitive(o);
                } else {
                    this.contourManager.removeContour(o);
                }
            });
        } else {
            if (obj.primitiveType) {
                this.primitiveManager.removePrimitive(obj);
            } else {
                this.contourManager.removeContour(obj);
            }
        }
        this.canvas.discardActiveObject();
        this.canvas.renderAll();
        this.updateButtons();
        this.scheduleWorkspaceSave();
    }

    rotateSelected() {
        const obj = this.canvas.getActiveObject();
        if (!obj || obj.primitiveType) return;  // Нет поворота для примитивов
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
            schemaVersion: 1,
            savedAt: new Date().toISOString(),
            layment: {
                width: Math.round(layment.width),
                height: Math.round(layment.height),
                offset: layment.left
            },
            workspaceScale: 1,
            baseMaterialColor: this.baseMaterialColor,
            contours: this.contourManager.getContoursData(),
            primitives: this.contourManager.getPrimitivesData()
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

        if (data.schemaVersion !== 1) {
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
            primitives: this.contourManager.getPrimitivesData()
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
            const paymentUrl = `pay.html?orderId=${encodeURIComponent(orderId)}`;

            this.showOrderResultSuccess({
                orderId,
                paymentUrl,
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
