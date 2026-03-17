// textManager.js
// Управление текстовыми объектами canvas (свободные и привязанные к контурам).

class TextManager {
    constructor(canvas, app, contourManager) {
        this.canvas = canvas;
        this.app = app;
        this.contourManager = contourManager;
        this.texts = [];
    }

    getBoundsPadMm() {
        if (Number.isFinite(Config.LABELS?.BOUNDS_PAD_MM)) {
            return Config.LABELS.BOUNDS_PAD_MM;
        }
        return Config.GEOMETRY.CLEARANCE_MM;
    }

    getContourByPlacementId(placementId) {
        if (!Number.isFinite(placementId)) {
            return null;
        }
        return this.contourManager.contours.find(contour => contour.placementId === placementId) || null;
    }

    getAllowedRectForContour(contour) {
        if (!contour) {
            return null;
        }
        const rect = contour.getBoundingRect(true, true);
        const pad = this.getBoundsPadMm();
        return {
            left: rect.left - pad,
            top: rect.top - pad,
            right: rect.left + rect.width + pad,
            bottom: rect.top + rect.height + pad
        };
    }

    clampTextToContourBounds(textObj) {
        if (!textObj?.isTextObject || textObj.kind !== 'attached') {
            return;
        }

        const contour = this.getContourByPlacementId(textObj.ownerPlacementId);
        if (!contour) {
            return;
        }

        const allowedRect = this.getAllowedRectForContour(contour);
        if (!allowedRect) {
            return;
        }

        textObj.setCoords();
        const textRect = textObj.getBoundingRect(true, true);

        let nextLeft = textObj.left;
        let nextTop = textObj.top;

        if (textRect.left < allowedRect.left) {
            nextLeft += allowedRect.left - textRect.left;
        }
        if (textRect.top < allowedRect.top) {
            nextTop += allowedRect.top - textRect.top;
        }

        const textRight = textRect.left + textRect.width;
        const textBottom = textRect.top + textRect.height;

        if (textRight > allowedRect.right) {
            nextLeft -= textRight - allowedRect.right;
        }
        if (textBottom > allowedRect.bottom) {
            nextTop -= textBottom - allowedRect.bottom;
        }

        textObj.set({ left: nextLeft, top: nextTop });
        textObj.setCoords();
    }

    buildTextObject({ text = '', left, top, fontSizeMm, role = 'custom', kind = 'free', ownerPlacementId = null }) {
        const textObj = new fabric.IText(text, {
            left,
            top,
            originX: 'left',
            originY: 'top',
            fontSize: fontSizeMm ?? Config.LABELS.FONT_SIZE_MM,
            fill: '#000000',
            textBaseline: 'alphabetic',
            angle: 0,
            selectable: true,
            evented: true,
            hasControls: false,
            hasBorders: true,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: kind === 'attached'
        });

        textObj.isTextObject = true;
        textObj.kind = kind;
        textObj.role = role;
        textObj.ownerPlacementId = Number.isFinite(ownerPlacementId) ? ownerPlacementId : null;
        textObj.fontSizeMm = Number(textObj.fontSize) || Config.LABELS.FONT_SIZE_MM;
        textObj.localOffsetX = 0;
        textObj.localOffsetY = 0;
        textObj.localAngle = 0;
        textObj.excludeFromExport = true;

        textObj.on('moving', () => {
            this.canvas.requestRenderAll();
        });

        textObj.on('modified', () => {
            textObj.text = textObj.text ?? '';
            textObj.fontSizeMm = Number(textObj.fontSize) || Config.LABELS.FONT_SIZE_MM;
            this.app.scheduleWorkspaceSave();
        });

        return textObj;
    }

    createFreeText({ text = '', left, top, fontSizeMm, role = 'custom' }) {
        const textObj = this.buildTextObject({ text, left, top, fontSizeMm, role, kind: 'free', ownerPlacementId: null });
        this.texts.push(textObj);
        this.canvas.add(textObj);
        textObj.setCoords();
        return textObj;
    }

