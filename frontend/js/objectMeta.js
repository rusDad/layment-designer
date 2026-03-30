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

    function normalizeGroupId(groupId) {
        return typeof groupId === 'string' && groupId.trim()
            ? groupId.trim()
            : null;
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

    function getObjectMeta(obj) {
        return ensureMeta(obj);
    }

    function getGroupId(obj) {
        return normalizeGroupId(ensureMeta(obj)?.groupId);
    }

    function normalizePlacementIdFromObject(obj, meta) {
        const placementId = Number.isFinite(obj?.placementId) ? obj.placementId : meta.placementId;
        return Number.isFinite(placementId) ? placementId : null;
    }

    function getObjectRole(obj, meta) {
        if (typeof meta?.objectRole === 'string' && meta.objectRole.trim()) {
            return meta.objectRole;
        }
        if (obj?.isTextObject) {
            return 'text';
        }
        if (obj?.primitiveType) {
            return 'primitive';
        }
        return 'generic';
    }

    function getBaseMechanicalState(obj, meta) {
        const objectRole = getObjectRole(obj, meta);
        const isTextObject = objectRole === 'text' || !!obj?.isTextObject;
        const isPrimitive = objectRole === 'primitive' || !!obj?.primitiveType;
        const isContour = objectRole === 'contour' || (!isTextObject && !isPrimitive);
        const isAttachedText = isTextObject && obj?.kind === 'attached';

        return {
            selectable: true,
            evented: true,
            lockMovementX: false,
            lockMovementY: false,
            lockRotation: isTextObject ? isAttachedText : !!isPrimitive,
            lockScalingX: isTextObject || isContour,
            lockScalingY: isTextObject || isContour,
            hasControls: !isTextObject,
            hasBorders: true
        };
    }

    function initObjectMeta(obj, patch = {}) {
        const meta = ensureMeta(obj);
        if (!meta) {
            return null;
        }

        const nextPatch = normalizePatch(patch);
        if (Object.prototype.hasOwnProperty.call(nextPatch, 'groupId')) {
            nextPatch.groupId = normalizeGroupId(nextPatch.groupId);
        }
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
        if (Object.prototype.hasOwnProperty.call(nextPatch, 'groupId')) {
            nextPatch.groupId = normalizeGroupId(nextPatch.groupId);
        }
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
        const selectionMode = normalizeSelectionMode(meta.selectionMode);
        meta.selectionMode = selectionMode;
        const isLockedBySemanticFlag = meta.isLocked === true || selectionMode === 'readonly';
        const baseState = getBaseMechanicalState(obj, meta);
        const canSelect = selectionMode !== 'noSelect';
        const allowEvents = selectionMode !== 'noSelect';

        if (isLockedBySemanticFlag || meta.locked === true || meta.interactive === false) {
            obj.selectable = canSelect;
            obj.evented = allowEvents;
            obj.lockMovementX = true;
            obj.lockMovementY = true;
            obj.lockRotation = true;
            obj.lockScalingX = true;
            obj.lockScalingY = true;
            obj.hasControls = false;
            obj.hasBorders = baseState.hasBorders;
            return obj;
        }

        obj.selectable = canSelect;
        obj.evented = allowEvents;
        obj.lockMovementX = baseState.lockMovementX;
        obj.lockMovementY = baseState.lockMovementY;
        obj.lockRotation = baseState.lockRotation;
        obj.lockScalingX = baseState.lockScalingX;
        obj.lockScalingY = baseState.lockScalingY;
        obj.hasControls = baseState.hasControls;
        obj.hasBorders = baseState.hasBorders;
        if (selectionMode === 'noSelect') {
            obj.selectable = false;
            obj.evented = false;
        }

        return obj;
    }

    const api = {
        getObjectMeta,
        getGroupId,
        initObjectMeta,
        patchObjectMeta,
        copyObjectMeta,
        applyInteractionState,
        normalizeSelectionMode,
        normalizeGroupId
    };

    global.ObjectMeta = api;
    global.getObjectMeta = getObjectMeta;
    global.getGroupId = getGroupId;
    global.initObjectMeta = initObjectMeta;
    global.patchObjectMeta = patchObjectMeta;
    global.copyObjectMeta = copyObjectMeta;
    global.applyInteractionState = applyInteractionState;
    global.normalizeSelectionMode = normalizeSelectionMode;
})(window);
