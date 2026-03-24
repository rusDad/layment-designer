(function initControlsShell(global) {
    const STATUS_BAR_REFRESH_EVENT = 'designer:status-bar-refresh';
    const CONTROLS_STATE_REFRESH_EVENT = 'designer:controls-state-refresh';

    function clampLaymentSize(value, fallback) {
        let next = parseInt(value, 10) || fallback;
        if (next < Config.LAYMENT_MIN_SIZE) {
            next = Config.LAYMENT_MIN_SIZE;
        }
        return next;
    }

    function clearNode(node) {
        while (node?.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    function appendStatusStrongPrefix(node, text) {
        const strong = document.createElement('strong');
        strong.textContent = text;
        node.append(strong);
    }

    function appendStatusText(node, text) {
        node.append(document.createTextNode(text));
    }

    function createControlsShell({ editorFacade, workspaceShell, uiDom, feedback }) {
        function applyControlsState(state) {
            const controlsState = state || editorFacade.queries.controlsState?.() || {};
            const buttons = uiDom.buttons || {};
            const lockLabel = controlsState.lockButtonLabel || 'Заблокировать';
            const lockHint = controlsState.lockButtonHint || 'Заблокировать выделенное от случайных изменений';
            const lockPressed = controlsState.lockButtonPressed === true;

            if (buttons.delete) buttons.delete.disabled = !controlsState.canDelete;
            if (buttons.rotate) buttons.rotate.disabled = !controlsState.canRotate;
            if (buttons.duplicate) buttons.duplicate.disabled = !controlsState.canDuplicate;
            if (buttons.toggleLock) {
                buttons.toggleLock.disabled = !controlsState.canToggleLock;
                buttons.toggleLock.textContent = lockLabel;
                buttons.toggleLock.dataset.hint = lockHint;
                buttons.toggleLock.title = lockLabel;
                buttons.toggleLock.setAttribute('aria-pressed', lockPressed ? 'true' : 'false');
            }

            if (buttons.group) {
                buttons.group.disabled = !controlsState.canGroup;
                buttons.group.dataset.hint = 'Сгруппировать выделенные незаблокированные элементы';
                buttons.group.title = 'Сгруппировать';
            }
            if (buttons.ungroup) {
                buttons.ungroup.disabled = !controlsState.canUngroup;
                buttons.ungroup.dataset.hint = 'Разгруппировать выделенные элементы';
                buttons.ungroup.title = 'Разгруппировать';
            }

            const alignDisabled = !controlsState.canAlign;
            if (buttons.alignLeft) buttons.alignLeft.disabled = alignDisabled;
            if (buttons.alignCenterX) buttons.alignCenterX.disabled = alignDisabled;
            if (buttons.alignRight) buttons.alignRight.disabled = alignDisabled;
            if (buttons.alignTop) buttons.alignTop.disabled = alignDisabled;
            if (buttons.alignCenterY) buttons.alignCenterY.disabled = alignDisabled;
            if (buttons.alignBottom) buttons.alignBottom.disabled = alignDisabled;

            const distributeDisabled = !controlsState.canDistribute;
            if (buttons.distributeHorizontalGaps) buttons.distributeHorizontalGaps.disabled = distributeDisabled;
            if (buttons.distributeVerticalGaps) buttons.distributeVerticalGaps.disabled = distributeDisabled;

            const snapDisabled = !controlsState.canSnap;
            if (buttons.snapLeft) buttons.snapLeft.disabled = snapDisabled;
            if (buttons.snapRight) buttons.snapRight.disabled = snapDisabled;
            if (buttons.snapTop) buttons.snapTop.disabled = snapDisabled;
            if (buttons.snapBottom) buttons.snapBottom.disabled = snapDisabled;
        }

        function renderStatusBar() {
            const statusInfo = uiDom.status?.info;
            if (!statusInfo) {
                return;
            }

            const state = editorFacade.queries.statusBar?.();
            clearNode(statusInfo);

            if (!state || state.mode === 'empty' || state.mode === 'message' || state.mode === 'selection') {
                statusInfo.textContent = state?.message || 'Выберите контур или выемку';
                return;
            }

            if (state.mode === 'contour' && state.contour) {
                appendStatusStrongPrefix(statusInfo, state.contour.name || '—');
                appendStatusText(statusInfo, ` арт. ${state.contour.article || '—'} · X ${state.contour.x} мм · Y ${state.contour.y} мм · ${state.contour.angle}°`);
                if (state.contour.outOfBounds) {
                    appendStatusText(statusInfo, ' · вне границ ложемента');
                }
                return;
            }

            if (state.mode === 'primitive' && state.primitive) {
                const primitive = state.primitive;
                if (primitive.type === 'rect') {
                    appendStatusStrongPrefix(statusInfo, 'Выемка · прямоугольная');
                    appendStatusText(statusInfo, ` X ${primitive.x} мм · Y ${primitive.y} мм · W ${primitive.width} мм · H ${primitive.height} мм`);
                } else {
                    appendStatusStrongPrefix(statusInfo, 'Выемка · круглая');
                    appendStatusText(statusInfo, ` X ${primitive.x} мм · Y ${primitive.y} мм · R ${primitive.radius} мм`);
                }
                if (primitive.outOfBounds) {
                    appendStatusText(statusInfo, ' · вне границ ложемента');
                }
                return;
            }

            statusInfo.textContent = 'Выберите контур или выемку';
        }

        async function bindToolbarActions() {
            uiDom.buttons.delete.onclick = () => editorFacade.commands.deleteSelection();
            uiDom.buttons.rotate.onclick = () => editorFacade.commands.rotateSelection();
            uiDom.buttons.duplicate.onclick = () => editorFacade.commands.duplicateSelection();
            uiDom.buttons.toggleLock.onclick = () => editorFacade.commands.toggleLockSelection();
            uiDom.buttons.group && (uiDom.buttons.group.onclick = () => editorFacade.commands.groupSelection());
            uiDom.buttons.ungroup && (uiDom.buttons.ungroup.onclick = () => editorFacade.commands.ungroupSelection());

            uiDom.buttons.saveWorkspace.onclick = async () => {
                try {
                    await workspaceShell.saveWorkspaceToStorage('manual');
                } catch (error) {
                    console.error('Ошибка сохранения workspace', error);
                }
            };
            uiDom.buttons.loadWorkspace.onclick = async () => {
                try {
                    await workspaceShell.restoreAutosave();
                } catch (error) {
                    console.error('Ошибка загрузки workspace', error);
                }
            };

            uiDom.buttons.check.onclick = async () => {
                const validation = await editorFacade.commands.validateLayout();
                if (validation.ok) {
                    feedback.showInfo(validation.message, 'Проверка раскладки');
                    return;
                }
                feedback.showError(validation.message, 'Проверка раскладки');
            };

            uiDom.buttons.addRect?.addEventListener('click', () => editorFacade.commands.addPrimitive({ type: 'rect' }));
            uiDom.buttons.addCircle?.addEventListener('click', () => editorFacade.commands.addPrimitive({ type: 'circle' }));

            uiDom.buttons.alignLeft.onclick = () => editorFacade.commands.alignSelection('left');
            uiDom.buttons.alignCenterX.onclick = () => editorFacade.commands.alignSelection('center-x');
            uiDom.buttons.alignRight.onclick = () => editorFacade.commands.alignSelection('right');
            uiDom.buttons.alignTop.onclick = () => editorFacade.commands.alignSelection('top');
            uiDom.buttons.alignCenterY.onclick = () => editorFacade.commands.alignSelection('center-y');
            uiDom.buttons.alignBottom.onclick = () => editorFacade.commands.alignSelection('bottom');
            uiDom.buttons.distributeHorizontalGaps.onclick = () => editorFacade.commands.distributeSelection('horizontal-gaps');
            uiDom.buttons.distributeVerticalGaps.onclick = () => editorFacade.commands.distributeSelection('vertical-gaps');
            uiDom.buttons.snapLeft.onclick = () => editorFacade.commands.snapSelection('left');
            uiDom.buttons.snapRight.onclick = () => editorFacade.commands.snapSelection('right');
            uiDom.buttons.snapTop.onclick = () => editorFacade.commands.snapSelection('top');
            uiDom.buttons.snapBottom.onclick = () => editorFacade.commands.snapSelection('bottom');
        }

        function bindInputActions() {
            uiDom.inputs.laymentPreset?.addEventListener('change', event => {
                editorFacade.commands.applyLaymentPreset(event.target.value);
            });

            uiDom.inputs.laymentWidth?.addEventListener('change', event => {
                const doc = editorFacade.queries.document();
                const width = clampLaymentSize(event.target.value, Config.LAYMENT_DEFAULT_WIDTH);
                event.target.value = String(width);
                uiDom.inputs.laymentPreset.value = 'CUSTOM';
                editorFacade.commands.updateLaymentSize({ width, height: doc.height || Config.LAYMENT_DEFAULT_HEIGHT });
            });

            uiDom.inputs.laymentHeight?.addEventListener('change', event => {
                const doc = editorFacade.queries.document();
                const height = clampLaymentSize(event.target.value, Config.LAYMENT_DEFAULT_HEIGHT);
                event.target.value = String(height);
                uiDom.inputs.laymentPreset.value = 'CUSTOM';
                editorFacade.commands.updateLaymentSize({ width: doc.width || Config.LAYMENT_DEFAULT_WIDTH, height });
            });

            uiDom.inputs.baseMaterialColor?.addEventListener('change', event => {
                const applied = editorFacade.commands.setBaseMaterialColor(event.target.value);
                if (!applied) {
                    event.target.value = editorFacade.queries.document().baseMaterialColor;
                }
            });

            uiDom.inputs.laymentThicknessMm?.addEventListener('change', event => {
                const thickness = editorFacade.commands.setLaymentThickness(event.target.value);
                event.target.value = String(thickness);
            });

            uiDom.inputs.workspaceScale?.addEventListener('change', event => {
                const percent = parseFloat(event.target.value);
                const minPercent = Math.round(Config.WORKSPACE_SCALE.MIN * 100);
                const maxPercent = Math.round(Config.WORKSPACE_SCALE.MAX * 100);
                if (Number.isFinite(percent) && percent >= minPercent && percent <= maxPercent) {
                    editorFacade.commands.setWorkspaceScale(percent / 100);
                }
                event.target.value = String(Math.round((editorFacade.queries.document().workspaceScale || 1) * 100));
            });

            const applyPrimitiveDimensions = () => editorFacade.commands.updatePrimitiveDimensions({
                width: uiDom.inputs.primitiveWidth?.value,
                height: uiDom.inputs.primitiveHeight?.value,
                radius: uiDom.inputs.primitiveRadius?.value
            });
            uiDom.inputs.primitiveWidth?.addEventListener('change', applyPrimitiveDimensions);
            uiDom.inputs.primitiveHeight?.addEventListener('change', applyPrimitiveDimensions);
            uiDom.inputs.primitiveRadius?.addEventListener('change', applyPrimitiveDimensions);

            uiDom.texts.value?.addEventListener('input', event => editorFacade.commands.updateTextValue(event.target.value));
            uiDom.texts.fontSize?.addEventListener('change', event => editorFacade.commands.updateTextFontSize(event.target.value));
            uiDom.texts.angle?.addEventListener('change', event => editorFacade.commands.updateTextAngle(event.target.value));
            uiDom.texts.addFreeBtn?.addEventListener('click', () => editorFacade.commands.addFreeText({ text: uiDom.texts.value?.value || '' }));
            uiDom.texts.addAttachedBtn?.addEventListener('click', () => editorFacade.commands.addAttachedText({ text: uiDom.texts.value?.value || '' }));
            uiDom.texts.attachBtn?.addEventListener('click', () => editorFacade.commands.attachSelectedText());
            uiDom.texts.detachBtn?.addEventListener('click', () => editorFacade.commands.detachSelectedText());
            uiDom.texts.deleteBtn?.addEventListener('click', () => editorFacade.commands.deleteSelectedText());
        }

        function bindStatusHints() {
            const statusHint = uiDom.status?.hint;
            if (!statusHint) {
                return;
            }

            document.querySelectorAll('[data-hint]').forEach(element => {
                const showHint = () => {
                    statusHint.textContent = element.dataset.hint || '';
                };
                const clearHint = () => {
                    statusHint.textContent = '';
                };

                element.addEventListener('mouseenter', showHint);
                element.addEventListener('focus', showHint);
                element.addEventListener('mouseleave', clearHint);
                element.addEventListener('blur', clearHint);
            });
        }

        function bindStatusBar() {
            document.addEventListener(STATUS_BAR_REFRESH_EVENT, renderStatusBar);
            renderStatusBar();
        }

        function bindControlsState() {
            document.addEventListener(CONTROLS_STATE_REFRESH_EVENT, event => {
                applyControlsState(event.detail?.controlsState);
            });
            applyControlsState(editorFacade.queries.controlsState?.());
        }

        return {
            bind() {
                bindToolbarActions();
                bindInputActions();
                bindStatusHints();
                bindControlsState();
                bindStatusBar();
            },
            applyControlsState,
            refreshStatusBar: renderStatusBar,
            statusBarRefreshEventName: STATUS_BAR_REFRESH_EVENT,
            controlsStateRefreshEventName: CONTROLS_STATE_REFRESH_EVENT
        };
    }

    global.DesignerControlsShell = {
        create: createControlsShell,
        STATUS_BAR_REFRESH_EVENT,
        CONTROLS_STATE_REFRESH_EVENT
    };
})(window);
