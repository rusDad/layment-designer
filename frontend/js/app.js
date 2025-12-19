// app.js

class ContourApp {
    constructor() {
        this.canvas = null;
        this.layment = null;                  
        this.workspaceScale = Config.WORKSPACE_SCALE.DEFAULT;
        this.laymentOffset = Config.LAYMENT_OFFSET;
        this.availableContours = [];

        this.init();
    }

    async init() {
        this.initializeCanvas();
        this.initializeServices();
        this.createLayment();
        await this.loadAvailableContours();
        this.setupEventListeners();
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
            this.availableContours = data.items.filter(i => i.enabled);

            const list = UIDom.panels.contoursList;
            list.innerHTML = '';

            this.availableContours.forEach(item => {
                const div = document.createElement('div');
                div.className = 'contour-item';
                div.textContent = item.name;
                div.onclick = () => this.addContour(item);
                list.appendChild(div);
            });
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
    }

    updateLaymentSize(width, height) {
        this.layment.set({ width, height });
        this.canvas.renderAll();
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
    }    
    bindUIButtonEvents() {
        UIDom.buttons.delete.onclick = () => this.deleteSelected();
        UIDom.buttons.rotate.onclick = () => this.rotateSelected();

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
            this.primitiveManager.addRectangle();
        });

        UIDom.buttons.addCircle.addEventListener('click', () => {
            this.primitiveManager.addCircle();
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
        UIDom.inputs.workspaceScale.addEventListener('wheel', e => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            let next = this.workspaceScale + delta;
            next = Math.max(
            Config.WORKSPACE_SCALE.MIN,
            Math.min(Config.WORKSPACE_SCALE.MAX, next)
            );
            this.updateWorkspaceScale(next);
            UIDom.inputs.workspaceScale.value = next.toFixed(1);
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

    performWithScaleOne(action) {
        const oldScale = this.workspaceScale;
        this.updateWorkspaceScale(1);
        action();
        this.updateWorkspaceScale(oldScale);
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
    }

    rotateSelected() {
        const obj = this.canvas.getActiveObject();
        if (!obj || obj.primitiveType) return;  // Нет поворота для примитивов
        const next = (obj.angle + 90) % 360;
        this.contourManager.rotateContour(obj, next);
    }

    getTotalCuttingLength() {
      return this.contourManager
        .getPlacedContourIds()
        .reduce((sum, id) => {
            const item = this.manifest[id];
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
        const cuttingM = OUTER_CONTOUR_PASSES * perimeterM + this.contourManager.getTotalCuttingLength();

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
