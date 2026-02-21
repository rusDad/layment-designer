// labelManager.js
// Управление подписями контуров (labels) как отдельными объектами canvas.

class LabelManager {
    constructor(canvas, app, contourManager) {
        this.canvas = canvas;
        this.app = app;
        this.contourManager = contourManager;
        this.labels = [];
    }

    getBoundsPadMm() {
        if (Number.isFinite(Config.LABELS?.BOUNDS_PAD_MM)) {
            return Config.LABELS.BOUNDS_PAD_MM;
        }
        return Config.GEOMETRY.CLEARANCE_MM;
    }

    getContourByPlacementId(placementId) {
        if (!placementId) {
            return null;
        }
        return this.contourManager.contours.find(contour => contour.placementId === placementId) || null;
    }

    getAllowedRectForContour(contour) {
        if (!contour) {
            return null;
        }
        const rect = contour.getBoundingRect(true, true);
        const workspaceScale = this.app.workspaceScale || 1;
        const pad = this.getBoundsPadMm() * workspaceScale;
        return {
            left: rect.left - pad,
            top: rect.top - pad,
            right: rect.left + rect.width + pad,
            bottom: rect.top + rect.height + pad
        };
    }

    clampLabelToContourBounds(labelObj) {
        if (!labelObj?.isLabel) {
            return;
        }

        const contour = this.getContourByPlacementId(labelObj.labelForPlacementId);
        if (!contour) {
            return;
        }

        const allowedRect = this.getAllowedRectForContour(contour);
        if (!allowedRect) {
            return;
        }

        labelObj.setCoords();
        const labelRect = labelObj.getBoundingRect(true, true);

        let nextLeft = labelObj.left;
        let nextTop = labelObj.top;

        if (labelRect.left < allowedRect.left) {
            nextLeft += allowedRect.left - labelRect.left;
        }
        if (labelRect.top < allowedRect.top) {
            nextTop += allowedRect.top - labelRect.top;
        }

        const labelRight = labelRect.left + labelRect.width;
        const labelBottom = labelRect.top + labelRect.height;

        if (labelRight > allowedRect.right) {
            nextLeft -= labelRight - allowedRect.right;
        }
        if (labelBottom > allowedRect.bottom) {
            nextTop -= labelBottom - allowedRect.bottom;
        }

        labelObj.set({
            left: nextLeft,
            top: nextTop,
            angle: 0
        });
        labelObj.setCoords();
        this.canvas.requestRenderAll();
    }

    attachLabelEvents(label) {
        label.on('moving', () => {
            this.clampLabelToContourBounds(label);
        });

        label.on('modified', () => {
            this.clampLabelToContourBounds(label);
            this.app.scheduleWorkspaceSave();
        });
    }

    createLabel({ placementId, text, left, top, fontSize }) {
        if (!placementId) {
            return null;
        }

        const label = new fabric.IText(text ?? '', {
            left,
            top,
            originX: 'left',
            originY: 'top',
            fontSize: fontSize ?? Config.LABELS.FONT_SIZE_MM,
            scaleX: this.app.workspaceScale || 1,
            scaleY: this.app.workspaceScale || 1,
            fill: '#000000',
            // FIX: валидное значение CanvasTextBaseline
            textBaseline: 'alphabetic',
            angle: 0,
            selectable: true,
            evented: true,
            hasControls: false,
            hasBorders: true,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true
        });

        label.isLabel = true;
        label.labelForPlacementId = placementId;
        label.excludeFromExport = true;

        this.attachLabelEvents(label);
        this.labels.push(label);
        this.canvas.add(label);
        label.setCoords();
        this.clampLabelToContourBounds(label);

        return label;
    }

