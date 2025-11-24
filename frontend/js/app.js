class ContourApp {
    constructor() {
        this.canvas = null;
        this.layment = null;                    // ← Единое название
        this.workspaceScale = 1.0;
        this.laymentOffset = 20;
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
        const panelWidth = 320;
        const w = window.innerWidth - panelWidth - 40;
        const h = window.innerHeight - 120;

        this.canvas = new fabric.Canvas('workspaceCanvas', {
            width: w,
            height: h,
            backgroundColor: '#fafafa',
            selection: true,
            preserveObjectStacking: true
        });

        window.addEventListener('resize', () => {
            const w2 = window.innerWidth - panelWidth - 40;
            const h2 = window.innerHeight - 120;
            this.canvas.setDimensions({ width: w2, height: h2 });
            this.canvas.renderAll();
        });
    }

    initializeServices() {
        this.contourManager = new ContourManager(this.canvas);
    }

    createLayment() {
        const width = parseInt(document.getElementById('baseRectWidth').value) || 565;
        const height = parseInt(document.getElementById('baseRectHeight').value) || 375;

        this.layment = new fabric.Rect({
            width: width,
            height: height,
            left: this.laymentOffset,
            top: this.laymentOffset,
            fill: 'transparent',
            stroke: '#000',
            strokeWidth: 2,
            strokeDashArray: [10, 5],
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
            const resp = await fetch('/contours/manifest.json');
            this.availableContours = await resp.json();

            const list = document.getElementById('contoursList');
            list.innerHTML = '';

            this.availableContours.forEach(item => {
                const div = document.createElement('div');
                div.className = 'contour-item';
                div.textContent = item.name;
                div.onclick = () => this.addContour(item);
                list.appendChild(div);
            });
        } catch (err) {
                console.error('Ошибка загрузки manifest.json', err);
                alert('Не удалось загрузить список артикулов');
        }
    }

    async addContour(item) {
        const centerX = this.layment.left + this.layment.width / 2;
        const centerY = this.layment.top + this.layment.height / 2;

        await this.contourManager.addContour(
            item.svg,
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
        if (newScale < 0.1 || newScale > 10) return;

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

        this.canvas.renderAll();
        this.updateStatusBar();
    }

    setupEventListeners() {
        // Размеры ложемента
        document.getElementById('baseRectWidth').addEventListener('change', e => {
            let v = parseInt(e.target.value) || 565;
            if (v < 200) v = 200;
            e.target.value = v;
            this.updateLaymentSize(v, this.layment.height);
        });

        document.getElementById('baseRectHeight').addEventListener('change', e => {
            let v = parseInt(e.target.value) || 375;
            if (v < 200) v = 200;
            e.target.value = v;
            this.updateLaymentSize(this.layment.width, v);
        });

        // Масштаб
        document.getElementById('workspaceScale').addEventListener('change', e => {
            const s = parseFloat(e.target.value);
            if (s >= 0.1 && s <= 10) {
                this.updateWorkspaceScale(s);
            } else {
                e.target.value = this.workspaceScale;
            }
        });

        // Кнопки
        document.getElementById('deleteButton').onclick = () => this.deleteSelected();
        document.getElementById('rotateButton').onclick = () => this.rotateSelected();
        document.getElementById('exportButton').onclick = () => this.exportData();
        //Строка состояния
        this.setupStatusBarUpdates();

        // Кнопка проверки
        const checkBtn = document.createElement('button');
        checkBtn.textContent = 'Проверить раскладку';
        checkBtn.className = 'tool-button';
        checkBtn.style.background = '#9b59b6';
        checkBtn.onclick = () => {
            const ok = this.contourManager.checkCollisionsAndHighlight();
            alert(ok ? 'Раскладка валидна! Можно заказывать' : 'Ошибка: есть пересечения или выход за границы');
        };
        document.querySelector('.tool-buttons').appendChild(checkBtn);

        this.canvas.on('selection:created', () => this.updateButtons());
        this.canvas.on('selection:updated', () => this.updateButtons());
        this.canvas.on('selection:cleared', () => this.updateButtons());
    }

    updateButtons() {
        const has = !!this.canvas.getActiveObject();
        document.getElementById('deleteButton').disabled = !has;
        document.getElementById('rotateButton').disabled = !has;
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
    const statusEl = document.getElementById('status-info');
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
    const realX = (contour.left / this.workspaceScale).toFixed(1);
    const realY = (contour.top / this.workspaceScale).toFixed(1);

    statusEl.innerHTML = `
        <strong>${meta.name}</strong>
        X: ${realX} мм  Y: ${realY} мм  Угол: ${contour.angle}°
    `;
    }

    deleteSelected() {
        const obj = this.canvas.getActiveObject();
        if (!obj) return;
        if (obj.type === 'activeSelection') {
            obj.forEachObject(o => this.contourManager.removeContour(o));
        } else {
            this.contourManager.removeContour(obj);
        }
        this.canvas.discardActiveObject();
        this.canvas.renderAll();
        this.updateButtons();
    }

    rotateSelected() {
        const obj = this.canvas.getActiveObject();
        if (!obj) return;
        const next = (obj.angle + 90) % 360;
        this.contourManager.rotateContour(obj, next);
    }

    exportData() {
        const valid = this.contourManager.checkCollisionsAndHighlight();
        if (!valid) {
            alert('Исправьте ошибки перед заказом!');
            return;
        }

        const realWidth = Math.round(this.layment.width * this.layment.scaleX);
        const realHeight = Math.round(this.layment.height * this.layment.scaleY);
        const areaM2 = (realWidth * realHeight) / 1e6;
        const cuttingM = this.contourManager.getTotalCuttingLength();

        const priceMaterial = Math.round(areaM2 * 2800);
        const priceCutting = Math.round(cuttingM * 350);
        const total = priceMaterial + priceCutting;

        const data = {
            layment_mm: { width: realWidth, height: realHeight },
            contours: this.contourManager.getContoursData(),
            price_rub: { material: priceMaterial, cutting: priceCutting, total },
            stats: { area_m2: +areaM2.toFixed(4), cutting_meters: +cuttingM.toFixed(3) }
        };

        console.log('Заказ:', data);
        alert(`Готово к заказу!\n\nРазмер: ${realWidth}×${realHeight} мм\nПлощадь: ${data.stats.area_m2} м²\nРезка: ${data.stats.cutting_meters} м\n\nСтоимость: ${total} ₽`);

        // Здесь будет POST на бэкенд
        // fetch('/api/order', { method: 'POST', body: JSON.stringify(data) })
    }
}


document.addEventListener('DOMContentLoaded', () => new ContourApp());

