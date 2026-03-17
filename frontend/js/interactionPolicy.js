// interactionPolicy.js
// Централизованные правила интеракций. На первом шаге — консервативные дефолты.

(function initInteractionPolicyModule(global) {
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
        if (!canSelect(ctx, obj)) {
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

    function canParticipateInAlign(ctx, obj) {
        return isArrangeTarget(ctx, obj);
    }

    function canParticipateInSnap(ctx, obj) {
        return isArrangeTarget(ctx, obj);
    }

    function canParticipateInDistribute(ctx, obj) {
        return isArrangeTarget(ctx, obj);
    }

    function canJoinGroup(ctx, obj) {
        return canSelect(ctx, obj);
    }

    function shouldFollowOwnerMove(ctx, obj) {
        return !!obj?.isTextObject && obj.kind === 'attached';
    }

    function getArrangeSelectionObjects(ctx, targets) {
        const list = Array.isArray(targets) ? targets : [];
        return list.filter(obj => isArrangeTarget(ctx, obj));
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
        canSelect,
        canBoxSelect,
        canDelete,
        canMove,
        canRotate,
        canDuplicate,
        isArrangeTarget,
        isDuplicateTarget,
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
