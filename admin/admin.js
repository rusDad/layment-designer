const article = document.getElementById('article');
const name = document.getElementById('name');
const brand = document.getElementById('brand');
const categorySelect = document.getElementById('categorySelect');
const newCategorySlug = document.getElementById('newCategorySlug');
const newCategoryLabel = document.getElementById('newCategoryLabel');
const createCategoryBtn = document.getElementById('createCategoryBtn');
const scaleOverride = document.getElementById('scaleOverride');
const cuttingLengthMeters = document.getElementById('cuttingLengthMeters');
const enabled = document.getElementById('enabled');

const svg = document.getElementById('svg');
const dxf = document.getElementById('dxf');
const nc = document.getElementById('nc');
const preview = document.getElementById('preview');
const force = document.getElementById('force');

const itemId = document.getElementById('itemId');

const createBtn = document.getElementById('createItemBtn');
const uploadBtn = document.getElementById('uploadFilesBtn');
const uploadDxfBtn = document.getElementById('uploadDxfBtn');

const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const itemsList = document.getElementById('itemsList');
const itemsStatus = document.getElementById('itemsStatus');

let currentItemId = null;
let itemsCache = [];
let categoriesCache = {};

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

const createCategoryOption = (slug, label, isUnknown = false) => {
  const option = document.createElement('option');
  option.value = slug;
  option.textContent = isUnknown
    ? `Неизвестная категория: ${slug}`
    : `${label} (${slug})`;
  if (isUnknown) {
    option.dataset.unknown = 'true';
  }
  return option;
};

const removeUnknownCategoryOption = () => {
  const unknownOption = categorySelect.querySelector('option[data-unknown="true"]');
  if (unknownOption) {
    unknownOption.remove();
  }
};

const ensureCategoryOption = (slug) => {
  if (!slug) {
    return;
  }

  const hasOption = Array.from(categorySelect.options).some((option) => option.value === slug);
  if (hasOption) {
    return;
  }

  removeUnknownCategoryOption();
  categorySelect.appendChild(createCategoryOption(slug, slug, true));
};

const setCategoryValue = (slug) => {
  const normalized = (slug || '').trim();
  if (!normalized) {
    categorySelect.value = '';
    return;
  }

  ensureCategoryOption(normalized);
  categorySelect.value = normalized;
};

const populateCategorySelect = () => {
  const previousValue = categorySelect.value;
  categorySelect.innerHTML = '';

  const emptyOption = document.createElement('option');
  emptyOption.value = '';
  emptyOption.textContent = '— Выберите категорию —';
  categorySelect.appendChild(emptyOption);

  Object.entries(categoriesCache).forEach(([slug, label]) => {
    categorySelect.appendChild(createCategoryOption(slug, label));
  });

  if (previousValue) {
    setCategoryValue(previousValue);
  }
};

const loadCategories = async () => {
  try {
    const res = await fetch('/admin/api/categories');
    const text = await res.text();

    if (!res.ok) {
      resultEl.textContent = text;
      return;
    }

    const data = JSON.parse(text);
    categoriesCache = {};
    (data.categories || []).forEach((category) => {
      categoriesCache[category.slug] = category.label || category.slug;
    });

    populateCategorySelect();

    if (currentItemId) {
      const selectedItem = itemsCache.find((item) => item.id === currentItemId);
      if (selectedItem) {
        setCategoryValue(selectedItem.category || '');
      }
    }
  } catch (err) {
    resultEl.textContent = err.toString();
  }
};

const resetItemForm = () => {
  article.value = '';
  name.value = '';
  brand.value = '';
  setCategoryValue('');
  scaleOverride.value = 1.0;
  cuttingLengthMeters.value = 0;
  enabled.checked = true;

  currentItemId = null;
  itemId.value = '';

  article.disabled = false;
  uploadBtn.disabled = true;
  uploadDxfBtn.disabled = true;
};

const fillItemForm = (item) => {
  article.value = item.article || '';
  name.value = item.name || '';
  brand.value = item.brand || '';
  setCategoryValue(item.category || '');
  scaleOverride.value = item.scaleOverride ?? 1.0;
  cuttingLengthMeters.value = item.cuttingLengthMeters ?? 0;
  enabled.checked = item.enabled !== false;

  currentItemId = item.id;
  itemId.value = item.id;

  article.disabled = true;
  uploadBtn.disabled = false;
  uploadDxfBtn.disabled = false;
};

const renderItems = (items) => {
  itemsList.innerHTML = '';

  const createNewCard = document.createElement('button');
  createNewCard.type = 'button';
  createNewCard.className = 'item-card item-card-create-new';
  createNewCard.textContent = '➕ Добавить новый артикул';
  createNewCard.addEventListener('click', resetItemForm);
  itemsList.appendChild(createNewCard);

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
  uploadDxfBtn.disabled = true;

  const payload = {
    article: article.value.trim(),
    name: name.value.trim(),
    brand: brand.value.trim(),
    category: categorySelect.value.trim(),
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
    uploadDxfBtn.disabled = false;

    statusEl.textContent = `Артикул готов: ${currentItemId}`;
    resultEl.textContent = JSON.stringify(data, null, 2);
    await loadItems();

  } catch (err) {
    statusEl.textContent = 'Ошибка запроса';
    resultEl.textContent = err.toString();
  }
});

createCategoryBtn.addEventListener('click', async () => {
  const payload = {
    slug: newCategorySlug.value.trim(),
    label: newCategoryLabel.value.trim()
  };

  statusEl.textContent = 'Создание категории…';
  resultEl.textContent = '';

  try {
    const res = await fetch('/admin/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await res.text();

    if (!res.ok) {
      statusEl.textContent = 'Ошибка создания категории';
      resultEl.textContent = text;
      return;
    }

    const data = JSON.parse(text);
    await loadCategories();
    setCategoryValue(data.slug);
    newCategorySlug.value = '';
    newCategoryLabel.value = '';

    statusEl.textContent = 'Категория создана';
    resultEl.textContent = JSON.stringify(data, null, 2);
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

uploadDxfBtn.addEventListener('click', async () => {
  if (!currentItemId) {
    alert('Сначала создайте артикул');
    return;
  }

  if (!dxf.files[0]) {
    alert('DXF обязателен для конвертации');
    return;
  }

  statusEl.textContent = 'Конвертация DXF в SVG…';
  resultEl.textContent = '';

  const fd = new FormData();
  fd.append('dxf', dxf.files[0]);

  if (force.checked) {
    fd.append('force', 'true');
  }

  try {
    const res = await fetch(
      `/admin/api/items/${currentItemId}/dxf-to-svg`,
      {
        method: 'POST',
        body: fd
      }
    );

    const text = await res.text();

    if (!res.ok) {
      statusEl.textContent = 'Ошибка конвертации DXF';
      resultEl.textContent = text;
      return;
    }

    statusEl.textContent = 'DXF успешно конвертирован в SVG';
    resultEl.textContent = text;
    await loadItems();
  } catch (err) {
    statusEl.textContent = 'Ошибка запроса';
    resultEl.textContent = err.toString();
  }
});

Promise.all([loadItems(), loadCategories()]);
