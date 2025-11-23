class ContourManager {
    constructor(canvas) {
        this.canvas = canvas;
        this.svgLoader = new SVGLoader();
        this.contours = [];
        this.metadataMap = new WeakMap(); // объект → метаданные
        this.allowedAngles = [0, 90, 180, 270];
        this.disableGroupControls();
    }

    async addContour(svgUrl, position, scale, metadata) {
        try {
            const group = await this.svgLoader.createFabricObjectFromSVG(svgUrl);

            const scaledFactor = scale * 0.0353;

            group.set({
                left: position.x,
                top: position.y,
                originX: 'center',
                originY: 'center',
                scaleX: scaledFactor,
                scaleY: scaledFactor,
                hasControls: true,
                hasBorders: true,
                lockScalingX: true,
                lockScalingY: true,
                lockRotation: false,
                cornerColor: '#3498db',
                borderColor: '#3498db',
                transparentCorners: false,
                perPixelTargetFind: true
            });

            // Сохраняем метаданные
            this.metadataMap.set(group, metadata);

            // Фиксация углов при вращении
            group.on('rotating', () => this.snapToAllowedAngle(group));
            group.on('modified', () => this.snapToAllowedAngle(group));

            this.contours.push(group);
            this.canvas.add(group);
            this.canvas.setActiveObject(group);
            this.canvas.renderAll();

            return group;
        } catch (err) {
            console.error('Ошибка добавления контура:', err);
            throw err;
        }
    }

    snapToAllowedAngle(obj) {
        const angle = obj.angle % 360;
        const snapped = this.allowedAngles.reduce((a, b) =>
            Math.abs(b - angle) < Math.abs(a - angle) ? b : a
        );
        obj.angle = snapped;
        obj.setCoords();
    }

    rotateContour(obj, angle) {
        if (this.allowedAngles.includes(angle)) {
            obj.angle = angle;
            obj.setCoords();
            this.canvas.renderAll();
        }
    }

    removeContour(obj) {
        const idx = this.contours.indexOf(obj);
        if (idx > -1) this.contours.splice(idx, 1);
        this.canvas.remove(obj);
        this.canvas.renderAll();
    }

    scaleAllContours(ratio) {
        this.contours.forEach(obj => {
            obj.scaleX *= ratio;
            obj.scaleY *= ratio;
            obj.left *= ratio;
            obj.top *= ratio;
            obj.setCoords();
        });
        this.canvas.renderAll();
    }

    // Главная функция проверки
    checkCollisionsAndHighlight() {
        const problematic = new Set();

        // Сброс подсветки
        this.contours.forEach(obj => {
            obj.set({ borderColor: '#3498db', cornerColor: '#3498db' });
        });

        const layRect = this.canvas.getObjects().find(o => o.selectable === false && o.type === 'rect');
        if (!layRect) return true;

        const padding = 8;

        for (let i = 0; i < this.contours.length; i++) {
            const a = this.contours[i];
            const boxA = a.getBoundingRect(true);

            // За пределы ложемента?
            if (boxA.left < layRect.left + padding ||
                boxA.top < layRect.top + padding ||
                boxA.left + boxA.width > layRect.left + layRect.width - padding ||
                boxA.top + boxA.height > layRect.top + layRect.height - padding) {
                problematic.add(a);
                continue;
            }

            // Пересечения с другими?
            for (let j = i + 1; j < this.contours.length; j++) {
                const b = this.contours[j];
                const boxB = b.getBoundingRect(true);

                if (this.intersect(boxA, boxB)) {
                    problematic.add(a);
                    problematic.add(b);
                }
            }
        }

        // Подсвечиваем красным
        problematic.forEach(obj => {
            obj.set({ borderColor: 'red', cornerColor: 'red' });
        });

        this.canvas.renderAll();
        return problematic.size === 0;
    }

    intersect(a, b) {
        return a.left < b.left + b.width &&
               a.left + a.width > b.left &&
               a.top < b.top + b.height &&
               a.top + a.height > b.top;
    }

    getContoursData(workspaceScale) {
        return this.contours.map(obj => {
            const meta = this.metadataMap.get(obj);
            const bbox = obj.getBoundingRect(true);

            return {
                id: meta.id,
                name: meta.name,
                x: Math.round((bbox.left - this.canvas.backgroundItem.left) / workspaceScale),
                y: Math.round((bbox.top - this.canvas.backgroundItem.top) / workspaceScale),
                angle: obj.angle,
                cuttingLengthMeters: meta.cuttingLengthMeters
            };
        });
    }

    getTotalCuttingLength() {
        return this.contours.reduce((sum, obj) => {
            const meta = this.metadataMap.get(obj);
            return sum + (meta?.cuttingLengthMeters || 0);
        }, 0);
    }

    disableGroupControls() {
        fabric.ActiveSelection.prototype.set({
            hasControls: false,
            lockMovementX: true,
            lockMovementY: true,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true
        });
    }
}