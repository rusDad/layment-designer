// contourManager.js
// ContourManager отвечает ТОЛЬКО за:
// - управление инструментальными контурами
// - проверку их взаимных пересечений
// - проверку выхода за границы ложемента
//
// Он НЕ знает про:
// - DOM
// - UI
// - масштаб canvas

class ContourManager {
    constructor(canvas, app) {
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

        const scaleOverride = metadata.scaleOverride ?? 1;
        const factor = scale * Config.CONVERSION.SCALE_FACTOR * scaleOverride;

        group.set({
            left: position.x,
            top: position.y,
            originX: 'center',
            originY: 'center',
            fill: Config.COLORS.CONTOUR.FILL,
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
        group.contourId = metadata.id;

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

    clearContours() {
        this.contours.forEach(obj => this.canvas.remove(obj));
        this.contours = [];
        this.metadataMap = new WeakMap();
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
      const emptyResult = {
        ok: true,
        issues: {
            outOfBoundsContours: 0,
            collisionContours: 0,
            outOfBoundsPrimitives: 0
        }
      };

      if (this.app.workspaceScale !== 1) {
        console.warn('Collision check must run with workspace scale=1. Use performWithScaleOne().');
        return {
            ...emptyResult,
            ok: false
        };
      }

      const problematic = new Set();
      const outOfBoundsContours = new Set();
      const collisionContours = new Set();
      const outOfBoundsPrimitives = new Set();

       // Сброс цвета у всех контуров
      this.contours.forEach(obj => {
        this.resetPropertiesRecursive(obj, {
            stroke: Config.COLORS.CONTOUR.NORMAL,        // обычный цвет контура
            strokeWidth: Config.COLORS.CONTOUR.NORMAL_STROKE_WIDTH,
            opacity: 1,
            borderColor: Config.COLORS.SELECTION.BORDER,   // цвет рамки выделения (если останется)
            cornerColor: Config.COLORS.SELECTION.CORNER,
            fill: Config.COLORS.CONTOUR.FILL  // Сброс fill
        });
      });

      // Сброс цвета у всех примитивов
      this.app.primitiveManager.primitives.forEach(obj => {
        this.resetPropertiesRecursive(obj, {
            stroke: Config.COLORS.PRIMITIVE.STROKE,
            strokeWidth: 2,
            opacity: 1,
            borderColor: Config.COLORS.SELECTION.BORDER,
            cornerColor: Config.COLORS.SELECTION.CORNER,
            fill: Config.COLORS.PRIMITIVE.FILL
        });
      });

      const layment = this.canvas.layment;
      if (!layment) return emptyResult;

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
            outOfBoundsContours.add(a);
          }

          // 2. Пересечения с другими контурами
          for (let j = i + 1; j < this.contours.length; j++) {
            const b = this.contours[j];
            const boxB = b.getBoundingRect(true);
            if (this.intersect(box, boxB) && this.hasPixelOverlap(a, b)) {  // Pixel overlap check
                problematic.add(a);
                problematic.add(b);
                collisionContours.add(a);
                collisionContours.add(b);
            }
          } 
       }

      // Проверка выхода за ложемент для примитивов
      this.app.primitiveManager.primitives.forEach(obj => {
        const box = obj.getBoundingRect(true);
        const lWidth = layment.width * layment.scaleX;
        const lHeight = layment.height * layment.scaleY;

        if (box.left < layment.left + padding ||
            box.top < layment.top + padding ||
            box.left + box.width > layment.left + lWidth - padding ||
            box.top + box.height > layment.top + lHeight - padding) {
            problematic.add(obj);
            outOfBoundsPrimitives.add(obj);
        }
      });

       // Подсвечиваем проблемные контуры красным + полупрозрачность для наглядности
       problematic.forEach(obj => {
        if (obj.primitiveType) {
            // Для примитивов
            obj.set({
                stroke: Config.COLORS.PRIMITIVE.ERROR,
                strokeWidth: 3,
                opacity: 0.85
            });
        } else {
            // Для контуров
            this.resetPropertiesRecursive(obj, {
            stroke:  Config.COLORS.CONTOUR.ERROR,                   //ярко-красный контур
            strokeWidth: Config.COLORS.CONTOUR.ERROR_STROKE_WIDTH,  //чуть шире для наглядности
            opacity: 0.85,
            borderColor: Config.COLORS.SELECTION.ERROR_BORDER,
            cornerColor: Config.COLORS.SELECTION.ERROR_CORNER
            });
        }
        obj.setCoords();
       });

       this.canvas.renderAll();
       return {
        ok: problematic.size === 0,
        issues: {
            outOfBoundsContours: outOfBoundsContours.size,
            collisionContours: collisionContours.size,
            outOfBoundsPrimitives: outOfBoundsPrimitives.size
        }
       };
    }

    intersect(a, b) {
        return a.left < b.left + b.width &&
               a.left + a.width > b.left &&
               a.top < b.top + b.height &&
               a.top + a.height > b.top;
    }

    //OLD  Pixel overlap check assuming scale=1 during check
    /*
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
                obj.set({
                    fill: color,
                    stroke: 'transparent',
                    strokeWidth: Config.GEOMETRY.CLEARANCE_MM,
                    strokeLineJoin: 'round',
                    strokeLineCap: 'round'
                });
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
    */

    // NEW Pixel overlap check assuming scale=1 during check
    hasPixelOverlap(a, b) {
        const intersectBox = this.getIntersectBBox(a.getBoundingRect(true), b.getBoundingRect(true));
        if (!intersectBox.width || !intersectBox.height) return false;

        const paddedWidth = Math.ceil(intersectBox.width + Config.CANVAS_OVERLAP.PIXEL_CHECK_PADDING);
        const paddedHeight = Math.ceil(intersectBox.height + Config.CANVAS_OVERLAP.PIXEL_CHECK_PADDING);

        const setMaskStyleRecursive = (obj) => {
            if (obj.type === 'group') {
            obj.forEachObject(child => setMaskStyleRecursive(child));
            return;
            }
            if (obj.type === 'path' || obj.type === 'polygon' || obj.type === 'polyline' ||
                obj.type === 'circle' || obj.type === 'rect' || obj.type === 'ellipse') {
            obj.set({
                fill: 'rgba(0,0,0,1)',
                stroke: 'rgba(0,0,0,1)',
                opacity: 1,
                // ВАЖНО: clearance=6мм => strokeWidth=6 => наружу +3мм (stroke рисуется по центру)
                // Так как применяем к обоим контурам — суммарный зазор получится 6мм
                strokeWidth: Config.GEOMETRY.CLEARANCE_MM,
                strokeLineJoin: 'round',
                strokeLineCap: 'round',
                strokeUniform: true,     // clearance в "мм", не должен масштабироваться вместе с контуром
                objectCaching: false
            });
            }
        };

        const renderMaskData = (sourceObj) => {
            const c = new fabric.StaticCanvas(null, { width: paddedWidth, height: paddedHeight });

            const clone = fabric.util.object.clone(sourceObj);
            clone.set({
            left: (clone.left - intersectBox.left) + Config.CANVAS_OVERLAP.CENTER_OFFSET,
            top: (clone.top - intersectBox.top) + Config.CANVAS_OVERLAP.CENTER_OFFSET,
            objectCaching: false
            });

            setMaskStyleRecursive(clone);
            c.add(clone);
            c.renderAll();

            return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        };

        const dataA = renderMaskData(a);
        const dataB = renderMaskData(b);

        const ALPHA_CUTOFF = 10; // чтобы игнорить микрошум антиалиаса
        for (let i = 3; i < dataA.length; i += 4) {
            if (dataA[i] > ALPHA_CUTOFF && dataB[i] > ALPHA_CUTOFF) return true;
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

    /**
     * getContoursData()
     * Возвращает данные контуров
     *
     * ВАЖНО:
     * В качестве координат используется obj.aCoords.tl —
     * это опорный угол bounding-box объекта fabric.
     *
     * При повороте объекта этот "tl" смещается,
     * но это сделано намеренно:
     * origin NC-фрагмента при повороте ведёт себя аналогично.
     *
     * Таким образом, координаты контуров и g-code
     * находятся в одной и той же системе отсчёта,
     * и backend может применять offset без дополнительных трансформаций.
     *
     * Это осознанное проектное решение.
    */

    getContoursData() {
       const layment = this.canvas.layment;

       return this.contours.map(obj => {
            const meta = this.metadataMap.get(obj);
            const tl = obj.aCoords.tl;
           
            return {
                id: meta.id,
                article: meta.article,
                x: Math.round((tl.x - layment.left)/layment.scaleX),
                y: Math.round((tl.y - layment.top)/layment.scaleY),
                angle: obj.angle,
                scaleOverride: meta.scaleOverride ?? 1
            };
        });
    }

    getPrimitivesData() {
        const layment = this.canvas.layment;

        return this.app.primitiveManager.primitives.map(obj => {
            const bbox = obj.getBoundingRect(true);
            const scaleX = obj.scaleX;  // Поскольку scaleY = scaleX для circle
            const scaleY = obj.scaleY;

            return {
                type: obj.primitiveType,
                x: obj.primitiveType === 'rect' 
                    ? Math.round((bbox.left - layment.left) / layment.scaleX)
                    : Math.round((obj.left - layment.left) / layment.scaleX),
                y: obj.primitiveType === 'rect' 
                    ? Math.round((bbox.top - layment.top) / layment.scaleY)
                    : Math.round((obj.top - layment.top) / layment.scaleY),
                width: obj.primitiveType === 'rect'
                    ? Math.round(obj.width * scaleX)
                    : undefined,
                height: obj.primitiveType === 'rect' 
                    ? Math.round(obj.height * scaleY) 
                    : undefined,
                radius: obj.primitiveType === 'circle' 
                    ? Math.round(obj.radius * scaleX) 
                    : undefined
            };
        });
    }

    getPlacedContourIds() {
         return this.contours
            .map(obj => obj.contourId)
            .filter(Boolean);
    }
    
}

class PrimitiveManager {
    constructor(canvas, app) {
        this.canvas = canvas;
        this.app = app;
        this.primitives = [];
    }

    addPrimitive(type, position, size) {
        let obj;
        if (type === 'rect') {
            obj = new fabric.Rect({
                left: position.x,
                top: position.y,
                width: size.width,
                height: size.height,
                fill: Config.COLORS.PRIMITIVE.FILL,
                stroke: Config.COLORS.PRIMITIVE.STROKE,
                strokeWidth: 2,
                strokeUniform: true,
                strokeDashArray: [1, 1],
                originX: 'left',
                originY: 'top',
                lockScalingFlip: true,
                hasRotatingPoint: false,
                lockRotation: true,
                cornerColor: Config.COLORS.SELECTION.CORNER,
                borderColor: Config.COLORS.SELECTION.BORDER,
                transparentCorners: false
            });
            obj.primitiveType = 'rect';
        } else if (type === 'circle') {
            obj = new fabric.Circle({
                left: position.x,
                top: position.y,
                radius: size.radius,
                fill: Config.COLORS.PRIMITIVE.FILL,
                stroke: Config.COLORS.PRIMITIVE.STROKE,
                strokeWidth: 2,
                strokeUniform: true,
                strokeDashArray: [1, 1],
                originX: 'center',
                originY: 'center',
                lockScalingFlip: true,
                hasRotatingPoint: false,
                lockRotation: true,
                cornerColor: Config.COLORS.SELECTION.CORNER,
                borderColor: Config.COLORS.SELECTION.BORDER,
                transparentCorners: false
            });
            obj.primitiveType = 'circle';
            obj.on('scaling', () => {
                obj.scaleY = obj.scaleX;
                obj.setCoords();
            });
        }

        if (obj) {
            obj.on('modified', () => this.validatePrimitive(obj));
            this.primitives.push(obj);
            this.canvas.add(obj);
            this.canvas.setActiveObject(obj);
            this.canvas.renderAll();
        }
    }

    validatePrimitive(obj) {
        if (!obj || !obj.primitiveType) {
            return;
        }

        const scale = this.app.workspaceScale || 1;
        let nextScaleX = obj.scaleX;
        let nextScaleY = obj.scaleY;
        let changed = false;

        if (obj.primitiveType === 'rect') {
            const realWidth = (obj.width * obj.scaleX) / scale;
            const realHeight = (obj.height * obj.scaleY) / scale;
            const limits = Config.GEOMETRY.PRIMITIVES.RECT;
            const clampedWidth = Math.min(limits.MAX_WIDTH, Math.max(limits.MIN_WIDTH, realWidth));
            const clampedHeight = Math.min(limits.MAX_HEIGHT, Math.max(limits.MIN_HEIGHT, realHeight));
            const targetScaledW = clampedWidth * scale;
            const targetScaledH = clampedHeight * scale;
            const targetScaleX = targetScaledW / obj.width;
            const targetScaleY = targetScaledH / obj.height;

            if (Math.abs(targetScaleX - obj.scaleX) > 0.0001 || Math.abs(targetScaleY - obj.scaleY) > 0.0001) {
                nextScaleX = targetScaleX;
                nextScaleY = targetScaleY;
                changed = true;
            }
        } else if (obj.primitiveType === 'circle') {
            const realRadius = (obj.radius * obj.scaleX) / scale;
            const limits = Config.GEOMETRY.PRIMITIVES.CIRCLE;
            const clampedRadius = Math.min(limits.MAX_RADIUS, Math.max(limits.MIN_RADIUS, realRadius));
            const targetScaledR = clampedRadius * scale;
            const targetScale = targetScaledR / obj.radius;

            if (Math.abs(targetScale - obj.scaleX) > 0.0001 || Math.abs(targetScale - obj.scaleY) > 0.0001) {
                nextScaleX = targetScale;
                nextScaleY = targetScale;
                changed = true;
            }
        }

        if (changed) {
            obj.scaleX = nextScaleX;
            obj.scaleY = nextScaleY;
            obj.setCoords();
            this.canvas.renderAll();
        }
    }

    getPrimitiveDimensions(obj) {
        if (!obj || !obj.primitiveType) {
            return null;
        }

        const scale = this.app.workspaceScale || 1;

        if (obj.primitiveType === 'rect') {
            return {
                type: 'rect',
                width: Math.round((obj.width * obj.scaleX) / scale),
                height: Math.round((obj.height * obj.scaleY) / scale)
            };
        }

        if (obj.primitiveType === 'circle') {
            return {
                type: 'circle',
                radius: Math.round((obj.radius * obj.scaleX) / scale)
            };
        }

        return null;
    }

    applyDimensions(obj, dimensions) {
        if (!obj || !obj.primitiveType) {
            return false;
        }

        const scale = this.app.workspaceScale || 1;

        if (obj.primitiveType === 'rect') {
            const limits = Config.GEOMETRY.PRIMITIVES.RECT;
            if (!Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height)) {
                return false;
            }
            const width = Math.min(limits.MAX_WIDTH, Math.max(limits.MIN_WIDTH, dimensions.width));
            const height = Math.min(limits.MAX_HEIGHT, Math.max(limits.MIN_HEIGHT, dimensions.height));
            const targetScaledW = width * scale;
            const targetScaledH = height * scale;
            obj.set({
                scaleX: targetScaledW / obj.width,
                scaleY: targetScaledH / obj.height
            });
            obj.setCoords();
            this.canvas.renderAll();
            return true;
        }

        if (obj.primitiveType === 'circle') {
            const limits = Config.GEOMETRY.PRIMITIVES.CIRCLE;
            if (!Number.isFinite(dimensions.radius)) {
                return false;
            }
            const radius = Math.min(limits.MAX_RADIUS, Math.max(limits.MIN_RADIUS, dimensions.radius));
            const targetScaledR = radius * scale;
            const targetScale = targetScaledR / obj.radius;
            obj.set({ scaleX: targetScale, scaleY: targetScale });
            obj.setCoords();
            this.canvas.renderAll();
            return true;
        }

        return false;
    }

    removePrimitive(obj) {
        this.primitives = this.primitives.filter(p => p !== obj);
        this.canvas.remove(obj);
        this.canvas.renderAll();
    }

    clearPrimitives() {
        this.primitives.forEach(obj => this.canvas.remove(obj));
        this.primitives = [];
        this.canvas.renderAll();
    }
}

