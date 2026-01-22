// app.js

const WORKSPACE_STORAGE_KEY = 'laymentDesigner.workspace.v1';

class ContourApp {
    constructor() {
        this.canvas = null;
        this.layment = null;                  
        this.workspaceScale = Config.WORKSPACE_SCALE.DEFAULT;
        this.laymentOffset = Config.LAYMENT_OFFSET;
        this.availableContours = [];
        this.availableCategories = [];
        this.currentCategory = null;
        this.catalogQuery = '';
        this.autosaveTimer = null;
        this.isRestoringWorkspace = false;

        this.init();
    }

    async init() {
        this.initializeCanvas();
        this.initializeServices();
        this.createLayment();
        await this.loadAvailableContours();
        this.setupEventListeners();
        await this.loadWorkspaceFromStorage();
    }

    initializeCanvas() {

        //const panelWidth = 320;
        //const w = window.innerWidth - panelWidth - 40;
        //const h = window.innerHeight - 120;

        this.canvas = new fabric.Canvas('workspaceCanvas', {
            width: window.innerWidth - Config.UI.PANEL_WIDTH - Config.UI.CANVAS_PADDING,
            height: window.innerHeight - Config.UI.HEADER_HEIGHT,
            backgroundColor:  Config.UI.CANVAS_BACKGROUND,
            selection: true,
            preserveObjectStacking: true
        });

        window.addEventListener('resize', () => {
            const w2 = window.innerWidth - Config.UI.PANEL_WIDTH - Config.UI.CANVAS_PADDING;
            const h2 = window.innerHeight - Config.UI.HEADER_HEIGHT;
            this.canvas.setDimensions({ width: w2, height: h2 });
            this.canvas.renderAll();
        });
    }

    initializeServices() {
        this.contourManager = new ContourManager(this.canvas, this);  // Pass this (app) to ContourManager
        this.primitiveManager = new PrimitiveManager(this.canvas, this);  // Новый менеджер для примитивов
    }

