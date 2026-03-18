// objectMeta.js
// Унифицированная мета-информация объектов canvas.

(function initObjectMetaModule(global) {
    const META_KEY = '__objectMeta';
    const DEFAULT_META = Object.freeze({
        objectRole: 'generic',
        isLocked: false,
        groupId: null,
        selectionMode: 'normal',
        followMode: 'none',
        boundToId: null,
        placementId: null
    });

    function normalizeSelectionMode(selectionMode) {
        if (selectionMode === 'default') {
            return 'normal';
        }
        return typeof selectionMode === 'string' ? selectionMode : 'normal';
    }

    function normalizePatch(patch) {
        if (!patch || typeof patch !== 'object') {
            return {};
        }
        return patch;
    }

    function ensureMeta(obj) {
        if (!obj || typeof obj !== 'object') {
            return null;
        }
        if (!obj[META_KEY] || typeof obj[META_KEY] !== 'object') {
            obj[META_KEY] = { ...DEFAULT_META };
        } else {
            obj[META_KEY] = {
                ...DEFAULT_META,
                ...obj[META_KEY]
            };
        }
        return obj[META_KEY];
    }

    function normalizePlacementIdFromObject(obj, meta) {
        const placementId = Number.isFinite(obj?.placementId) ? obj.placementId : meta.placementId;
        return Number.isFinite(placementId) ? placementId : null;
    }

    function initObjectMeta(obj, patch = {}) {
        const meta = ensureMeta(obj);
        if (!meta) {
            return null;
        }

        const nextPatch = normalizePatch(patch);
        Object.assign(meta, nextPatch);
        applyInteractionState(obj);
        return meta;
    }

    function patchObjectMeta(obj, patch = {}) {
        const meta = ensureMeta(obj);
        if (!meta) {
            return null;
        }

        const nextPatch = normalizePatch(patch);
        Object.assign(meta, nextPatch);
        applyInteractionState(obj);
        return meta;
    }

    function copyObjectMeta(src, dst) {
        if (!src || !dst) {
            return null;
        }

        const srcMeta = src[META_KEY];
        if (!srcMeta || typeof srcMeta !== 'object') {
            return initObjectMeta(dst, {});
        }

        const clonedMeta = JSON.parse(JSON.stringify(srcMeta));
        dst[META_KEY] = clonedMeta;
        applyInteractionState(dst);
        return clonedMeta;
    }

    function applyInteractionState(obj) {
        if (!obj) {
            return obj;
        }

        const meta = ensureMeta(obj) || {};
        if (typeof meta.lockMovementX !== 'boolean') {
            meta.lockMovementX = !!obj.lockMovementX;
        }
        if (typeof meta.lockMovementY !== 'boolean') {
            meta.lockMovementY = !!obj.lockMovementY;
        }
        if (typeof meta.lockRotation !== 'boolean') {
            meta.lockRotation = !!obj.lockRotation;
        }
        if (typeof meta.lockScalingX !== 'boolean') {
            meta.lockScalingX = !!obj.lockScalingX;
        }
        if (typeof meta.lockScalingY !== 'boolean') {
            meta.lockScalingY = !!obj.lockScalingY;
        }
        if (typeof meta.hasControls !== 'boolean') {
            meta.hasControls = typeof obj.hasControls === 'boolean' ? obj.hasControls : !obj.isTextObject;
        }
        if (typeof meta.hasBorders !== 'boolean') {
            meta.hasBorders = typeof obj.hasBorders === 'boolean' ? obj.hasBorders : true;
        }
        meta.placementId = normalizePlacementIdFromObject(obj, meta);
        const selectionMode = normalizeSelectionMode(meta.selectionMode);
        meta.selectionMode = selectionMode;
        const isLockedBySemanticFlag = meta.isLocked === true || selectionMode === 'readonly';
        const canSelect = selectionMode !== 'noSelect' && meta.selectable !== false;
        const allowEvents = meta.evented !== false;
        const baseHasControls = meta.hasControls;
        const baseHasBorders = meta.hasBorders;
        const baseLockRotation = meta.lockRotation;
        const baseLockScalingX = meta.lockScalingX;
        const baseLockScalingY = meta.lockScalingY;

        if (isLockedBySemanticFlag || meta.locked === true || meta.interactive === false) {
            obj.selectable = canSelect;
            obj.evented = allowEvents;
            obj.lockMovementX = true;
            obj.lockMovementY = true;
            obj.lockRotation = true;
            obj.lockScalingX = true;
            obj.lockScalingY = true;
            obj.hasControls = false;
            obj.hasBorders = baseHasBorders;
            return obj;
        }

        obj.selectable = canSelect;
        obj.evented = allowEvents;

        if (typeof meta.lockMovementX === 'boolean') {
            obj.lockMovementX = meta.lockMovementX;
        } else {
            obj.lockMovementX = false;
        }
        if (typeof meta.lockMovementY === 'boolean') {
            obj.lockMovementY = meta.lockMovementY;
        } else {
            obj.lockMovementY = false;
        }
        obj.lockRotation = baseLockRotation;
        obj.lockScalingX = baseLockScalingX;
        obj.lockScalingY = baseLockScalingY;
        obj.hasControls = baseHasControls;
        obj.hasBorders = baseHasBorders;
        if (selectionMode === 'noSelect') {
            obj.selectable = false;
            obj.evented = false;
        }

        return obj;
    }

    const api = {
        initObjectMeta,
        patchObjectMeta,
        copyObjectMeta,
        applyInteractionState,
        normalizeSelectionMode
    };

    global.ObjectMeta = api;
    global.initObjectMeta = initObjectMeta;
    global.patchObjectMeta = patchObjectMeta;
    global.copyObjectMeta = copyObjectMeta;
    global.applyInteractionState = applyInteractionState;
    global.normalizeSelectionMode = normalizeSelectionMode;
})(window);
