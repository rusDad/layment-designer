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

let currentItemId = null;

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

  } catch (err) {
    statusEl.textContent = 'Ошибка запроса';
    resultEl.textContent = err.toString();
  }
});