    createOrUpdateLabelForContour(contourObj, text = '') {
        if (!contourObj?.placementId) {
            return null;
        }

        const placementId = contourObj.placementId;
        const existing = this.getLabelByPlacementId(placementId);
        if (existing) {
            existing.set({ text, angle: 0 });
            existing.dirty = true;
            existing.setCoords();
            this.clampLabelToContourBounds(existing);
            return existing;
        }

        const rect = contourObj.getBoundingRect(true, true);
        const left = rect.left + rect.width + Config.LABELS.DEFAULT_OFFSET.x;
        const top = rect.top + Config.LABELS.DEFAULT_OFFSET.y;

        contourObj._lastLeft = contourObj.left;
        contourObj._lastTop = contourObj.top;

        return this.createLabel({
            placementId,
            text,
            left,
            top,
            fontSize: Config.LABELS.FONT_SIZE_MM
        });
    }

    ensureDefaultLabelForContour(contourObj, defaultLabelText) {
        if (!contourObj || !defaultLabelText) {
            return null;
        }
        return this.createOrUpdateLabelForContour(contourObj, defaultLabelText);
    }

    getLabelByPlacementId(placementId) {
        return this.labels.find(label => label.labelForPlacementId === placementId) || null;
    }

    removeLabel(labelObj) {
        if (!labelObj) {
            return;
        }
        this.labels = this.labels.filter(label => label !== labelObj);
        this.canvas.remove(labelObj);
    }

    removeLabelsForPlacementId(placementId) {
        if (!placementId) {
            return;
        }
        const toRemove = this.labels.filter(label => label.labelForPlacementId === placementId);
        toRemove.forEach(label => this.removeLabel(label));
    }

    clearLabels() {
        this.labels.forEach(label => this.canvas.remove(label));
        this.labels = [];
    }

    onContourMoving(contour) {
        if (!contour || !contour.placementId) {
            return;
        }

        const label = this.getLabelByPlacementId(contour.placementId);
        if (!label) {
            contour._lastLeft = contour.left;
            contour._lastTop = contour.top;
            return;
        }

        const prevLeft = Number.isFinite(contour._lastLeft) ? contour._lastLeft : contour.left;
        const prevTop = Number.isFinite(contour._lastTop) ? contour._lastTop : contour.top;
        const dx = contour.left - prevLeft;
        const dy = contour.top - prevTop;

        if (dx !== 0 || dy !== 0) {
            label.set({
                left: label.left + dx,
                top: label.top + dy,
                angle: 0
            });
            label.setCoords();
            this.clampLabelToContourBounds(label);
        }

        contour._lastLeft = contour.left;
        contour._lastTop = contour.top;
    }

    onContourModified(contour) {
        if (!contour || !contour.placementId) {
            return;
        }
        contour._lastLeft = contour.left;
        contour._lastTop = contour.top;

        const label = this.getLabelByPlacementId(contour.placementId);
        if (label) {
            label.set({ angle: 0 });
            label.setCoords();
            this.clampLabelToContourBounds(label);
        }
    }

    getWorkspaceLabelsData() {
        const layment = this.canvas.layment;
        if (!layment) {
            return [];
        }

        return this.labels
            .map(label => {
                if (!label?.aCoords?.tl) {
                    return null;
                }
                const tl = label.aCoords.tl;
                return {
                    placementId: label.labelForPlacementId,
                    text: label.text,
                    x: Math.round((tl.x - layment.left) / layment.scaleX),
                    y: Math.round((tl.y - layment.top) / layment.scaleY),
                    fontSizeMm: Number(label.fontSize) || Config.LABELS.FONT_SIZE_MM
                };
            })
            .filter(Boolean);
    }

    getExportLabelsData() {
        const layment = this.canvas.layment;
        if (!layment) {
            return [];
        }

        const workspaceScale = this.app.workspaceScale || 1;

        return this.labels
            .map(label => {
                if (!label?.aCoords?.tl) {
                    return null;
                }

                const tl = label.aCoords.tl;
                return {
                    contourId: String(label.labelForPlacementId),
                    text: label.text,
                    x: Math.round((tl.x - layment.left) / workspaceScale),
                    y: Math.round((tl.y - layment.top) / workspaceScale),
                    fontSizeMm: Number(label.fontSize) || Config.LABELS.FONT_SIZE_MM
                };
            })
            .filter(Boolean);
    }
}
