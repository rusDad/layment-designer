const ordersListEl = document.getElementById('ordersList');
const listStatusEl = document.getElementById('listStatus');
const reloadBtn = document.getElementById('reloadBtn');

const detailsEmptyEl = document.getElementById('detailsEmpty');
const detailsEl = document.getElementById('details');
const orderMetaEl = document.getElementById('orderMeta');
const contoursPreEl = document.getElementById('contoursPre');
const layoutWrapEl = document.getElementById('layoutWrap');
const statusEl = document.getElementById('status');

const confirmBtn = document.getElementById('confirmBtn');
const producedBtn = document.getElementById('producedBtn');
const downloadNcLink = document.getElementById('downloadNcLink');
const downloadSvgLink = document.getElementById('downloadSvgLink');

let ordersCache = [];
let selectedOrderId = null;
let selectedOrderDetails = null;

const fmt = (value) => {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString('ru-RU');
};

const createBadge = (label, active) => {
  const span = document.createElement('span');
  span.className = `badge${active ? ' ok' : ''}`;
  span.textContent = `${label}: ${active ? 'yes' : 'no'}`;
  return span;
};

const renderOrdersList = () => {
  ordersListEl.innerHTML = '';

  if (!ordersCache.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'Заказов пока нет.';
    ordersListEl.appendChild(empty);
    return;
  }

  ordersCache.forEach((order) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `order-card${order.orderId === selectedOrderId ? ' is-active' : ''}`;
    card.addEventListener('click', () => selectOrder(order.orderId));

    const title = document.createElement('div');
    title.className = 'order-title';
    title.textContent = order.orderId;

    const dim = document.createElement('div');
    dim.className = 'muted';
    dim.textContent = `Размер: ${order.width ?? '—'} x ${order.height ?? '—'} мм`;

    const created = document.createElement('div');
    created.className = 'muted';
    created.textContent = `Создан: ${fmt(order.createdAt)}`;

    const statusRow = document.createElement('div');
    statusRow.className = 'status-row';
    statusRow.appendChild(createBadge('confirmed', Boolean(order.confirmed)));
    statusRow.appendChild(createBadge('produced', Boolean(order.produced)));

    card.appendChild(title);
    card.appendChild(dim);
    card.appendChild(created);
    card.appendChild(statusRow);

    ordersListEl.appendChild(card);
  });
};

const updateMeta = (details) => {
  const status = details.status || {};
  const orderMeta = details.orderMeta || {};

  orderMetaEl.innerHTML = `
    <div><strong>ID:</strong> ${details.orderId}</div>
    <div><strong>Создан:</strong> ${fmt(status.createdAt)}</div>
    <div><strong>Confirmed:</strong> ${status.confirmed ? 'yes' : 'no'}${status.confirmedAt ? ` (${fmt(status.confirmedAt)})` : ''}</div>
    <div><strong>Produced:</strong> ${status.produced ? 'yes' : 'no'}${status.producedAt ? ` (${fmt(status.producedAt)})` : ''}</div>
    <div><strong>Размер:</strong> ${orderMeta.width ?? '—'} x ${orderMeta.height ?? '—'} мм</div>
  `;

  contoursPreEl.textContent = JSON.stringify(details.contours || [], null, 2);

  const files = details.files || {};
  downloadNcLink.href = files.finalNc || '#';

  if (files.layoutSvg) {
    downloadSvgLink.href = files.layoutSvg;
    downloadSvgLink.classList.remove('is-disabled');
    downloadSvgLink.removeAttribute('aria-disabled');
    downloadSvgLink.tabIndex = 0;
  } else {
    downloadSvgLink.href = '#';
    downloadSvgLink.classList.add('is-disabled');
    downloadSvgLink.setAttribute('aria-disabled', 'true');
    downloadSvgLink.tabIndex = -1;
  }

  layoutWrapEl.innerHTML = '';
  if (files.layoutPng) {
    const img = document.createElement('img');
    img.src = `${files.layoutPng}?t=${Date.now()}`;
    img.alt = `layout ${details.orderId}`;
    layoutWrapEl.appendChild(img);
  } else {
    const noImg = document.createElement('div');
    noImg.className = 'muted';
    noImg.textContent = 'layout.png отсутствует';
    layoutWrapEl.appendChild(noImg);
  }

  confirmBtn.disabled = Boolean(status.confirmed);
  producedBtn.disabled = Boolean(status.produced);
};

const loadOrders = async () => {
  listStatusEl.textContent = 'Загрузка…';
  statusEl.textContent = '';
  try {
    const res = await fetch('/admin/api/orders');
    const text = await res.text();
    if (!res.ok) {
      throw new Error(text || `HTTP ${res.status}`);
    }

    ordersCache = JSON.parse(text) || [];
    renderOrdersList();
    listStatusEl.textContent = `Найдено: ${ordersCache.length}`;

    if (selectedOrderId) {
      const exists = ordersCache.some((item) => item.orderId === selectedOrderId);
      if (exists) {
        await selectOrder(selectedOrderId, { skipListRerender: true });
      }
    }
  } catch (err) {
    listStatusEl.textContent = 'Ошибка загрузки заказов';
    statusEl.textContent = err.toString();
  }
};

const selectOrder = async (orderId, options = {}) => {
  selectedOrderId = orderId;
  if (!options.skipListRerender) {
    renderOrdersList();
  }

  detailsEmptyEl.hidden = true;
  detailsEl.hidden = false;
  orderMetaEl.textContent = 'Загрузка деталей…';
  contoursPreEl.textContent = '[]';
  layoutWrapEl.textContent = '';

  try {
    const res = await fetch(`/admin/api/orders/${encodeURIComponent(orderId)}`);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(text || `HTTP ${res.status}`);
    }

    selectedOrderDetails = JSON.parse(text);
    updateMeta(selectedOrderDetails);
  } catch (err) {
    statusEl.textContent = err.toString();
    detailsEmptyEl.hidden = false;
    detailsEl.hidden = true;
  }
};

const postStatusChange = async (path, loadingText) => {
  if (!selectedOrderId) {
    return;
  }
  statusEl.textContent = loadingText;

  try {
    const res = await fetch(path, { method: 'POST' });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(text || `HTTP ${res.status}`);
    }

    statusEl.textContent = 'Статус обновлён';
    await loadOrders();
    await selectOrder(selectedOrderId, { skipListRerender: true });
    renderOrdersList();
  } catch (err) {
    statusEl.textContent = err.toString();
  }
};

confirmBtn.addEventListener('click', () => {
  postStatusChange(`/admin/api/orders/${encodeURIComponent(selectedOrderId)}/confirm`, 'Обновление confirmed…');
});

producedBtn.addEventListener('click', () => {
  postStatusChange(`/admin/api/orders/${encodeURIComponent(selectedOrderId)}/produced`, 'Обновление produced…');
});

reloadBtn.addEventListener('click', loadOrders);

loadOrders();
