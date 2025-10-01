class ContourApp {
    constructor() {
        this.canvas = null;
        this.canvasElement = null;
        this.canvasContainer = null;
        this.svgLoader = null;
        this.contourManager = null;
        this.baseRectangle = null;
        this.deleteButton = null;
        this.workspaceScale = 1.0;
        this.laymentOffset = 10;
        this.minCanvasSize = { width: 800, height: 600 };

        this.availableContours = [
             { name: '602105-13', url: './svg/60210513.svg' },
             { name: '615820-3/8', url: './svg/61582038.svg' },
             { name: '703525-200', url: './svg/703525200.svg' },
             { name: 'TestCube100mm', url: './svg/TestCube100mm.svg'} // для проверки работоспособности идеи - сойдет и так
        ];

        this.init();
    }

    init() {
        this.initializeCanvas();
        this.initializeServices();
        this.createBaseRectangle();
        this.loadAvailableContours();
        this.setupEventListeners();
    }

    initializeCanvas() {
         this.canvasContainer = document.querySelector('.canvas-container');
    
         const panelWidth = 300;
         const workspaceWidth = window.innerWidth - panelWidth - 40;
         const workspaceHeight = window.innerHeight - 100;
    
         this.canvas = new fabric.Canvas('workspaceCanvas', {
             width: workspaceWidth,
             height: workspaceHeight,
             selection: true,
             backgroundColor: '#fafafa'
         });

         window.addEventListener('resize', () => {
             const panelWidth = 300;
             const workspaceWidth = window.innerWidth - panelWidth - 40;
             const workspaceHeight = window.innerHeight - 100;
        
             this.canvas.setWidth(workspaceWidth);
             this.canvas.setHeight(workspaceHeight);
             this.canvas.renderAll();
         });
    }

    updateCanvasSize(width, height) {
         const padding = 100;
    
    // Учитываем позицию ложемента при расчете
    const requiredWidth = Math.max(
        this.baseRectangle.left + width + padding, 
        this.minCanvasSize.width
    );
    const requiredHeight = Math.max(
        this.baseRectangle.top + height + padding, 
        this.minCanvasSize.height
    );
    
    this.canvasContainer.style.width = requiredWidth + 'px';
    this.canvasContainer.style.height = requiredHeight + 'px';
    
    this.canvas.setWidth(requiredWidth);
    this.canvas.setHeight(requiredHeight);
    this.canvas.renderAll();
    }

    initializeServices() {
        this.svgLoader = new SVGLoader();
        this.contourManager = new ContourManager(this.canvas);
    }

    createBaseRectangle() {
        this.baseRectangle = new fabric.Rect({
            width: 565,
            height: 375,
            left: this.laymentOffset,
            top: this.laymentOffset,
            fill: 'transparent',
            stroke: '#080808ff',
            strokeWidth: 2,
            strokeDashArray: [5, 5],
            selectable: false,
            evented: false,
            hasControls: false,
            hasBorders: false,
            lockMovementX: true,
            lockMovementY: true
        });
        
        this.canvas.add(this.baseRectangle);
        this.canvas.sendToBack(this.baseRectangle);
    }

    loadAvailableContours() {
         const contoursList = document.getElementById('contoursList');
         contoursList.innerHTML = '';

         this.availableContours.forEach(contour => {
             const contourElement = document.createElement('div');
             contourElement.className = 'contour-item';
             contourElement.textContent = contour.name;
             contourElement.dataset.url = contour.url;
        
             contourElement.addEventListener('click', () => {
                 this.addContourToWorkspace(contour.url);
             });

             contoursList.appendChild(contourElement);
         });
    }

    setupEventListeners() {
        this.setupSizeControls();
        this.setupScaleControl();
        this.setupDeleteButton();
        this.setupRotateButton();
        this.setupExportButton();
        this.setupCanvasSelectionEvents();
    }

    setupSizeControls() {
        const widthInput = document.getElementById('baseRectWidth');
        const heightInput = document.getElementById('baseRectHeight');

        const validateAndUpdate = (input, isWidth) => {
            let value = parseInt(input.value);
            
            if (isNaN(value) || value < 100) {
                value = isWidth ? 565 : 375;
                input.value = value;
            }
            
            if (isWidth) {
                this.updateLaymentSize(value * this.workspaceScale, this.baseRectangle.height);
            } else {
                this.updateLaymentSize(this.baseRectangle.width, value * this.workspaceScale);
            }
        };

        widthInput.addEventListener('change', () => validateAndUpdate(widthInput, true));
        heightInput.addEventListener('change', () => validateAndUpdate(heightInput, false));
    }

    setupScaleControl() {
        const scaleInput = document.getElementById('workspaceScale');
        
        scaleInput.addEventListener('change', (e) => {
            const newScale = parseFloat(e.target.value);
            if (newScale >= 0.1 && newScale <= 10.0) {
                this.updateWorkspaceScale(newScale);
            } else {
                e.target.value = this.workspaceScale;
            }
        });
    }

    setupDeleteButton() {
        this.deleteButton = document.getElementById('deleteButton');
        
        this.deleteButton.addEventListener('click', () => {
            this.deleteSelectedContour();
        });
    }

    setupRotateButton() {
        const rotateButton = document.getElementById('rotateButton');
        
        rotateButton.addEventListener('click', () => {
            this.rotateSelectedContour();
        });
    }

    setupExportButton() {
        const exportButton = document.getElementById('exportButton');
        exportButton.addEventListener('click', () => {
            this.exportData();
        });
    }

    setupContoursListbox() {
        const contoursList = document.getElementById('contoursList');
        
        contoursList.addEventListener('change', (e) => {
            if (e.target.value) {
                this.addContourToWorkspace(e.target.value);
                e.target.value = "";
            }
        });
    }

    setupCanvasSelectionEvents() {
        this.canvas.on('selection:created', () => {
            this.updateDeleteButtonState();
            this.updateRotateButtonState();
        });

        this.canvas.on('selection:cleared', () => {
            this.updateDeleteButtonState();
            this.updateRotateButtonState();
        });

        this.canvas.on('selection:updated', () => {
            this.updateDeleteButtonState();
            this.updateRotateButtonState();
        });
    }

    updateDeleteButtonState() {
        const hasSelection = this.canvas.getActiveObject() !== null;
        this.deleteButton.disabled = !hasSelection;
    }

    updateRotateButtonState() {
        const rotateButton = document.getElementById('rotateButton');
        const hasSelection = this.canvas.getActiveObject() !== null;
        rotateButton.disabled = !hasSelection;
    }

    async addContourToWorkspace(svgUrl) {
        try {
            const centerX = 50;//this.baseRectangle.width / 2;
            const centerY = 50;//this.baseRectangle.height / 2;
            
            await this.contourManager.addContour(svgUrl, { x: centerX, y: centerY }, this.workspaceScale);
        } catch (error) {
            alert('Ошибка при добавлении контура');
        }
    }

    deleteSelectedContour() {
        const activeObject = this.canvas.getActiveObject();
        if (!activeObject) return;

        if (activeObject.type === 'activeSelection') {
            activeObject.getObjects().forEach(obj => {
                this.contourManager.removeContour(obj);
            });
            this.canvas.discardActiveObject();
        } else {
            this.contourManager.removeContour(activeObject);
        }
        
        this.canvas.renderAll();
        this.updateDeleteButtonState();
        this.updateRotateButtonState();
    }

    rotateSelectedContour() {
        const activeObject = this.canvas.getActiveObject();
        if (!activeObject) return;
        
        const currentAngle = activeObject.angle;
        const nextAngle = (currentAngle + 90) % 360;
        this.contourManager.rotateContour(activeObject, nextAngle);
    }

    updateLaymentSize(width, height) {
        this.baseRectangle.set({
            width: width,// * this.workspaceScale,
            height: height// * this.workspaceScale
        });
        this.updateCanvasSize(width * this.workspaceScale, height * this.workspaceScale);
    }

    updateWorkspaceScale(newScale) {
        const oldScale = this.workspaceScale;
        this.workspaceScale = newScale;
        const scaleRatio = newScale / oldScale;

        this.scaleLayment(scaleRatio);
        this.contourManager.scaleAllContours(scaleRatio);
      
        this.updateCanvasSize(
        this.baseRectangle.width, 
        this.baseRectangle.height
        );
        
        this.canvas.renderAll();
    }

    scaleLayment(scaleRatio) {
        const currentWidth = this.baseRectangle.width;
        const currentHeight = this.baseRectangle.height;
        const currentLeft = this.baseRectangle.left;
        const currentTop = this.baseRectangle.top;
        
        this.baseRectangle.set({
            width: currentWidth * scaleRatio,
            height: currentHeight * scaleRatio,
            left: currentLeft * scaleRatio,
            top: currentTop * scaleRatio
        });
    }

    exportData() {
        const exportData = {
            timestamp: new Date().toISOString(),
            workspace_scale: this.workspaceScale,
            layment_size_mm: {
                width: parseInt(document.getElementById('baseRectWidth').value),
                height: parseInt(document.getElementById('baseRectHeight').value)
            },
            contours: this.contourManager.getContoursData(this.baseRectangle)
        };
        
        console.log('Экспортируемые данные:', exportData);
        this.sendToBackend(exportData);
    }

    sendToBackend(data) {
        const jsonString = JSON.stringify(data, null, 2);
        alert('Данные для отправки на бэкенд:\n' + jsonString);
        
        // Для production:
        // fetch('/api/export', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: jsonString
        // });
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    new ContourApp();

});


