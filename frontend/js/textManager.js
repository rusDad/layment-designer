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
        if (Number.isFinite(Config.TEXT?.BOUNDS_PAD_MM)) {
            return Config.TEXT.BOUNDS_PAD_MM;
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


    applyTextSemanticMeta(textObj) {
        if (!textObj?.isTextObject) {
            return;
        }

        const objectMetaApi = this.app?.objectMetaApi || window.ObjectMeta;
        if (!objectMetaApi?.patchObjectMeta) {
            return;
        }

        const isAttached = textObj.kind === 'attached';
        const currentMeta = objectMetaApi.getObjectMeta?.(textObj) || null;
        objectMetaApi.patchObjectMeta(textObj, {
            objectRole: 'text',
            isLocked: currentMeta?.isLocked === true,
            groupId: null,
            selectionMode: 'clickOnly',
            followMode: isAttached ? 'followBoundObject' : 'none',
            boundToId: isAttached ? (textObj.ownerPlacementId ?? null) : null,
            placementId: textObj.placementId ?? null
        });
    }

    buildTextObject({ text = '', left, top, fontSizeMm, role = 'user-text', kind = 'free', ownerPlacementId = null }) {
        const textObj = new fabric.IText(text, {
            left,
            top,
            originX: 'left',
            originY: 'top',
            fontSize: fontSizeMm ?? Config.TEXT.FONT_SIZE_MM,
            fontFamily: 'Arial',
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
        textObj.fontSizeMm = Number(textObj.fontSize) || Config.TEXT.FONT_SIZE_MM;
        textObj.localOffsetX = 0;
        textObj.localOffsetY = 0;
        textObj.localAngle = 0;
        textObj.excludeFromExport = true;
        this.applyTextSemanticMeta(textObj);

        textObj.on('moving', () => {
            this.canvas.requestRenderAll();
        });

        textObj.on('modified', () => {
            textObj.text = textObj.text ?? '';
            textObj.fontSizeMm = Number(textObj.fontSize) || Config.TEXT.FONT_SIZE_MM;
            this.app.scheduleWorkspaceSave();
        });

        return textObj;
    }

    createFreeText({ text = '', left, top, fontSizeMm, role = 'user-text' }) {
        const textObj = this.buildTextObject({ text, left, top, fontSizeMm, role, kind: 'free', ownerPlacementId: null });
        this.texts.push(textObj);
        this.canvas.add(textObj);
        textObj.setCoords();
        return textObj;
    }

    createAttachedText(contourObj, { text = '', role = 'user-text', fontSizeMm, left, top, localOffsetX, localOffsetY, localAngle } = {}) {
        if (!contourObj?.placementId) {
            return null;
        }

        const rect = contourObj.getBoundingRect(true, true);
        const initialLeft = Number.isFinite(left) ? left : rect.left + rect.width + Config.TEXT.DEFAULT_OFFSET.x;
        const initialTop = Number.isFinite(top) ? top : rect.top + Config.TEXT.DEFAULT_OFFSET.y;

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
        const existing = this.getAttachedTextByPlacementId(contourObj.placementId, 'default-text');
        if (existing) {
            return existing;
        }
        return this.createAttachedText(contourObj, { text: defaultText, role: 'default-text' });
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

    attachTextToContour(textObj, contourObj, role = 'user-text') {
        if (!textObj?.isTextObject || !contourObj?.placementId) {
            return;
        }
        textObj.kind = 'attached';
        textObj.role = role;
        textObj.ownerPlacementId = contourObj.placementId;
        textObj.lockRotation = true;
        this.applyTextSemanticMeta(textObj);
        this.updateAttachedTextAnchorFromAbsolute(textObj);
        this.syncAttachedTextsForContour(contourObj);
    }

    detachText(textObj) {
        if (!textObj?.isTextObject) {
            return;
        }
        textObj.kind = 'free';
        textObj.role = 'user-text';
        textObj.ownerPlacementId = null;
        textObj.localOffsetX = 0;
        textObj.localOffsetY = 0;
        textObj.localAngle = 0;
        textObj.lockRotation = false;
        this.applyTextSemanticMeta(textObj);
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
        textObj.fontSizeMm = Number(textObj.fontSize) || Config.TEXT.FONT_SIZE_MM;
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

    getAttachedTextsByPlacementId(placementId, role = null) {
        return this.texts.filter(textObj => {
            if (textObj.kind !== 'attached' || textObj.ownerPlacementId !== placementId) {
                return false;
            }
            return role ? textObj.role === role : true;
        });
    }

    getAttachedTextsForContour(contourObj, role = null) {
        if (!contourObj?.placementId) {
            return [];
        }
        return this.getAttachedTextsByPlacementId(contourObj.placementId, role);
    }

    getAttachedTextByPlacementId(placementId, role = null) {
        return this.getAttachedTextsByPlacementId(placementId, role)[0] || null;
    }

    getWorkspaceTextsData(options = {}) {
        const layment = this.canvas.layment;
        if (!layment) {
            return [];
        }

        return this.texts
            .map(textObj => this.buildWorkspaceTextSnapshot(textObj, layment, options))
            .filter(Boolean);
    }

    buildWorkspaceTextSnapshot(textObj, layment = this.canvas.layment, options = {}) {
        if (!layment || !textObj?.aCoords?.tl) {
            return null;
        }

        const tl = textObj.aCoords.tl;
        const snapshot = {
            kind: textObj.kind === 'attached' ? 'attached' : 'free',
            role: typeof textObj.role === 'string' && textObj.role.trim() ? textObj.role : 'user-text',
            ownerPlacementId: Number.isFinite(textObj.ownerPlacementId) ? textObj.ownerPlacementId : null,
            text: typeof textObj.text === 'string' ? textObj.text : '',
            fontSizeMm: Number(textObj.fontSize) || Config.TEXT.FONT_SIZE_MM,
            localOffsetX: Number.isFinite(textObj.localOffsetX) ? textObj.localOffsetX : 0,
            localOffsetY: Number.isFinite(textObj.localOffsetY) ? textObj.localOffsetY : 0,
            localAngle: Number.isFinite(textObj.localAngle) ? textObj.localAngle : 0,
            isLocked: this.app?.interactionPolicy?.isSemanticallyLocked?.(textObj) === true,
            x: Math.round((tl.x - layment.left) / layment.scaleX),
            y: Math.round((tl.y - layment.top) / layment.scaleY)
        };
        if (options.includeEditorState !== false) {
            snapshot.editorState = {
                groupId: this.app?.objectMetaApi?.getGroupId?.(textObj) || null
            };
        }
        return snapshot;
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
            role: typeof rawText.role === 'string' && rawText.role.trim() ? rawText.role : 'user-text',
            ownerPlacementId,
            text: typeof rawText.text === 'string' ? rawText.text : '',
            fontSizeMm: Number(rawText.fontSizeMm) || Config.TEXT.FONT_SIZE_MM,
            localOffsetX: Number.isFinite(rawText.localOffsetX) ? rawText.localOffsetX : 0,
            localOffsetY: Number.isFinite(rawText.localOffsetY) ? rawText.localOffsetY : 0,
            localAngle: Number.isFinite(rawText.localAngle) ? rawText.localAngle : 0,
            isLocked: rawText.isLocked === true,
            editorState: rawText.editorState && typeof rawText.editorState === 'object'
                ? {
                    groupId: this.app?.objectMetaApi?.normalizeGroupId?.(rawText.editorState.groupId) || null
                }
                : {
                    groupId: this.app?.objectMetaApi?.normalizeGroupId?.(rawText.groupId) || null
                },
            x: rawText.x,
            y: rawText.y
        };
    }

    buildExportTexts() {
        const layment = this.canvas.layment;
        if (!layment) {
            return [];
        }

        return this.texts
            .map(textObj => {
                if (!textObj?.isTextObject) {
                    return null;
                }

                const isAttached = textObj.kind === 'attached';
                const ownerContourId = isAttached && Number.isFinite(textObj.ownerPlacementId)
                    ? String(textObj.ownerPlacementId)
                    : null;
                const absolute = isAttached
                    ? this.computeAbsoluteTextPosition(textObj)
                    : {
                        left: textObj.left ?? 0,
                        top: textObj.top ?? 0,
                        angle: textObj.angle ?? 0
                    };

                return {
                    kind: isAttached ? 'attached' : 'free',
                    text: typeof textObj.text === 'string' ? textObj.text : '',
                    x: Math.round((absolute.left ?? 0) - layment.left),
                    y: Math.round((absolute.top ?? 0) - layment.top),
                    angle: Number.isFinite(absolute.angle) ? absolute.angle : 0,
                    fontSizeMm: Number(textObj.fontSize) || Config.TEXT.FONT_SIZE_MM,
                    ownerContourId
                };
            })
            .filter(Boolean);
    }
}
