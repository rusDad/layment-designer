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

        function renderLaymentSettings(state = null) {
            const settings = state || editorFacade.queries.laymentSettings?.();
            if (!settings) {
                return;
            }

            if (uiDom.inputs?.laymentPreset) {
                uiDom.inputs.laymentPreset.value = settings.preset;
            }
            if (uiDom.inputs?.laymentWidth) {
                uiDom.inputs.laymentWidth.value = String(settings.width);
            }
            if (uiDom.inputs?.laymentHeight) {
                uiDom.inputs.laymentHeight.value = String(settings.height);
            }
            if (uiDom.inputs?.baseMaterialColor) {
                uiDom.inputs.baseMaterialColor.value = settings.baseMaterialColor;
            }
            if (uiDom.inputs?.laymentThicknessMm) {
                uiDom.inputs.laymentThicknessMm.value = String(settings.laymentThicknessMm);
            }
        }

        function renderPrimitiveInspector() {
            const state = editorFacade.queries.primitiveInspectorState?.() || { mode: 'empty', primitive: null, limits: {} };
            const controls = uiDom.panels?.primitiveControls;
            const widthInput = uiDom.inputs?.primitiveWidth;
            const heightInput = uiDom.inputs?.primitiveHeight;
            const radiusInput = uiDom.inputs?.primitiveRadius;
            const typeLabel = uiDom.primitive?.typeLabel;
            const widthRow = uiDom.primitive?.widthRow;
            const heightRow = uiDom.primitive?.heightRow;
            const radiusRow = uiDom.primitive?.radiusRow;
            const typeRow = typeLabel?.parentElement;

            const isRect = state.mode === 'rect' && state.primitive?.type === 'rect';
            const isCircle = state.mode === 'circle' && state.primitive?.type === 'circle';
            const enabled = isRect || isCircle;

            if (controls) {
                controls.setAttribute('aria-disabled', enabled ? 'false' : 'true');
            }
            if (typeRow) {
                typeRow.style.display = 'none';
            }
            if (typeLabel) {
                typeLabel.textContent = '—';
            }

            if (widthRow) widthRow.style.display = isRect ? 'block' : 'none';
            if (heightRow) heightRow.style.display = isRect ? 'block' : 'none';
            if (radiusRow) radiusRow.style.display = isCircle ? 'block' : 'none';

            if (widthInput) {
                widthInput.disabled = !isRect;
                widthInput.value = isRect ? String(state.primitive.width) : '';
                widthInput.min = String(state.limits?.rect?.minWidth ?? Config.GEOMETRY.PRIMITIVES.RECT.MIN_WIDTH);
                widthInput.max = String(state.limits?.rect?.maxWidth ?? Config.GEOMETRY.PRIMITIVES.RECT.MAX_WIDTH);
            }
            if (heightInput) {
                heightInput.disabled = !isRect;
                heightInput.value = isRect ? String(state.primitive.height) : '';
                heightInput.min = String(state.limits?.rect?.minHeight ?? Config.GEOMETRY.PRIMITIVES.RECT.MIN_HEIGHT);
                heightInput.max = String(state.limits?.rect?.maxHeight ?? Config.GEOMETRY.PRIMITIVES.RECT.MAX_HEIGHT);
            }
            if (radiusInput) {
                radiusInput.disabled = !isCircle;
                radiusInput.value = isCircle ? String(state.primitive.radius) : '';
                radiusInput.min = String(state.limits?.circle?.minRadius ?? Config.GEOMETRY.PRIMITIVES.CIRCLE.MIN_RADIUS);
                radiusInput.max = String(state.limits?.circle?.maxRadius ?? Config.GEOMETRY.PRIMITIVES.CIRCLE.MAX_RADIUS);
            }
        }

        function renderTextInspector() {
            const state = editorFacade.queries.textInspectorState?.() || { mode: 'hidden', selectedText: null, targetContour: null, capabilities: {} };
            const panel = uiDom.texts?.panel;
            const list = uiDom.texts?.list;
            const selectedText = state.selectedText || null;
            const capabilities = state.capabilities || {};

            if (panel) {
                const visible = state.mode === 'context';
                panel.hidden = !visible;
                panel.setAttribute('aria-disabled', visible ? 'false' : 'true');
            }

            if (list) {
                list.innerHTML = '';
                list.disabled = true;
                list.hidden = true;
            }

            if (uiDom.texts?.value) {
                uiDom.texts.value.value = selectedText?.text || '';
                uiDom.texts.value.disabled = capabilities.canEditValue !== true;
            }
            if (uiDom.texts?.fontSize) {
                uiDom.texts.fontSize.value = selectedText?.fontSize != null ? String(selectedText.fontSize) : '';
                uiDom.texts.fontSize.disabled = capabilities.canEditFontSize !== true;
            }
            if (uiDom.texts?.angle) {
                uiDom.texts.angle.value = selectedText ? String(selectedText.angle ?? 0) : '';
                uiDom.texts.angle.disabled = capabilities.canEditAngle !== true;
            }
            if (uiDom.texts?.kind) {
                uiDom.texts.kind.textContent = selectedText?.kind || '—';
            }
            if (uiDom.texts?.role) {
                uiDom.texts.role.textContent = selectedText?.role || '—';
            }
            if (uiDom.texts?.owner) {
                const ownerPlacementId = selectedText?.ownerPlacementId ?? state.targetContour?.placementId;
                uiDom.texts.owner.textContent = Number.isFinite(ownerPlacementId) ? String(ownerPlacementId) : '—';
            }

            if (uiDom.texts?.addFreeBtn) uiDom.texts.addFreeBtn.disabled = capabilities.canAddFree !== true;
            if (uiDom.texts?.addAttachedBtn) uiDom.texts.addAttachedBtn.disabled = capabilities.canAddAttached !== true;
            if (uiDom.texts?.attachBtn) uiDom.texts.attachBtn.disabled = capabilities.canAttach !== true;
            if (uiDom.texts?.detachBtn) uiDom.texts.detachBtn.disabled = capabilities.canDetach !== true;
            if (uiDom.texts?.deleteBtn) uiDom.texts.deleteBtn.disabled = capabilities.canDelete !== true;
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
                const width = clampLaymentSize(event.target.value, Config.LAYMENT_DEFAULT_WIDTH);
                const settings = editorFacade.queries.laymentSettings?.();
                const height = settings?.height || Config.LAYMENT_DEFAULT_HEIGHT;
                editorFacade.commands.updateLaymentSize({ width, height });
            });

            uiDom.inputs.laymentHeight?.addEventListener('change', event => {
                const height = clampLaymentSize(event.target.value, Config.LAYMENT_DEFAULT_HEIGHT);
                const settings = editorFacade.queries.laymentSettings?.();
                const width = settings?.width || Config.LAYMENT_DEFAULT_WIDTH;
                editorFacade.commands.updateLaymentSize({ width, height });
            });

            uiDom.inputs.baseMaterialColor?.addEventListener('change', event => {
                editorFacade.commands.setBaseMaterialColor(event.target.value);
            });

            uiDom.inputs.laymentThicknessMm?.addEventListener('change', event => {
                editorFacade.commands.setLaymentThickness(event.target.value);
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
                renderLaymentSettings();
                renderPrimitiveInspector();
                renderTextInspector();
            });
            applyControlsState(editorFacade.queries.controlsState?.());
            renderLaymentSettings();
            renderPrimitiveInspector();
            renderTextInspector();
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
            renderLaymentSettings,
            renderPrimitiveInspector,
            renderTextInspector,
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