    createLayment() {
        const width = parseInt(UIDom.inputs.laymentWidth.value) || Config.LAYMENT_DEFAULT_WIDTH;
        const height = parseInt(UIDom.inputs.laymentHeight.value) || Config.LAYMENT_DEFAULT_HEIGHT;


        this.layment = new fabric.Rect({
            width: width,
            height: height,
            left: this.laymentOffset,
            top: this.laymentOffset,
            fill: 'transparent',
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
    }

    async loadAvailableContours() {
        try {
            const resp = await fetch(Config.API.MANIFEST_URL);
            const data = await resp.json();

            this.manifest = data.items.reduce((acc, item) => {
            acc[item.id] = item;
            return acc;
            }, {});

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
    }

    bindCanvasEvents() {
        this.canvas.on('selection:created', () => {
            this.updateButtons();
            this.updateStatusBar();
        });

        this.canvas.on('selection:updated', () => {
            this.updateButtons();
            this.updateStatusBar();
        });

        this.canvas.on('selection:cleared', () => {
            this.updateButtons();
            this.updateStatusBar();
        });

        this.canvas.on('object:moving', () => {
            this.updateStatusBar();
        });

        this.canvas.on('object:modified', event => {
            if (this.shouldAutosaveForObject(event.target)) {
                this.scheduleWorkspaceSave();
            }
        });
    }    
    bindUIButtonEvents() {
        UIDom.buttons.delete.onclick = () => this.deleteSelected();
        UIDom.buttons.rotate.onclick = () => this.rotateSelected();
        UIDom.buttons.saveWorkspace.onclick = () => this.saveWorkspace();
        UIDom.buttons.loadWorkspace.onclick = () => this.loadWorkspaceFromStorage();

        UIDom.buttons.export.onclick = () => this.performWithScaleOne(() => this.exportData());

        UIDom.buttons.check.onclick =
            () => this.performWithScaleOne(() => {
              const ok = this.contourManager.checkCollisionsAndHighlight();
              alert(
                ok
                ? Config.MESSAGES.VALID_LAYOUT
                : Config.MESSAGES.COLLISION_ERROR
              );
            });

        UIDom.buttons.addRect.addEventListener('click', () => {
            const centerX = this.layment.width / 2;
            const centerY = this.layment.height / 2;
            this.primitiveManager.addPrimitive('rect', { x: centerX, y: centerY }, { width: 50, height: 50 });
            this.scheduleWorkspaceSave();
        });

        UIDom.buttons.addCircle.addEventListener('click', () => {
            const centerX = this.layment.width / 2;
            const centerY = this.layment.height / 2;
            this.primitiveManager.addPrimitive('circle', { x: centerX, y: centerY }, { radius: 25 });
            this.scheduleWorkspaceSave();
        });
    }
    bindInputEvents() {
        UIDom.inputs.laymentWidth.addEventListener('change', e => {
            let v = parseInt(e.target.value) || Config.LAYMENT_DEFAULT_WIDTH;
            if (v < Config.LAYMENT_MIN_SIZE) v = Config.LAYMENT_MIN_SIZE;
            e.target.value = v;
            this.updateLaymentSize(v, this.layment.height);
        });

        UIDom.inputs.laymentHeight.addEventListener('change', e => {
            let v = parseInt(e.target.value) || Config.LAYMENT_DEFAULT_HEIGHT;
            if (v < Config.LAYMENT_MIN_SIZE) v = Config.LAYMENT_MIN_SIZE;
            e.target.value = v;
            this.updateLaymentSize(this.layment.width, v);
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


        /*
        // Размеры ложемента
        UIDom.inputs.laymentWidth.addEventListener('change', e => {
            let v = parseInt(e.target.value) || Config.LAYMENT_DEFAULT_WIDTH;
            if (v < Config.LAYMENT_MIN_SIZE) v = Config.LAYMENT_MIN_SIZE;
            e.target.value = v;
            this.updateLaymentSize(v, this.layment.height);
        });

        UIDom.inputs.laymentHeight.addEventListener('change', e => {
            let v = parseInt(e.target.value) || Config.LAYMENT_DEFAULT_HEIGHT;
            if (v < Config.LAYMENT_MIN_SIZE) v = Config.LAYMENT_MIN_SIZE;
            e.target.value = v;
            this.updateLaymentSize(this.layment.width, v);
        });

        // Масштаб
        UIDom.inputs.workspaceScale.addEventListener('change', e => {
            const s = parseFloat(e.target.value);
            if (s >= Config.WORKSPACE_SCALE.MIN && s <= Config.WORKSPACE_SCALE.MAX) {
                this.updateWorkspaceScale(s);
            } else {
                e.target.value = this.workspaceScale;
            }
        });

        // Зум колёсиком мыши
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

        UIDom.buttons.addRect.addEventListener('click', () => {
            const centerX = this.canvas.width / 2;
            const centerY = this.canvas.height / 2;
            this.primitiveManager.addPrimitive('rect', { x: centerX, y: centerY }, { width: 50, height: 50 });
        });

        UIDom.buttons.addCircle.addEventListener('click', () => {
            const centerX = this.canvas.width / 2;
            const centerY = this.canvas.height / 2;
            this.primitiveManager.addPrimitive('circle', { x: centerX, y: centerY }, { radius: 25 });
        });

        // Кнопки
        UIDom.buttons.delete.onclick = () => this.deleteSelected();
        UIDom.buttons.rotate.onclick = () => this.rotateSelected();
        UIDom.buttons.export.onclick = () => this.performWithScaleOne(() => this.exportData());

        //Строка состояния
        this.setupStatusBarUpdates();

        // Кнопка проверки
         
        UIDom.buttons.check.onclick = () =>
        this.performWithScaleOne(() => {
        const ok = this.contourManager.checkCollisionsAndHighlight();
        alert(
        ok
            ? Config.MESSAGES.VALID_LAYOUT
            : Config.MESSAGES.COLLISION_ERROR
        );
        });


        this.canvas.on('selection:created', () => this.updateButtons());
        this.canvas.on('selection:updated', () => this.updateButtons());
        this.canvas.on('selection:cleared', () => this.updateButtons());
    }
        */

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
        UIDom.buttons.rotate.disabled = !has;
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
        return raw ? raw : 'Без категории';
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

        if (!this.currentCategory) {
            const categories = this.filterCategories(this.availableCategories);
            this.renderFolderRows(list, categories);
            return;
        }

        const items = this.availableContours
            .filter(item => this.getCategoryLabel(item) === this.currentCategory)
            .filter(item => this.matchesItemQuery(item));
        this.renderItemRows(list, items);
    }

    filterCategories(categories) {
        const query = this.catalogQuery.trim().toLowerCase();
        if (!query) {
            return categories;
        }
        return categories.filter(category => category.toLowerCase().includes(query));
    }

    matchesItemQuery(item) {
        const query = this.catalogQuery.trim().toLowerCase();
        if (!query) {
            return true;
        }
        const fields = [
            item.name,
            item.article,
            item.brand
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

    renderItemRows(list, items) {
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
    
        statusEl.innerHTML = `
        <strong>${meta.name}</strong>
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
        return obj !== this.layment;
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

            UIDom.inputs.laymentWidth.value = width;
            UIDom.inputs.laymentHeight.value = height;
            this.updateLaymentSize(width, height);
            this.layment.set({ left: offset, top: offset });
            this.layment.setCoords();

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

            this.canvas.renderAll();
            this.updateButtons();
            this.updateStatusBar();
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

    exportData() {
        const valid = this.contourManager.checkCollisionsAndHighlight();
        if (!valid) {
            alert(Config.MESSAGES.EXPORT_ERROR);
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
            Config.MATERIAL_TECHNICAL_WASTE_K *
            Config.MATERIAL_PRICE_PER_M2
        );

        const priceCutting = Math.round(
            cuttingM * Config.CUTTING_PRICE_PER_METER
        );

        const total = Math.round(
            (priceMaterial + priceCutting) *
            Config.RRC_PRICE_MULTIPLIER
        );

        //  КОНТРАКТ
        const data = {
            orderMeta: {
            width: realWidth,
            height: realHeight,
            units: "mm",
            coordinateSystem: "origin-top-left",
            pricePreview: {
                material: priceMaterial,
                cutting: priceCutting,
                total
            }
            },

            contours: this.contourManager.getContoursData(),
            primitives: this.contourManager.getPrimitivesData()
        };

        console.log('Заказ:', data);

        fetch(Config.API.BASE_URL + Config.API.EXPORT_Layment, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        })
            .then(r => r.ok ? r.text() : r.text().then(t => { throw new Error(t); }))
            .then(gcode => {
            alert(
                `Файл создан!\n\n` +
                `Размер: ${realWidth}×${realHeight} мм\n` +
                `Стоимость: ${total} ₽`
            );
            })
            .catch(err => {
            console.error(err);
            alert('Ошибка при создании файла: ' + err.message);
            });
    }
}


document.addEventListener('DOMContentLoaded', () => new ContourApp());
