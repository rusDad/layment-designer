(function initUiFeedback(global) {
    function createUiFeedback(uiDom = global.UIDom) {
        const orderResult = uiDom?.orderResult;

        function withContainer(callback) {
            if (!orderResult?.container) {
                return;
            }
            callback(orderResult);
        }

        return {
            clear() {
                withContainer(result => {
                    result.container.hidden = true;
                    result.container.classList.remove('order-result-success', 'order-result-error', 'order-result-info', 'order-result-loading');
                    result.title.textContent = '';
                    result.message.textContent = '';
                    result.details.hidden = true;
                    result.orderNumber.textContent = '—';
                    result.orderId.textContent = '—';
                    result.statusLinkRow.hidden = true;
                    result.paymentLink.textContent = 'Перейти к странице статуса';
                    result.paymentLink.href = '#';
                    result.meta.hidden = true;
                    result.meta.textContent = '';
                });
            },

            showInfo(message, title = Config.MESSAGES.VIEWPORT_OUT_OF_BOUNDS_TITLE) {
                withContainer(result => {
                    result.container.hidden = false;
                    result.container.classList.remove('order-result-success', 'order-result-error', 'order-result-loading');
                    result.container.classList.add('order-result-info');
                    result.title.textContent = title;
                    result.message.textContent = message;
                    result.details.hidden = true;
                });
            },

            showLoading(message = 'Создаём заказ. Это может занять несколько секунд.') {
                withContainer(result => {
                    result.container.hidden = false;
                    result.container.classList.remove('order-result-success', 'order-result-error', 'order-result-info');
                    result.container.classList.add('order-result-loading');
                    result.title.textContent = 'Оформление заказа';
                    result.message.textContent = message;
                    result.details.hidden = true;
                });
            },

            showSuccess({ orderId, orderNumber, paymentUrl, width, height, laymentThicknessMm, total }) {
                withContainer(result => {
                    result.container.hidden = false;
                    result.container.classList.remove('order-result-error', 'order-result-info', 'order-result-loading');
                    result.container.classList.add('order-result-success');
                    result.title.textContent = 'Заказ создан';
                    result.message.textContent = 'Мы приняли заказ в обработку. Вы можете отслеживать статус по ссылке ниже.';
                    result.details.hidden = false;
                    result.orderNumber.textContent = orderNumber || '—';
                    result.orderId.textContent = orderId || '—';
                    result.paymentLink.href = paymentUrl || '#';
                    result.statusLinkRow.hidden = !paymentUrl;
                    result.meta.hidden = false;
                    result.meta.textContent = `Размер: ${width}×${height}×${laymentThicknessMm ?? 35} мм • Стоимость: ${total} ₽`;
                });
            },

            showError(message, title = 'Не удалось создать заказ') {
                withContainer(result => {
                    result.container.hidden = false;
                    result.container.classList.remove('order-result-success', 'order-result-info', 'order-result-loading');
                    result.container.classList.add('order-result-error');
                    result.title.textContent = title;
                    result.message.textContent = message;
                    result.details.hidden = true;
                });
            }
        };
    }

    global.DesignerUiFeedback = { create: createUiFeedback };
})(window);
