(function () {
    const stateLabels = {
        created: 'Создан',
        confirmed: 'Подтверждён',
        produced: 'Изготовлен',
    };

    const orderIdInput = document.getElementById('orderIdInput');
    const checkOrderButton = document.getElementById('checkOrderButton');

    const statusResult = document.getElementById('statusResult');
    const statusMessage = document.getElementById('statusMessage');
    const statusDetails = document.getElementById('statusDetails');

    const statusOrderNumber = document.getElementById('statusOrderNumber');
    const statusOrderId = document.getElementById('statusOrderId');
    const statusState = document.getElementById('statusState');
    const statusPrice = document.getElementById('statusPrice');
    const statusCreatedAt = document.getElementById('statusCreatedAt');
    const statusConfirmedAt = document.getElementById('statusConfirmedAt');
    const statusProducedAt = document.getElementById('statusProducedAt');

    const statusPreviewBlock = document.getElementById('statusPreviewBlock');
    const statusPreviewImage = document.getElementById('statusPreviewImage');
    const statusContentsBlock = document.getElementById('statusContentsBlock');
    const statusContentsList = document.getElementById('statusContentsList');

    function setResultType(type) {
        statusResult.classList.remove('order-result-success', 'order-result-error');
        if (type === 'success') {
            statusResult.classList.add('order-result-success');
        }
        if (type === 'error') {
            statusResult.classList.add('order-result-error');
        }
    }

    function pad2(value) {
        return String(value).padStart(2, '0');
    }

    function formatDateTime(value) {
        if (!value) {
            return '—';
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return '—';
        }

        return `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()} , ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    }

    function showError(message) {
        setResultType('error');
        statusResult.hidden = false;
        statusDetails.hidden = true;
        statusMessage.textContent = message;
    }

    function renderPreview(order) {
        if (!order.previewPngUrl) {
            statusPreviewBlock.hidden = true;
            statusPreviewImage.removeAttribute('src');
            return;
        }

        const cacheBuster = encodeURIComponent(order.updatedAt || Date.now());
        statusPreviewImage.src = `${order.previewPngUrl}?t=${cacheBuster}`;
        statusPreviewBlock.hidden = false;
    }

    function renderContents(order) {
        while (statusContentsList.firstChild) {
            statusContentsList.removeChild(statusContentsList.firstChild);
        }

        if (!Array.isArray(order.contents) || order.contents.length === 0) {
            statusContentsBlock.hidden = true;
            return;
        }

        order.contents.forEach(function (item) {
            const row = document.createElement('div');
            const article = item && item.article ? String(item.article) : '—';
            const name = item && item.name ? String(item.name) : '—';
            row.textContent = `${article} — ${name}`;
            statusContentsList.appendChild(row);
        });

        statusContentsBlock.hidden = false;
    }

    function showSuccess(order) {
        setResultType('success');
        statusResult.hidden = false;
        statusDetails.hidden = false;
        statusMessage.textContent = 'Статус заказа получен';

        statusOrderNumber.textContent = order.orderNumber || '—';
        statusOrderId.textContent = order.orderId || '—';
        statusState.textContent = stateLabels[order.state] || order.state || '—';
        statusPrice.textContent = order.price && order.price.total != null ? String(order.price.total) : '—';
        statusCreatedAt.textContent = formatDateTime(order.createdAt);
        statusConfirmedAt.textContent = formatDateTime(order.confirmedAt);
        statusProducedAt.textContent = formatDateTime(order.producedAt);

        renderPreview(order);
        renderContents(order);
    }

    async function fetchOrderStatus(orderId) {
        const trimmedOrderId = orderId.trim();
        if (!trimmedOrderId) {
            showError('Введите order_id');
            return;
        }

        checkOrderButton.disabled = true;
        statusResult.hidden = true;

        try {
            const response = await fetch(`/api/orders/${encodeURIComponent(trimmedOrderId)}`);
            if (!response.ok) {
                if (response.status === 404) {
                    showError('Заказ не найден');
                    return;
                }

                const errorText = await response.text();
                showError(`Ошибка запроса: ${errorText || `HTTP ${response.status}`}`);
                return;
            }

            const order = await response.json();
            showSuccess(order);
        } catch (error) {
            showError(`Ошибка запроса: ${error.message}`);
        } finally {
            checkOrderButton.disabled = false;
        }
    }

    checkOrderButton.addEventListener('click', function () {
        fetchOrderStatus(orderIdInput.value);
    });

    orderIdInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            fetchOrderStatus(orderIdInput.value);
        }
    });

    const params = new URLSearchParams(window.location.search);
    const orderIdFromQuery = params.get('orderId');
    if (orderIdFromQuery) {
        orderIdInput.value = orderIdFromQuery;
        fetchOrderStatus(orderIdFromQuery);
    }
})();
