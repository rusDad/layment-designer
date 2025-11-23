class ContourApp {
    constructor() {
        this.canvas = null;
        this.baseRectangle = null;
        this.workspaceScale = 1.0;
        this.laymentOffset = 20;
        this.availableContours = [];

        this.init();
    }

    async init() {
        this.initializeCanvas();
        this.initializeServices();
        this.createBaseRectangle();
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
            selection: true
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

    createBaseRectangle() {
        this.baseRectangle = new fabric.Rect({
            width: 565,
            height: 375,
            left: this.laymentOffset,
            top: this.laymentOffset,
            fill: 'transparent',
            stroke: '#000',
            strokeWidth: 2,
            strokeDashArray: [8, 8],
            selectable: false,
            evented: false,
            hasControls: false
        });
        this.canvas.add(this.baseRectangle);
        this.canvas.sendToBack(this.baseRectangle);
        this.canvas.backgroundItem = this.baseRectangle; // для удобства
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
            console.error('Не загрузился manifest.json', err);
        }
    }

    async addContour(item) {
        const centerX = this.baseRectangle.left + this.baseRectangle.width / 2;
        const centerY = this.baseRectangle.top + this.baseRectangle.height / 2;

        await this.contourManager.addContour(
            item.svg,
            { x: centerX, y: centerY },
            this.workspaceScale,
            item
        );
    }

    setupEventListeners() {
        document.getElementById('deleteButton').onclick = () => this.deleteSelected();
        document.getElementById('rotateButton').onclick = () => this.rotateSelected();
        document.getElementById('exportButton').onclick = () => this.exportData();

        // Новая кнопка проверки
        const checkBtn = document.createElement('button');
        checkBtn.id = 'checkButton';
        checkBtn.className = 'tool-button';
        checkBtn.textContent = 'Проверить раскладку';
        checkBtn.style.background = '#9b59b6';
        document.querySelector('.tool-buttons').appendChild(checkBtn);
        checkBtn.onclick = () => {
            const ok = this.contourManager.checkCollisionsAndHighlight();
            alert(ok ? 'Всё отлично! Нет коллизий' : 'Ошибка: есть пересечения или выход за границы!');
        };

        // Остальные обработчики (масштаб, размеры) — оставь как было
        this.setupSizeControls();
        this.setupScaleControl();
        this.setupCanvasEvents();
    }

    setupSizeControls() {
        const wInp = document.getElementById('baseRectWidth');
        const hInp = document.getElementById('baseRectHeight');

        const update = () => {
            let w = parseInt(wInp.value) || 565;
            let h = parseInt(hInp.value) || 375;
            if (w < 200) w = 200;
            if (h < 200) h = 200;

            this.baseRectangle.set({
                width: w,
                height: h
            });
            this.canvas.renderAll();
        };

        wInp.onchange = update;
        hInp.onchange = update;
    }

    setupScaleControl() {
        const inp = document.getElementById('workspaceScale');
        inp.onchange = (e) => {
            const s = parseFloat(e.target.value);
            if (s >= 0.1 && s <= 5) {
                const ratio = s / this.workspaceScale;
                this.workspaceScale = s;

                this.baseRectangle.scaleX = ratio;
                this.baseRectangle.scaleY = ratio;
                this.baseRectangle.left *= ratio;
                this.baseRectangle.top *= ratio;

                this.contourManager.scaleAllContours(ratio);
                this.canvas.renderAll();
            } else {
                e.target.value = this.workspaceScale;
            }
        };
    }

    setupCanvasEvents() {
        this.canvas.on('selection:created', () => this.updateButtons());
        this.canvas.on('selection:updated', () => this.updateButtons());
        this.canvas.on('selection:cleared', () => this.updateButtons());
    }

    updateButtons() {
        const hasSel = !!this.canvas.getActiveObject();
        document.getElementById('deleteButton').disabled = !hasSel;
        document.getElementById('rotateButton').disabled = !hasSel;
    }

    deleteSelected() {
        const obj = this.canvas.getActiveObject();
        if (!obj) return;
        if (obj.type === 'activeSelection') {
            obj.forEachObject(o => this.contourManager.removeContour(o));
            this.canvas.discardActiveObject();
        } else {
            this.contourManager.removeContour(obj);
        }
        this.updateButtons();
    }

    rotateSelected() {
        const obj = this.canvas.getActiveObject();
        if (!obj) return;
        const next = (obj.angle + 90) % 360;
        this.contourManager.rotateContour(obj, next);
    }

    exportData() {
        const ok = this.contourManager.checkCollisionsAndHighlight();
        if (!ok) {
            alert('Нельзя экспортировать: есть коллизии или выход за границы!');
            return;
        }

        const widthPx = this.baseRectangle.width * this.baseRectangle.scaleX;
        const heightPx = this.baseRectangle.height * this.baseRectangle.scaleY;

        const areaM2 = (widthPx * heightPx) / 1e6;
        const cuttingM = this.contourManager.getTotalCuttingLength();

        const priceMaterial = Math.round(areaM2 * 2800);
        const priceCutting = Math.round(cuttingM * 350);
        const totalPrice = priceMaterial + priceCutting;

        const data = {
            layment: {
                width_mm: Math.round(widthPx),
                height_mm: Math.round(heightPx)
            },
            contours: this.contourManager.getContoursData(this.workspaceScale),
            price: {
                material_rub: priceMaterial,
                cutting_rub: priceCutting,
                total_rub: totalPrice
            },
            stats: {
                area_m2: +areaM2.toFixed(4),
                cutting_meters: +cuttingM.toFixed(3)
            }
        };

        console.log('Экспорт:', data);
        alert(`Готово!\n\nРазмер: ${data.layment.width_mm}×${data.layment.height_mm} мм\nПлощадь: ${data.stats.area_m2} м²\nРезка: ${data.stats.cutting_meters} м\n\nИтого: ${totalPrice} ₽`);

        // fetch('/api/order', { method: 'POST', body: JSON.stringify(data) })
    }
}

// Запуск
document.addEventListener('DOMContentLoaded', () => new ContourApp());