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

    getContourById(contourId) {
        if (!contourId) {
            return null;
        }
        return this.contourManager.contours.find(contour => contour.contourId === contourId) || null;
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

    clampLabelToContourBounds(labelObj) {
        if (!labelObj?.isLabel) {
            return;
        }

        const contour = this.getContourById(labelObj.labelForContourId);
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

    createLabel({ contourId, text, left, top, fontSize }) {
        if (!contourId) {
            return null;
        }

        const label = new fabric.IText(text ?? '', {
            left,
            top,
            originX: 'left',
            originY: 'top',
            fontSize: fontSize ?? Config.LABELS.FONT_SIZE_MM,
            fill: '#000000',
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
        label.labelForContourId = contourId;
        label.excludeFromExport = true;

        this.attachLabelEvents(label);
        this.labels.push(label);
        this.canvas.add(label);
        label.setCoords();
        this.clampLabelToContourBounds(label);

        return label;
    }

    createOrUpdateLabelForContour(contourObj, text = '') {
        if (!contourObj?.contourId) {
            return null;
        }

        const contourId = contourObj.contourId;
        const existing = this.getLabelByContourId(contourId);
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
            contourId,
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

    getLabelByContourId(contourId) {
        return this.labels.find(label => label.labelForContourId === contourId) || null;
    }

    removeLabel(labelObj) {
        if (!labelObj) {
            return;
        }
        this.labels = this.labels.filter(label => label !== labelObj);
        this.canvas.remove(labelObj);
    }

    removeLabelsForContourId(contourId) {
        if (!contourId) {
            return;
        }
        const toRemove = this.labels.filter(label => label.labelForContourId === contourId);
        toRemove.forEach(label => this.removeLabel(label));
    }

    clearLabels() {
        this.labels.forEach(label => this.canvas.remove(label));
        this.labels = [];
    }

    onContourMoving(contour) {
        if (!contour || !contour.contourId) {
            return;
        }

        const label = this.getLabelByContourId(contour.contourId);
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
        if (!contour || !contour.contourId) {
            return;
        }
        contour._lastLeft = contour.left;
        contour._lastTop = contour.top;

        const label = this.getLabelByContourId(contour.contourId);
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
                    contourId: label.labelForContourId,
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
                    contourId: label.labelForContourId,
                    text: label.text,
                    x: Math.round((tl.x - layment.left) / workspaceScale),
                    y: Math.round((tl.y - layment.top) / workspaceScale),
                    fontSizeMm: Number(label.fontSize) || Config.LABELS.FONT_SIZE_MM
                };
            })
            .filter(Boolean);
    }
}
