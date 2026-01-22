const article = document.getElementById('article');
const name = document.getElementById('name');
const brand = document.getElementById('brand');
const category = document.getElementById('category');
const scaleOverride = document.getElementById('scaleOverride');
const cuttingLengthMeters = document.getElementById('cuttingLengthMeters');
const enabled = document.getElementById('enabled');

const svg = document.getElementById('svg');
const nc = document.getElementById('nc');
const preview = document.getElementById('preview');
const force = document.getElementById('force');

const itemId = document.getElementById('itemId');

const createBtn = document.getElementById('createItemBtn');
const uploadBtn = document.getElementById('uploadFilesBtn');

const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const itemsList = document.getElementById('itemsList');
const itemsStatus = document.getElementById('itemsStatus');

let currentItemId = null;
let itemsCache = [];

const fileLabels = {
  svg: 'SVG',
  nc: 'NC',
  preview: 'Preview'
};

const renderFileStatus = (files = {}) => Object.entries(fileLabels)
  .map(([key, label]) => {
    const exists = Boolean(files[key]);
    const span = document.createElement('span');
    span.className = exists ? 'file-ok' : 'file-missing';
    span.textContent = `${label}: ${exists ? '✓' : '—'}`;
    return span;
  });

const fillItemForm = (item) => {
  article.value = item.article || '';
  name.value = item.name || '';
  brand.value = item.brand || '';
  category.value = item.category || '';
  scaleOverride.value = item.scaleOverride ?? 1.0;
  cuttingLengthMeters.value = item.cuttingLengthMeters ?? 0;
  enabled.checked = item.enabled !== false;

  currentItemId = item.id;
  itemId.value = item.id;

  article.disabled = true;
  uploadBtn.disabled = false;
};

const renderItems = (items) => {
  itemsList.innerHTML = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.textContent = 'Артикулы не найдены';
    itemsList.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'item-card';
    card.addEventListener('click', () => fillItemForm(item));

    const meta = document.createElement('div');
    meta.className = 'item-meta';

    const title = document.createElement('div');
    title.className = 'item-title';
    title.textContent = `${item.name || 'Без названия'} · ${item.article}`;
    meta.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.className = 'item-subtitle';
    subtitle.textContent = `id: ${item.id} · enabled: ${item.enabled ? 'yes' : 'no'}`;
    meta.appendChild(subtitle);

    const files = document.createElement('div');
    files.className = 'item-files';
    renderFileStatus(item.files).forEach((node) => files.appendChild(node));
    meta.appendChild(files);

    card.appendChild(meta);

    if (item.previewUrl) {
      const previewWrap = document.createElement('div');
      previewWrap.className = 'item-preview';
      const img = document.createElement('img');
      img.src = item.previewUrl;
      img.alt = `Preview ${item.article}`;
      previewWrap.appendChild(img);
      card.appendChild(previewWrap);
    }

    itemsList.appendChild(card);
  });
};

const loadItems = async () => {
  itemsStatus.textContent = 'Загрузка списка…';
  try {
    const res = await fetch('/admin/api/items');
    const text = await res.text();

    if (!res.ok) {
      itemsStatus.textContent = 'Ошибка загрузки списка';
      resultEl.textContent = text;
      return;
    }

    const data = JSON.parse(text);
    itemsCache = data.items || [];
    renderItems(itemsCache);
    itemsStatus.textContent = `Найдено: ${itemsCache.length}`;
  } catch (err) {
    itemsStatus.textContent = 'Ошибка загрузки списка';
    resultEl.textContent = err.toString();
  }
};

/* -------------------------
   1. Создание / обновление артикула
------------------------- */

createBtn.addEventListener('click', async () => {
  statusEl.textContent = 'Создание артикула…';
  resultEl.textContent = '';
  uploadBtn.disabled = true;

  const payload = {
    article: article.value.trim(),
    name: name.value.trim(),
    brand: brand.value.trim(),
    category: category.value.trim(),
    scaleOverride: parseFloat(scaleOverride.value || 1.0),
    cuttingLengthMeters: parseFloat(cuttingLengthMeters.value || 0),
    enabled: enabled.checked
  };

  try {
    const res = await fetch('/admin/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await res.text();

    if (!res.ok) {
      statusEl.textContent = 'Ошибка создания артикула';
      resultEl.textContent = text;
      return;
    }

    const data = JSON.parse(text);

    currentItemId = data.id;
    itemId.value = currentItemId;

    article.disabled = true;
    uploadBtn.disabled = false;

    statusEl.textContent = `Артикул готов: ${currentItemId}`;
    resultEl.textContent = JSON.stringify(data, null, 2);
    await loadItems();

  } catch (err) {
    statusEl.textContent = 'Ошибка запроса';
    resultEl.textContent = err.toString();
  }
});

/* -------------------------
   2. Загрузка файлов
------------------------- */

uploadBtn.addEventListener('click', async () => {
  if (!currentItemId) {
    alert('Сначала создайте артикул');
    return;
  }

  if (!svg.files[0] || !nc.files[0]) {
    alert('SVG и NC обязательны');
    return;
  }

  statusEl.textContent = 'Загрузка файлов…';
  resultEl.textContent = '';

  const fd = new FormData();
  fd.append('svg', svg.files[0]);
  fd.append('nc', nc.files[0]);

  if (preview.files[0]) {
    fd.append('preview', preview.files[0]);
  }

  if (force.checked) {
    fd.append('force', 'true');
  }

  try {
    const res = await fetch(
      `/admin/api/items/${currentItemId}/files`,
      {
        method: 'POST',
        body: fd
      }
    );

    const text = await res.text();

    if (!res.ok) {
      statusEl.textContent = 'Ошибка загрузки файлов';
      resultEl.textContent = text;
      return;
    }

    statusEl.textContent = 'Файлы загружены успешно';
    resultEl.textContent = text;
    await loadItems();

  } catch (err) {
    statusEl.textContent = 'Ошибка запроса';
    resultEl.textContent = err.toString();
  }
});

loadItems();