    createAttachedText(contourObj, { text = '', role = 'custom', fontSizeMm, left, top, localOffsetX, localOffsetY, localAngle } = {}) {
        if (!contourObj?.placementId) {
            return null;
        }

        const rect = contourObj.getBoundingRect(true, true);
        const initialLeft = Number.isFinite(left) ? left : rect.left + rect.width + Config.LABELS.DEFAULT_OFFSET.x;
        const initialTop = Number.isFinite(top) ? top : rect.top + Config.LABELS.DEFAULT_OFFSET.y;

        const textObj = this.buildTextObject({
            text,
            left: initialLeft,
            top: initialTop,
            fontSizeMm,
            role,
            kind: 'attached',
            ownerPlacementId: contourObj.placementId
        });

        this.texts.push(textObj);
        this.canvas.add(textObj);

        if (Number.isFinite(localOffsetX) && Number.isFinite(localOffsetY)) {
            textObj.localOffsetX = localOffsetX;
            textObj.localOffsetY = localOffsetY;
            textObj.localAngle = Number.isFinite(localAngle) ? localAngle : 0;
            const absolute = this.computeAbsoluteTextPosition(textObj);
            textObj.set({ left: absolute.left, top: absolute.top, angle: absolute.angle });
        } else {
            this.updateAttachedTextAnchorFromAbsolute(textObj);
        }

        this.clampTextToContourBounds(textObj);
        this.updateAttachedTextAnchorFromAbsolute(textObj);
        textObj.setCoords();
        return textObj;
    }

    ensureDefaultTextForContour(contourObj, defaultText) {
        if (!contourObj || !defaultText) {
            return null;
        }
        const existing = this.getAttachedTextByPlacementId(contourObj.placementId, 'default-label');
        if (existing) {
            return existing;
        }
        return this.createAttachedText(contourObj, { text: defaultText, role: 'default-label' });
    }

    syncAttachedTextsForContour(contourObj) {
        if (!contourObj?.placementId) {
            return;
        }
        this.texts
            .filter(textObj => textObj.kind === 'attached' && textObj.ownerPlacementId === contourObj.placementId)
            .forEach(textObj => {
                const absolute = this.computeAbsoluteTextPosition(textObj);
                textObj.set({ left: absolute.left, top: absolute.top, angle: absolute.angle });
                this.clampTextToContourBounds(textObj);
                this.updateAttachedTextAnchorFromAbsolute(textObj);
                textObj.setCoords();
            });
    }

    attachTextToContour(textObj, contourObj, role = 'custom') {
        if (!textObj?.isTextObject || !contourObj?.placementId) {
            return;
        }
        textObj.kind = 'attached';
        textObj.role = role;
        textObj.ownerPlacementId = contourObj.placementId;
        textObj.lockRotation = true;
        this.updateAttachedTextAnchorFromAbsolute(textObj);
        this.syncAttachedTextsForContour(contourObj);
    }

    detachText(textObj) {
        if (!textObj?.isTextObject) {
            return;
        }
        textObj.kind = 'free';
        textObj.role = 'custom';
        textObj.ownerPlacementId = null;
        textObj.localOffsetX = 0;
        textObj.localOffsetY = 0;
        textObj.localAngle = 0;
        textObj.lockRotation = false;
    }

    removeText(textObj) {
        if (!textObj) {
            return;
        }
        this.texts = this.texts.filter(item => item !== textObj);
        this.canvas.remove(textObj);
    }

    removeTextsForPlacementId(placementId) {
        this.texts
            .filter(textObj => textObj.ownerPlacementId === placementId)
            .forEach(textObj => this.removeText(textObj));
    }

    clearTexts() {
        this.texts.forEach(textObj => this.canvas.remove(textObj));
        this.texts = [];
    }

    updateAttachedTextAnchorFromAbsolute(textObj) {
        if (!textObj?.isTextObject || textObj.kind !== 'attached' || !Number.isFinite(textObj.ownerPlacementId)) {
            return;
        }
        const contour = this.getContourByPlacementId(textObj.ownerPlacementId);
        if (!contour) {
            return;
        }

        const center = contour.getCenterPoint();
        const dx = textObj.left - center.x;
        const dy = textObj.top - center.y;
        const angleRad = fabric.util.degreesToRadians(contour.angle || 0);

        textObj.localOffsetX = (dx * Math.cos(-angleRad)) - (dy * Math.sin(-angleRad));
        textObj.localOffsetY = (dx * Math.sin(-angleRad)) + (dy * Math.cos(-angleRad));
        textObj.localAngle = (textObj.angle || 0) - (contour.angle || 0);
        textObj.fontSizeMm = Number(textObj.fontSize) || Config.LABELS.FONT_SIZE_MM;
    }

