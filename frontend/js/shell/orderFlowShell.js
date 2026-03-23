(function initOrderFlowShell(global) {
    function createOrderFlowShell({ editorFacade, uiDom, feedback }) {
        const modal = uiDom?.customerModal;
        let exportInProgress = false;
        const exportButtonDefaultText = uiDom?.buttons?.export?.textContent || 'Создать заказ';
        const exportCooldownMs = 5000;

        function renderSummary(summary) {
            if (!modal?.summaryMeta || !modal.summaryComposition || !modal.summaryEmpty) {
                return;
            }

            modal.summaryMeta.innerHTML = `
                <div><strong>Размер:</strong> ${summary.width} × ${summary.height} мм</div>
                <div><strong>Толщина:</strong> ${summary.thickness} мм</div>
                <div><strong>Цвет:</strong> ${summary.colorLabel}</div>
            `;

            modal.summaryComposition.innerHTML = '';
            if (!summary.composition?.length) {
                modal.summaryEmpty.hidden = false;
                return;
            }

            modal.summaryEmpty.hidden = true;
            summary.composition.forEach(item => {
                const li = document.createElement('li');
                li.textContent = `${item.article}${item.name ? ` — ${item.name}` : ''} × ${item.count}`;
                modal.summaryComposition.appendChild(li);
            });
        }

        function clearFeedback() {
            if (!modal?.feedback) {
                return;
            }
            modal.feedback.hidden = true;
            modal.feedback.textContent = '';
        }

        function setFeedback(message) {
            if (!modal?.feedback) {
                return;
            }
            modal.feedback.hidden = false;
            modal.feedback.textContent = message;
        }

        function getCustomer() {
            return {
                name: modal?.nameInput?.value || '',
                contact: modal?.contactInput?.value || ''
            };
        }

        function syncConfirmState() {
            const customer = getCustomer();
            const valid = Boolean(customer.name.trim()) && Boolean(customer.contact.trim());
            if (modal?.confirmButton) {
                modal.confirmButton.disabled = !valid || exportInProgress;
            }
            return valid;
        }

        function openModal() {
            if (!modal?.overlay) {
                return;
            }
            renderSummary(editorFacade.queries.orderSummary());
            clearFeedback();
            modal.overlay.hidden = false;
            syncConfirmState();
            modal.nameInput?.focus();
        }

        function closeModal() {
            if (!modal?.overlay) {
                return;
            }
            modal.overlay.hidden = true;
            clearFeedback();
        }

        async function submitOrder() {
            if (exportInProgress) {
                return;
            }
            const customer = getCustomer();
            if (!syncConfirmState()) {
                setFeedback('Заполните имя и контакт, чтобы создать заказ.');
                return;
            }

            closeModal();
            exportInProgress = true;
            const startedAt = Date.now();
            uiDom.buttons.export.disabled = true;
            uiDom.buttons.export.textContent = 'Создаём заказ…';
            feedback.showLoading();

            try {
                const result = await editorFacade.commands.submitOrder(customer);
                if (result?.ok) {
                    feedback.showSuccess(result);
                } else {
                    feedback.showError(result?.message || 'Не удалось создать заказ.');
                }
            } finally {
                const elapsed = Date.now() - startedAt;
                const waitMs = Math.max(0, exportCooldownMs - elapsed);
                if (waitMs > 0) {
                    await new Promise(resolve => setTimeout(resolve, waitMs));
                }
                exportInProgress = false;
                uiDom.buttons.export.disabled = false;
                uiDom.buttons.export.textContent = exportButtonDefaultText;
                syncConfirmState();
            }
        }

        function bindModalEvents() {
            if (!modal?.overlay) {
                return;
            }

            modal.nameInput?.addEventListener('input', () => {
                clearFeedback();
                syncConfirmState();
            });
            modal.contactInput?.addEventListener('input', () => {
                clearFeedback();
                syncConfirmState();
            });
            modal.cancelButton?.addEventListener('click', closeModal);
            modal.confirmButton?.addEventListener('click', submitOrder);
            modal.overlay.addEventListener('click', event => {
                if (event.target === modal.overlay) {
                    closeModal();
                }
            });

            const onEnter = event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    submitOrder();
                }
            };
            modal.nameInput?.addEventListener('keydown', onEnter);
            modal.contactInput?.addEventListener('keydown', onEnter);

            document.addEventListener('keydown', event => {
                if (event.key === 'Escape' && !modal.overlay.hidden) {
                    event.preventDefault();
                    closeModal();
                }
            });
        }

        function bind() {
            uiDom.buttons.preview3d.onclick = () => editorFacade.commands.open3dPreview();
            uiDom.buttons.export.onclick = openModal;
            bindModalEvents();
        }

        return {
            bind,
            openModal,
            closeModal
        };
    }

    global.DesignerOrderFlowShell = { create: createOrderFlowShell };
})(window);
