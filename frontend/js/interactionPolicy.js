// interactionPolicy.js
// Централизованные правила интеракций. На первом шаге — консервативные дефолты.

(function initInteractionPolicyModule(global) {
    function getObjectMeta(obj) {
        const objectMetaApi = global.ObjectMeta || null;
        return objectMetaApi?.getObjectMeta?.(obj) || null;
    }

    function getGroupId(obj) {
        const objectMetaApi = global.ObjectMeta || null;
        return objectMetaApi?.getGroupId?.(obj) || null;
    }

    function getSelectionMode(obj) {
        const meta = getObjectMeta(obj);
        const objectMetaApi = global.ObjectMeta || null;
        if (objectMetaApi?.normalizeSelectionMode) {
            return objectMetaApi.normalizeSelectionMode(meta?.selectionMode);
        }
        return meta?.selectionMode === 'clickOnly'
            ? 'clickOnly'
            : (meta?.selectionMode === 'default' ? 'normal' : (meta?.selectionMode || 'normal'));
    }

    function isSemanticallyLocked(obj) {
        const meta = getObjectMeta(obj);
        if (!meta) {
            return false;
        }
        return meta.isLocked === true
            || meta.locked === true
            || meta.interactive === false
            || getSelectionMode(obj) === 'readonly';
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
        if (!canSelect(ctx, obj)) {
            return false;
        }
        return getSelectionMode(obj) !== 'clickOnly';
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
        if (!obj || isProtectedObject(ctx, obj) || obj.isTextObject || isSemanticallyLocked(obj)) {
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
        if (!canSelect(ctx, obj) || isSemanticallyLocked(obj) || obj?.isTextObject) {
            return false;
        }
        return true;
    }

    function expandTargetsWithSoftGroups(ctx, targets, predicate = null) {
        const list = Array.isArray(targets) ? targets.filter(Boolean) : [];
        const expanded = [];
        const seen = new Set();
        const addObject = (obj) => {
            if (!obj || seen.has(obj)) {
                return;
            }
            if (typeof predicate === 'function' && predicate(obj) === false) {
                return;
            }
            seen.add(obj);
            expanded.push(obj);
        };

        list.forEach(obj => {
            addObject(obj);
            const groupId = getGroupId(obj);
            if (!groupId || !ctx?.getSoftGroupMembers) {
                return;
            }
            ctx.getSoftGroupMembers(groupId).forEach(member => addObject(member));
        });

        return expanded;
    }

    function canGroupMoveSelection(ctx, targets) {
        const selection = Array.isArray(targets) ? targets.filter(Boolean) : [];
        if (!selection.length) {
            return false;
        }
        if (selection.some(obj => !canMove(ctx, obj))) {
            return false;
        }

        const expanded = expandTargetsWithSoftGroups(ctx, selection);
        if (!expanded.length) {
            return false;
        }

        return expanded.every(obj => canMove(ctx, obj));
    }

    function canToggleLock(ctx, obj) {
        if (!obj || isProtectedObject(ctx, obj)) {
            return false;
        }
        return true;
    }

    function getLockSelectionObjects(ctx, targets) {
        const list = Array.isArray(targets) ? targets : [];
        return list.filter(obj => canToggleLock(ctx, obj));
    }

    function getSelectionLockState(ctx, targets) {
        const objects = getLockSelectionObjects(ctx, targets);
        if (!objects.length) {
            return {
                anyLocked: false,
                allLocked: false,
                lockableCount: 0
            };
        }

        const anyLocked = objects.some(obj => isSemanticallyLocked(obj));
        return {
            anyLocked,
            allLocked: anyLocked && objects.every(obj => isSemanticallyLocked(obj)),
            lockableCount: objects.length
        };
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

        if (actionName === 'move') {
            return expandTargetsWithSoftGroups(ctx, targets, obj => canMove(ctx, obj));
        }

        if (actionName === 'rotate') {
            return targets.filter(obj => canRotate(ctx, obj));
        }

        if (actionName === 'toggleLock') {
            return getLockSelectionObjects(ctx, targets);
        }

        return targets;
    }

    const api = {
        getObjectMeta,
        getSelectionMode,
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
        getGroupId,
        expandTargetsWithSoftGroups,
        canJoinGroup,
        canGroupMoveSelection,
        canToggleLock,
        shouldFollowOwnerMove,
        getArrangeSelectionObjects,
        getDuplicateSelectionObjects,
        getLockSelectionObjects,
        getSelectionLockState,
        resolveActionTargets
    };

    global.InteractionPolicy = api;
})(window);
