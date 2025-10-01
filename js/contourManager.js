class ContourManager {
    constructor(canvas) {
        this.canvas = canvas;
        this.svgLoader = new SVGLoader();
        this.contours = [];
        this.allowedAngles = [0, 90, 180, 270];
        
        this.disableGroupControls();
    }

    async addContour(svgUrl, position = { x: 0, y: 0 }, scale = 1.0) {
        try {
            const contour = await this.svgLoader.createFabricObjectFromSVG(svgUrl);
            
            const defaultOptions = {
                left: position.x * scale,
                top: position.y * scale,
                scaleX: scale * 0.0353,
                scaleY: scale * 0.0353,
                originX: 'left',
                originY: 'top',
                hasControls: false,
                hasBorders: true,
                lockScalingX: true,
                lockScalingY: true,
                lockRotation: true,
                cornerColor: '#3498db',
                transparentCorners: false
            };

            contour.set(defaultOptions);
            
            // Обработчики вращения с фиксацией углов
            contour.on('rotating', (e) => {
                this.snapToAllowedAngle(contour);
            });

            contour.on('modified', (e) => {
                this.snapToAllowedAngle(contour);
            });

            // Сохраняем оригинальные данные для экспорта
            contour.originalData = {
                width: contour.width,
                height: contour.height,
                position: { x: position.x, y: position.y }
            };

            contour.svgUrl = svgUrl;

            this.contours.push(contour);
            this.canvas.add(contour);
            this.canvas.setActiveObject(contour);
            this.canvas.renderAll();
            
            return contour;
        } catch (error) {
            console.error('Ошибка добавления контура:', error);
        }
    }

    snapToAllowedAngle(object) {
        const currentAngle = object.angle % 360;
        const snappedAngle = this.allowedAngles.reduce((prev, curr) => {
            return (Math.abs(curr - currentAngle) < Math.abs(prev - currentAngle)) ? curr : prev;
        });
        
        object.angle = snappedAngle;
        object.setCoords();
        this.canvas.renderAll();
    }

    rotateContour(contour, angle) {
        if (this.allowedAngles.includes(angle)) {
            contour.angle = angle;
            contour.setCoords();
            this.canvas.renderAll();
        }
    }

    removeContour(contour) {
        const index = this.contours.indexOf(contour);
        if (index > -1) {
            this.contours.splice(index, 1);
            this.canvas.remove(contour);
            this.canvas.renderAll();
        }
    }

    scaleAllContours(scaleRatio) {
        this.contours.forEach(contour => {
            const currentScale = contour.scaleX * scaleRatio;
            
            contour.set({
                scaleX: currentScale,
                scaleY: currentScale,
                left: contour.left * scaleRatio,
                top: contour.top * scaleRatio
            });
            contour.setCoords();
        });
    }

    getContourName(contour) {
        return contour.svgUrl?.split('/').pop()?.replace('.svg', '') || 'unknown';
    }

    getContoursData(layment) {
        return this.contours.map(contour => {
            const originalX = contour.originalData.position.x;
            const originalY = contour.originalData.position.y;
            
            return {
                name: this.getContourName(contour),
                offset_mm: {
                    x: originalX,
                    y: layment.height - (originalY + contour.originalData.height)
                },
                rotation_degrees: contour.angle
            };
        });
    }

    disableGroupControls() {
        fabric.ActiveSelection.prototype.set({
            hasControls: false,
            hasBorders: true,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true,
            lockSkewingX: true,
            lockSkewingY: true
        });

        this.canvas.on('selection:created', (e) => {
            if (e.target && e.target.type === 'activeSelection') {
                this.disableSelectionControls(e.target);
            }
        });

        this.canvas.on('selection:updated', (e) => {
            if (e.target && e.target.type === 'activeSelection') {
                this.disableSelectionControls(e.target);
            }
        });
    }

    disableSelectionControls(selectionGroup) {
        selectionGroup.set({
            hasControls: false,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true
        });
        
        selectionGroup.getObjects().forEach(obj => {
            obj.set({
                hasControls: false,
                lockScalingX: true,
                lockScalingY: true,
                lockRotation: true
            });
        });
        
        selectionGroup.setCoords();
        this.canvas.renderAll();
    }

    clearAllContours() {
        this.contours.forEach(contour => {
            this.canvas.remove(contour);
        });
        this.contours = [];
        this.canvas.renderAll();
    }
}