    computeAbsoluteTextPosition(textObj) {
        if (!textObj?.isTextObject || textObj.kind !== 'attached' || !Number.isFinite(textObj.ownerPlacementId)) {
            return {
                left: textObj?.left ?? 0,
                top: textObj?.top ?? 0,
                angle: textObj?.angle ?? 0
            };
        }

        const contour = this.getContourByPlacementId(textObj.ownerPlacementId);
        if (!contour) {
            return {
                left: textObj.left,
                top: textObj.top,
                angle: textObj.angle || 0
            };
        }

        const center = contour.getCenterPoint();
        const angleRad = fabric.util.degreesToRadians(contour.angle || 0);
        const absDx = (textObj.localOffsetX * Math.cos(angleRad)) - (textObj.localOffsetY * Math.sin(angleRad));
        const absDy = (textObj.localOffsetX * Math.sin(angleRad)) + (textObj.localOffsetY * Math.cos(angleRad));

        return {
            left: center.x + absDx,
            top: center.y + absDy,
            angle: (contour.angle || 0) + (textObj.localAngle || 0)
        };
    }

    getAttachedTextByPlacementId(placementId, role = null) {
        return this.texts.find(textObj => {
            if (textObj.kind !== 'attached' || textObj.ownerPlacementId !== placementId) {
                return false;
            }
            return role ? textObj.role === role : true;
        }) || null;
    }

    getWorkspaceTextsData() {
        const layment = this.canvas.layment;
        if (!layment) {
            return [];
        }

        return this.texts
            .map(textObj => this.buildWorkspaceTextSnapshot(textObj, layment))
            .filter(Boolean);
    }

    buildWorkspaceTextSnapshot(textObj, layment = this.canvas.layment) {
        if (!layment || !textObj?.aCoords?.tl) {
            return null;
        }

        const tl = textObj.aCoords.tl;
        return {
            kind: textObj.kind === 'attached' ? 'attached' : 'free',
            role: typeof textObj.role === 'string' && textObj.role.trim() ? textObj.role : 'custom',
            ownerPlacementId: Number.isFinite(textObj.ownerPlacementId) ? textObj.ownerPlacementId : null,
            text: typeof textObj.text === 'string' ? textObj.text : '',
            fontSizeMm: Number(textObj.fontSize) || Config.LABELS.FONT_SIZE_MM,
            localOffsetX: Number.isFinite(textObj.localOffsetX) ? textObj.localOffsetX : 0,
            localOffsetY: Number.isFinite(textObj.localOffsetY) ? textObj.localOffsetY : 0,
            localAngle: Number.isFinite(textObj.localAngle) ? textObj.localAngle : 0,
            x: Math.round((tl.x - layment.left) / layment.scaleX),
            y: Math.round((tl.y - layment.top) / layment.scaleY)
        };
    }

    normalizeWorkspaceTexts(rawTexts) {
        if (!Array.isArray(rawTexts)) {
            return [];
        }

        return rawTexts
            .map(item => this.normalizeWorkspaceText(item))
            .filter(Boolean);
    }

    normalizeWorkspaceText(rawText) {
        if (!rawText || typeof rawText !== 'object') {
            return null;
        }
        if (!Number.isFinite(rawText.x) || !Number.isFinite(rawText.y)) {
            return null;
        }

        const kind = rawText.kind === 'attached' ? 'attached' : 'free';
        const ownerPlacementId = Number.isFinite(rawText.ownerPlacementId) ? rawText.ownerPlacementId : null;

        return {
            kind,
            role: typeof rawText.role === 'string' && rawText.role.trim() ? rawText.role : 'custom',
            ownerPlacementId,
            text: typeof rawText.text === 'string' ? rawText.text : '',
            fontSizeMm: Number(rawText.fontSizeMm) || Config.LABELS.FONT_SIZE_MM,
            localOffsetX: Number.isFinite(rawText.localOffsetX) ? rawText.localOffsetX : 0,
            localOffsetY: Number.isFinite(rawText.localOffsetY) ? rawText.localOffsetY : 0,
            localAngle: Number.isFinite(rawText.localAngle) ? rawText.localAngle : 0,
            x: rawText.x,
            y: rawText.y
        };
    }

    getExportTextsData() {
        const layment = this.canvas.layment;
        if (!layment) {
            return [];
        }

        return this.texts
            .map(textObj => {
                if (!textObj?.aCoords?.tl) {
                    return null;
                }
                const tl = textObj.aCoords.tl;
                return {
                    contourId: String(textObj.ownerPlacementId ?? ''),
                    text: textObj.text,
                    x: Math.round(tl.x - layment.left),
                    y: Math.round(tl.y - layment.top),
                    fontSizeMm: Number(textObj.fontSize) || Config.LABELS.FONT_SIZE_MM
                };
            })
            .filter(item => item && item.contourId);
    }
}
