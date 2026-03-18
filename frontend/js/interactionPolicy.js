// interactionPolicy.js
// Централизованные правила интеракций. На первом шаге — консервативные дефолты.

(function initInteractionPolicyModule(global) {
    function getObjectMeta(obj) {
        if (!obj || typeof obj !== 'object') {
            return null;
        }
        return obj.__objectMeta && typeof obj.__objectMeta === 'object'
            ? obj.__objectMeta
            : null;
    }

    function isSemanticallyLocked(obj) {
        const meta = getObjectMeta(obj);
        if (!meta) {
            return false;
        }
        return meta.isLocked === true
            || meta.locked === true
            || meta.interactive === false
            || meta.selectionMode === 'readonly';
    }

    function isProtectedObject(ctx, obj) {
        if (!obj) {
            return true;
        }
        return obj === ctx?.layment || obj === ctx?.safeArea;
    }

    function canSelect(ctx, obj) {
        if (!obj || isProtectedObject(ctx, obj)) {
            return false;
        }
        return obj.selectable !== false;
    }

    function canBoxSelect(ctx, obj) {
        return canSelect(ctx, obj);
    }

    function canDelete(ctx, obj) {
        if (!obj || isProtectedObject(ctx, obj)) {
            return false;
        }
        return true;
    }

    function canMove(ctx, obj) {
        if (!canSelect(ctx, obj) || isSemanticallyLocked(obj)) {
            return false;
        }
        return !(obj.lockMovementX && obj.lockMovementY);
    }

    function canRotate(ctx, obj) {
        if (!obj || isProtectedObject(ctx, obj) || obj.isTextObject) {
            return false;
        }
        return !obj.primitiveType;
    }

    function canDuplicate(ctx, obj) {
        if (!obj || isProtectedObject(ctx, obj) || obj.isTextObject) {
            return false;
        }
        return true;
    }

    function isArrangeTarget(ctx, obj) {
        if (!obj || isProtectedObject(ctx, obj) || obj.isTextObject) {
            return false;
        }
        return canMove(ctx, obj);
    }

    function isDuplicateTarget(ctx, obj) {
        if (!obj || isProtectedObject(ctx, obj) || obj.isTextObject) {
            return false;
        }
        return canDuplicate(ctx, obj);
    }

    function isPrimaryArrangeTarget(ctx, obj) {
        return isArrangeTarget(ctx, obj);
    }

    function canParticipateInAlign(ctx, obj) {
        return isPrimaryArrangeTarget(ctx, obj);
    }

    function canParticipateInSnap(ctx, obj) {
        return isPrimaryArrangeTarget(ctx, obj);
    }

    function canParticipateInDistribute(ctx, obj) {
        return isPrimaryArrangeTarget(ctx, obj);
    }

    function canJoinGroup(ctx, obj) {
        return canSelect(ctx, obj);
    }

    function shouldFollowOwnerMove(ctx, obj, owner) {
        return !!owner && !!obj?.isTextObject && obj.kind === 'attached' && obj.ownerPlacementId === owner.placementId;
    }

    function getArrangeSelectionObjects(ctx, targets) {
        const list = Array.isArray(targets) ? targets : [];
        return list.filter(obj => isPrimaryArrangeTarget(ctx, obj));
    }

    function getDuplicateSelectionObjects(ctx, targets) {
        const list = Array.isArray(targets) ? targets : [];
        return list.filter(obj => isDuplicateTarget(ctx, obj));
    }

    function resolveActionTargets(ctx, activeObject, actionName = null) {
        if (!activeObject) {
            return [];
        }

        const targets = activeObject.type === 'activeSelection'
            ? activeObject.getObjects().filter(Boolean)
            : [activeObject];

        if (actionName === 'arrange' || actionName === 'align' || actionName === 'snap' || actionName === 'distribute') {
            return getArrangeSelectionObjects(ctx, targets);
        }

        if (actionName === 'duplicate') {
            return getDuplicateSelectionObjects(ctx, targets);
        }

        if (actionName === 'delete') {
            return targets.filter(obj => canDelete(ctx, obj));
        }

        if (actionName === 'rotate') {
            return targets.filter(obj => canRotate(ctx, obj));
        }

        return targets;
    }

    const api = {
        getObjectMeta,
        isSemanticallyLocked,
        canSelect,
        canBoxSelect,
        canDelete,
        canMove,
        canRotate,
        canDuplicate,
        isArrangeTarget,
        isDuplicateTarget,
        isPrimaryArrangeTarget,
        canParticipateInAlign,
        canParticipateInSnap,
        canParticipateInDistribute,
        canJoinGroup,
        shouldFollowOwnerMove,
        getArrangeSelectionObjects,
        getDuplicateSelectionObjects,
        resolveActionTargets
    };

    global.InteractionPolicy = api;
})(window);
