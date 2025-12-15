// contourManager.js

import * as Config from './config.js';

class ContourManager {
    constructor(canvas, app) {  // Added app parameter to access workspaceScale
        this.canvas = canvas;
        this.app = app;  // Reference to ContourApp for workspaceScale
        this.svgLoader = new SVGLoader();
        this.contours = [];
        this.metadataMap = new WeakMap();
        this.allowedAngles = Config.GEOMETRY.ALLOWED_ANGLES;
        
        fabric.ActiveSelection.prototype.set(Config.FABRIC_CONFIG.GROUP);   //Отдельный конфиг для группы 
    }

    async addContour(svgUrl, position, scale, metadata) {
        const group = await this.svgLoader.createFabricObjectFromSVG(svgUrl);

        const factor = scale * Config.CONVERSION.SCALE_FACTOR;

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
            cornerColor: Config.COLORS.SELECTION.CORNER,
            borderColor: Config.COLORS.SELECTION.BORDER,
            transparentCorners: false
        });

        group.setControlsVisibility(Config.FABRIC_CONFIG.CONTROLS_VISIBILITY);

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
        this.resetPropertiesRecursive(obj, {
            stroke: Config.COLORS.CONTOUR.NORMAL,        // обычный цвет контура
            strokeWidth: Config.COLORS.CONTOUR.NORMAL_STROKE_WIDTH,
            opacity: 1,
            borderColor: Config.COLORS.SELECTION.BORDER,   // цвет рамки выделения (если останется)
            cornerColor: Config.COLORS.SELECTION.CORNER,
            fill: null  // Сброс fill
        });
       });

      const layment = this.canvas.layment;
      if (!layment) return true;

      const padding = Config.GEOMETRY.LAYMENT_PADDING * layment.scaleX;

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
        this.resetPropertiesRecursive(obj, {
            stroke:  Config.COLORS.CONTOUR.ERROR,                   //ярко-красный контур
            strokeWidth: Config.COLORS.CONTOUR.ERROR_STROKE_WIDTH,  //чуть шире для наглядности
            opacity: 0.85,
            borderColor: Config.COLORS.SELECTION.ERROR_BORDER,
            cornerColor: Config.COLORS.SELECTION.ERROR_CORNER,
            fill: null  // Убедимся, что fill сброшен
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

    // Pixel overlap check assuming scale=1 during check
    hasPixelOverlap(a, b) {
        const intersectBox = this.getIntersectBBox(a.getBoundingRect(true), b.getBoundingRect(true));
        if (!intersectBox.width || !intersectBox.height) return false;

        const paddedWidth = Math.ceil(intersectBox.width + Config.CANVAS_OVERLAP.PIXEL_CHECK_PADDING);  // Increased padding
        const paddedHeight = Math.ceil(intersectBox.height + Config.CANVAS_OVERLAP.PIXEL_CHECK_PADDING);

        const tempCanvas = new fabric.StaticCanvas(null, {
            width: paddedWidth,
            height: paddedHeight,
            backgroundColor: Config.CANVAS_OVERLAP.TEMP_BACKGROUND
        });

        // Клоны с нормализованным scale и position
        const cloneA = fabric.util.object.clone(a);
        cloneA.set({
            stroke: null,
            left: (cloneA.left - intersectBox.left) + Config.CANVAS_OVERLAP.CENTER_OFFSET,  // Centered padding
            top: (cloneA.top - intersectBox.top) + Config.CANVAS_OVERLAP.CENTER_OFFSET
        });

        const cloneB = fabric.util.object.clone(b);
        cloneB.set({
            stroke: null,
            left: (cloneB.left - intersectBox.left) + Config.CANVAS_OVERLAP.CENTER_OFFSET,
            top: (cloneB.top - intersectBox.top) + Config.CANVAS_OVERLAP.CENTER_OFFSET
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

        setFillRecursive(cloneA, Config.CANVAS_OVERLAP.OVERLAP_COLOR);
        setFillRecursive(cloneB, Config.CANVAS_OVERLAP.OVERLAP_COLOR);

        tempCanvas.add(cloneA);
        tempCanvas.add(cloneB);
        tempCanvas.renderAll();

        const ctx = tempCanvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height).data;

        for (let i = 0; i < imageData.length; i += 4) {
            const r = imageData[i], g = imageData[i+1], b = imageData[i+2], a = imageData[i+3];
            // Проверяем темный серый (overlap ~63, with tolerance for antialias)
             //Math.abs(r - g) < 10 && Math.abs(r - b) < 10 && r < 100 && a > 128
            if (Math.abs(r - g) < Config.CANVAS_OVERLAP.OVERLAP_THRESHOLD.COLOR_DIFF &&             
                Math.abs(r - b) < Config.CANVAS_OVERLAP.OVERLAP_THRESHOLD.COLOR_DIFF && 
                r < Config.CANVAS_OVERLAP.OVERLAP_THRESHOLD.MAX_RGB && 
                a > Config.CANVAS_OVERLAP.OVERLAP_THRESHOLD.MIN_ALPHA) {      
              return true;
            }
        }
        return false;
    }

    // New helper: Reset properties recursively
    resetPropertiesRecursive(obj, props) {
        for (const key in props) {
            obj.set(key, props[key]);
        }
        if (obj.type === 'group') {
            obj.forEachObject(child => this.resetPropertiesRecursive(child, props));
        }
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