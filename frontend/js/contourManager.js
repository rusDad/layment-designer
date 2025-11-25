class ContourManager {
    constructor(canvas) {
        this.canvas = canvas;
        this.svgLoader = new SVGLoader();
        this.contours = [];
        this.metadataMap = new WeakMap();
        this.allowedAngles = [0, 90, 180, 270];
        this.disableGroupControls();
    }

    async addContour(svgUrl, position, scale, metadata) {
        const group = await this.svgLoader.createFabricObjectFromSVG(svgUrl);

        const factor = scale * 0.0353;

        group.set({
            left: position.x,
            top: position.y,
            originX: 'center',
            originY: 'center',
            scaleX: factor,
            scaleY: factor,
            hasControls: true,
            hasBorders: true,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: false,
            cornerColor: '#3498db',
            borderColor: '#3498db',
            transparentCorners: false
        });

        group.setControlsVisibility({
         tl:true, tr:false, br:false, bl:false,
         ml:false, mt:false, mr:false, mb:false,
         mtr: true
        });

        this.metadataMap.set(group, metadata);

        group.on('rotating', () => this.snapToAllowedAngle(group));
        group.on('modified', () => this.snapToAllowedAngle(group));

        this.contours.push(group);
        this.canvas.add(group);
        this.canvas.setActiveObject(group);
        this.canvas.renderAll();
    }

    snapToAllowedAngle(obj) {
        const a = obj.angle % 360;
        obj.angle = this.allowedAngles.reduce((p, c) => 
            Math.abs(c - a) < Math.abs(p - a) ? c : p
        );
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
        this.contours = this.contours.filter(c => c !== obj);
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

    checkCollisionsAndHighlight() {
    const problematic = new Set();

    // Сброс цвета у всех контуров
    this.contours.forEach(obj => {
        obj.set({
            stroke: '#101214ff',        // обычный цвет контура
            strokeWidth: 10,
            opacity: 1,
            borderColor: '#3498db',   // цвет рамки выделения (если останется)
            cornerColor: '#3498db'
        });
    });

    const layment = this.canvas.layment;
    if (!layment) return true;

    const padding = 8;

    for (let i = 0; i < this.contours.length; i++) {
        const a = this.contours[i];
        const box = a.getBoundingRect(true);

        // 1. Выход за границы ложемента
        const lWidth = layment.width * layment.scaleX;
        const lHeight = layment.height * layment.scaleY;

        if (box.left < layment.left + padding ||
            box.top < layment.top + padding ||
            box.left + box.width > layment.left + lWidth - padding ||
            box.top + box.height > layment.top + lHeight - padding) {
            problematic.add(a);
        }

        // 2. Пересечения с другими контурами
        for (let j = i + 1; j < this.contours.length; j++) {
            const b = this.contours[j];
            const boxB = b.getBoundingRect(true);
            if (this.intersect(box, boxB)) {
                problematic.add(a);
                problematic.add(b);
            }
        }
    }

    // Подсвечиваем проблемные контуры красным + полупрозрачность для наглядности
    problematic.forEach(obj => {
        obj.set({
            stroke: '#e74c3c',       // ярко-красный контур
            strokeWidth: 15,
            opacity: 0.85,
            borderColor: '#e74c3c',
            cornerColor: '#c0392b'
        });
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

    getContoursData() {
        const layment = this.canvas.layment;
        return this.contours.map(obj => {
            const meta = this.metadataMap.get(obj);
            const box = obj.getBoundingRect(true);

            return {
                id: meta.id,
                name: meta.name,
                x: Math.round(box.left - layment.left),
                y: Math.round(box.top - layment.top),
                angle: obj.angle,
                cuttingLengthMeters: meta.cuttingLengthMeters
            };
        });
    }

    getTotalCuttingLength() {
        return this.contours.reduce((s, obj) => {
            const m = this.metadataMap.get(obj);
            return s + (m?.cuttingLengthMeters || 0);
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