(function initOrderFlowShell(global) {
    function createOrderFlowShell({ editorFacade, uiDom, feedback }) {
        const modal = uiDom?.customerModal;
        let exportInProgress = false;
        const exportButtonDefaultText = uiDom?.buttons?.export?.textContent || 'Создать заказ';
        const exportCooldownMs = 5000;
        const previewPayloadMaxAgeMs = 1000 * 60 * 30;

        function generatePreviewPayloadKey() {
            const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            return `${Config.VIEWER_3D.PAYLOAD_PREFIX}${rand}`;
        }

        function cleanupOldPreviewPayloads() {
            const prefix = Config.VIEWER_3D.PAYLOAD_PREFIX;
            const now = Date.now();

            for (let i = localStorage.length - 1; i >= 0; i -= 1) {
                const key = localStorage.key(i);
                if (!key || !key.startsWith(prefix)) {
                    continue;
                }

                try {
                    const raw = localStorage.getItem(key);
                    if (!raw) {
                        localStorage.removeItem(key);
                        continue;
                    }
                    const payload = JSON.parse(raw);
                    const createdAt = Number(payload?.createdAt || 0);
                    if (!Number.isFinite(createdAt) || (now - createdAt) > previewPayloadMaxAgeMs) {
                        localStorage.removeItem(key);
                    }
                } catch (_error) {
                    localStorage.removeItem(key);
                }
            }
        }

        function openViewer(payload) {
            if (!payload || typeof payload.svg !== 'string' || !payload.svg) {
                throw new Error('Preview payload is empty');
            }

            cleanupOldPreviewPayloads();

            const payloadKey = generatePreviewPayloadKey();
            const storedPayload = {
                ...payload,
                createdAt: Date.now()
            };
            localStorage.setItem(payloadKey, JSON.stringify(storedPayload));

            const viewerUrl = new URL(Config.VIEWER_3D.URL, window.location.origin);
            viewerUrl.searchParams.set('payloadKey', payloadKey);
            window.open(viewerUrl.toString(), '_blank', 'noopener');
        }

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

        async function submitOrderRequest(payload) {
            const response = await fetch(Config.API.BASE_URL + Config.API.EXPORT_Layment, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Не удалось создать заказ.');
            }

            return response.json();
        }

        function mapOrderResult({ payload, transportResult }) {
            const orderId = transportResult?.orderId || '—';
            const orderNumber = transportResult?.orderNumber || '—';
            const statusUrl = orderId !== '—'
                ? `status.html?orderId=${encodeURIComponent(orderId)}`
                : null;

            return {
                orderId,
                orderNumber,
                paymentUrl: statusUrl,
                width: payload?.orderMeta?.width,
                height: payload?.orderMeta?.height,
                laymentThicknessMm: transportResult?.pricePreview?.laymentThicknessMm ?? payload?.orderMeta?.laymentThicknessMm ?? 35,
                total: transportResult?.pricePreview?.total ?? '—'
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
                const request = await editorFacade.commands.buildOrderRequest(customer);
                if (!request?.ok || !request.payload) {
                    feedback.showError(request?.message || 'Не удалось подготовить заказ.');
                    return;
                }

                const transportResult = await submitOrderRequest(request.payload);
                const mappedResult = mapOrderResult({ payload: request.payload, transportResult });
                feedback.showSuccess(mappedResult);
            } catch (error) {
                console.error(error);
                feedback.showError(
                    'Не получилось оформить заказ. Проверьте данные и попробуйте снова. ' + (error?.message || '')
                );
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
            uiDom.buttons.preview3d.onclick = () => {
                const payload = editorFacade.commands.get3dPreviewPayload();
                if (!payload) {
                    return;
                }

                try {
                    openViewer(payload);
                } catch (error) {
                    console.error(error);
                    feedback.showError(
                        'Не удалось подготовить данные для 3D предпросмотра (localStorage недоступен или переполнен).',
                        '3D предпросмотр недоступен'
                    );
                }
            };
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
