(function () {
    const stateLabels = {
        created: 'Создан',
        confirmed: 'Подтверждён',
        produced: 'Изготовлен',
    };

    const stateTone = {
        created: 'info',
        confirmed: 'success',
        produced: 'success',
    };

    const APP_BASE_PREFIX = window.location.pathname.startsWith('/dev/') ? '/dev' : '';
    const PUBLIC_API_BASE = `${APP_BASE_PREFIX}/api`;

    function withAppPrefix(url) {
        if (!url) {
            return url;
        }

        if (/^https?:\/\//i.test(url)) {
            return url;
        }

        if (!APP_BASE_PREFIX) {
            return url;
        }

        if (url.startsWith(`${APP_BASE_PREFIX}/`)) {
            return url;
        }

        if (url.startsWith('/')) {
            return `${APP_BASE_PREFIX}${url}`;
        }

        return url;
    }

    const orderIdInput = document.getElementById('orderIdInput');
    const checkOrderButton = document.getElementById('checkOrderButton');

    const statusResult = document.getElementById('statusResult');
    const statusTitle = document.getElementById('statusResultTitle');
    const statusMessage = document.getElementById('statusMessage');
    const statusDetails = document.getElementById('statusDetails');

    const statusOrderNumber = document.getElementById('statusOrderNumber');
    const statusOrderId = document.getElementById('statusOrderId');
    const statusState = document.getElementById('statusState');
    const statusCustomerName = document.getElementById('statusCustomerName');
    const statusBaseMaterialColor = document.getElementById('statusBaseMaterialColor');
    const statusLaymentThickness = document.getElementById('statusLaymentThickness');
    const statusPrice = document.getElementById('statusPrice');
    const statusCreatedAt = document.getElementById('statusCreatedAt');
    const statusConfirmedAt = document.getElementById('statusConfirmedAt');
    const statusProducedAt = document.getElementById('statusProducedAt');

    const statusPreviewBlock = document.getElementById('statusPreviewBlock');
    const statusPreviewImage = document.getElementById('statusPreviewImage');
    const statusContentsBlock = document.getElementById('statusContentsBlock');
    const statusContentsList = document.getElementById('statusContentsList');

    function setResultType(type) {
        statusResult.classList.remove('order-result-success', 'order-result-error', 'order-result-info', 'order-result-loading');

        if (type === 'success') {
            statusResult.classList.add('order-result-success');
        }

        if (type === 'error') {
            statusResult.classList.add('order-result-error');
        }

        if (type === 'loading') {
            statusResult.classList.add('order-result-loading');
        }

        if (type === 'info') {
            statusResult.classList.add('order-result-info');
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

        return `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()}, ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    }

    function showResult({ type, title, message, detailsVisible }) {
        setResultType(type);
        statusResult.hidden = false;
        statusTitle.textContent = title;
        statusMessage.textContent = message;
        statusDetails.hidden = !detailsVisible;
    }

    function showLoading(message = 'Проверяем статус заказа…') {
        showResult({
            type: 'loading',
            title: 'Загрузка данных',
            message,
            detailsVisible: false,
        });
    }

    function showError(message) {
        showResult({
            type: 'error',
            title: 'Не удалось получить статус заказа',
            message,
            detailsVisible: false,
        });
    }

    function renderPreview(order) {
        if (!order.previewPngUrl) {
            statusPreviewBlock.hidden = true;
            statusPreviewImage.removeAttribute('src');
            return;
        }

        const cacheBuster = encodeURIComponent(order.updatedAt || Date.now());
        const previewUrl = withAppPrefix(order.previewPngUrl);
        statusPreviewImage.src = `${previewUrl}?t=${cacheBuster}`;
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

    function humanizeColor(color) {
        if (!color) {
            return '—';
        }

        if (color === 'green') {
            return 'зелёный';
        }

        if (color === 'blue') {
            return 'синий';
        }

        return String(color) || '—';
    }


    function humanizeThickness(thickness) {
        if (thickness === 35 || thickness === 65) {
            return `${thickness} мм`;
        }

        return '—';
    }

    function showSuccess(order) {
        const state = order.state || 'created';
        const tone = stateTone[state] || 'info';
        const readableState = stateLabels[state] || state || '—';

        showResult({
            type: tone,
            title: `Статус заказа: ${readableState}`,
            message: 'Данные заказа успешно загружены.',
            detailsVisible: true,
        });

        statusOrderNumber.textContent = order.orderNumber || '—';
        statusOrderId.textContent = order.orderId || '—';
        statusState.textContent = readableState;
        statusCustomerName.textContent = order.customer?.name || '—';
        statusBaseMaterialColor.textContent = humanizeColor(order.baseMaterialColor);
        statusLaymentThickness.textContent = humanizeThickness(order.laymentThicknessMm);
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
            showError('Укажите Order ID, чтобы проверить текущий статус заказа.');
            return;
        }

        checkOrderButton.disabled = true;
        showLoading();

        try {
            const response = await fetch(`${PUBLIC_API_BASE}/orders/${encodeURIComponent(trimmedOrderId)}`);
            if (!response.ok) {
                if (response.status === 404) {
                    showError('Заказ не найден. Проверьте корректность Order ID и попробуйте снова.');
                    return;
                }

                const errorText = await response.text();
                showError(`Сервис статусов временно недоступен. ${errorText || `HTTP ${response.status}`}`);
                return;
            }

            const order = await response.json();
            showSuccess(order);
        } catch (error) {
            showError(`Не удалось выполнить запрос. Проверьте подключение и попробуйте ещё раз. ${error.message || ''}`);
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
    } else {
        showResult({
            type: 'info',
            title: 'Статус заказа',
            message: 'Введите Order ID, чтобы посмотреть текущий этап выполнения заказа.',
            detailsVisible: false,
        });
    }
})();
