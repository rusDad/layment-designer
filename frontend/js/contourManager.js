// contourManager.js

class ContourManager {
    constructor(canvas, app) {  // Added app parameter to access workspaceScale
        this.canvas = canvas;
        this.app = app;  // Reference to ContourApp for workspaceScale
        this.svgLoader = new SVGLoader();
        this.contours = [];
        this.metadataMap = new WeakMap();
        this.allowedAngles = [0, 90, 180, 270];
        // Разрешаем перемещение группы, но запрещаем всё остальное
        fabric.ActiveSelection.prototype.set({
            hasControls: false,       // убираем контроллы масштабирования и поворота
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true,
            lockMovementX: false,     //  разрешаем двигать по X
            lockMovementY: false,     //  разрешаем двигать по Y
            hasBorders: true          // оставляем рамку, чтобы было видно, что группа выделена
        });
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

      const padding = 8 * layment.scaleX;

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
            if (this.intersect(box, boxB) && this.hasPixelOverlap(a, b)) {  // Pixel overlap check
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

    // Pixel overlap check with normalization to scale=1 and fixed blending
    hasPixelOverlap(a, b) {
        const currentScale = this.app.workspaceScale;  // Access from app
        const intersectBox = this.getIntersectBBox(a.getBoundingRect(true), b.getBoundingRect(true));
        if (!intersectBox.width || !intersectBox.height) return false;

        // Нормализация: factor для приведения к scale=1
        const normalizeFactor = 1 / currentScale;
        const paddedWidth = Math.ceil((intersectBox.width * normalizeFactor) + 40);  // Increased padding
        const paddedHeight = Math.ceil((intersectBox.height * normalizeFactor) + 40);

        const tempCanvas = new fabric.StaticCanvas(null, {
            width: paddedWidth,
            height: paddedHeight,
            backgroundColor: '#ffffff'
        });

        // Клоны с нормализованным scale и position
        const cloneA = fabric.util.object.clone(a);
        cloneA.set({
            stroke: null,
            scaleX: cloneA.scaleX * normalizeFactor,
            scaleY: cloneA.scaleY * normalizeFactor,
            left: (cloneA.left - intersectBox.left) * normalizeFactor + 20,  // Centered padding
            top: (cloneA.top - intersectBox.top) * normalizeFactor + 20
        });

        const cloneB = fabric.util.object.clone(b);
        cloneB.set({
            stroke: null,
            scaleX: cloneB.scaleX * normalizeFactor,
            scaleY: cloneB.scaleY * normalizeFactor,
            left: (cloneB.left - intersectBox.left) * normalizeFactor + 20,
            top: (cloneB.top - intersectBox.top) * normalizeFactor + 20
        });

        // Рекурсивно устанавливаем fill на все дочерние объекты (paths, etc)
        const setFillRecursive = (obj, color) => {
            if (obj.type === 'path' || obj.type === 'polygon' || obj.type === 'polyline' || obj.type === 'circle' || obj.type === 'rect' || obj.type === 'ellipse') {
                obj.set('fill', color);
                obj.set('stroke', null);
            }
            if (obj.type === 'group') {
                obj.forEachObject(child => setFillRecursive(child, color));
            }
        };

        setFillRecursive(cloneA, 'rgba(0,0,0,0.5)');
        setFillRecursive(cloneB, 'rgba(0,0,0,0.5)');

        tempCanvas.add(cloneA);
        tempCanvas.add(cloneB);
        tempCanvas.renderAll();

        const ctx = tempCanvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height).data;

        for (let i = 0; i < imageData.length; i += 4) {
            const r = imageData[i], g = imageData[i+1], b = imageData[i+2], a = imageData[i+3];
            // Проверяем темный серый (overlap ~63, with tolerance for antialias)
            if (Math.abs(r - g) < 10 && Math.abs(r - b) < 10 && r < 100 && a > 128) {
                return true;
            }
        }
        return false;
    }

    // Helper: Get intersecting bbox
    getIntersectBBox(box1, box2) {
        const left = Math.max(box1.left, box2.left);
        const top = Math.max(box1.top, box2.top);
        const right = Math.min(box1.left + box1.width, box2.left + box2.width);
        const bottom = Math.min(box1.top + box1.height, box2.top + box2.height);
        return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
    }

    getContoursData() {
       const layment = this.canvas.layment;
       return this.contours.map(obj => {
            const meta = this.metadataMap.get(obj);
            const tl = obj.aCoords.tl;
           

            return {
                id: meta.id,
                name: meta.name,
                x: Math.round((tl.x - layment.left)/layment.scaleX),
                y: Math.round((tl.y - layment.top)/layment.scaleY),
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
}