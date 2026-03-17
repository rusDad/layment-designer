// objectMeta.js
// Унифицированная мета-информация объектов canvas.

(function initObjectMetaModule(global) {
    const META_KEY = '__objectMeta';
    const DEFAULT_META = Object.freeze({
        objectRole: 'generic',
        isLocked: false,
        groupId: null,
        selectionMode: 'default',
        followMode: 'none',
        boundToId: null,
        placementId: null
    });

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
        meta.placementId = normalizePlacementIdFromObject(obj, meta);
        const selectionMode = typeof meta.selectionMode === 'string' ? meta.selectionMode : 'default';
        const isLockedBySemanticFlag = meta.isLocked === true || selectionMode === 'readonly';

        if (isLockedBySemanticFlag || meta.locked === true || meta.interactive === false) {
            obj.selectable = false;
            obj.evented = false;
            obj.lockMovementX = true;
            obj.lockMovementY = true;
            obj.lockRotation = true;
            obj.lockScalingX = true;
            obj.lockScalingY = true;
            obj.hasControls = false;
            obj.hasBorders = false;
            return obj;
        }

        if (meta.selectable === false) {
            obj.selectable = false;
            obj.evented = meta.evented !== false;
        }

        if (meta.selectable === true) {
            obj.selectable = true;
        }

        if (typeof meta.evented === 'boolean') {
            obj.evented = meta.evented;
        }

        if (typeof meta.lockMovementX === 'boolean') {
            obj.lockMovementX = meta.lockMovementX;
        }
        if (typeof meta.lockMovementY === 'boolean') {
            obj.lockMovementY = meta.lockMovementY;
        }
        if (typeof meta.lockRotation === 'boolean') {
            obj.lockRotation = meta.lockRotation;
        }
        if (typeof meta.lockScalingX === 'boolean') {
            obj.lockScalingX = meta.lockScalingX;
        }
        if (typeof meta.lockScalingY === 'boolean') {
            obj.lockScalingY = meta.lockScalingY;
        }
        if (typeof meta.hasControls === 'boolean') {
            obj.hasControls = meta.hasControls;
        }
        if (typeof meta.hasBorders === 'boolean') {
            obj.hasBorders = meta.hasBorders;
        }
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
        applyInteractionState
    };

    global.ObjectMeta = api;
    global.initObjectMeta = initObjectMeta;
    global.patchObjectMeta = patchObjectMeta;
    global.copyObjectMeta = copyObjectMeta;
    global.applyInteractionState = applyInteractionState;
})(window);
