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

    function canParticipateInAlign(ctx, obj) {
        return canMove(ctx, obj);
    }

    function canParticipateInSnap(ctx, obj) {
        return canMove(ctx, obj);
    }

    function canParticipateInDistribute(ctx, obj) {
        return canMove(ctx, obj);
    }

    function canJoinGroup(ctx, obj) {
        return canSelect(ctx, obj);
    }

    function shouldFollowOwnerMove(ctx, obj) {
        return !!obj?.isTextObject && obj.kind === 'attached';
    }

    function resolveActionTargets(ctx, activeObject) {
        if (!activeObject) {
            return [];
        }
        if (activeObject.type === 'activeSelection') {
            return activeObject.getObjects().filter(Boolean);
        }
        return [activeObject];
    }

    const api = {
        canSelect,
        canBoxSelect,
        canDelete,
        canMove,
        canRotate,
        canDuplicate,
        canParticipateInAlign,
        canParticipateInSnap,
        canParticipateInDistribute,
        canJoinGroup,
        shouldFollowOwnerMove,
        resolveActionTargets
    };

    global.InteractionPolicy = api;
})(window);
