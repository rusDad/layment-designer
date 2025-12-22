const articleInput = document.getElementById('articleInput');
const idPreview = document.getElementById('idPreview');
const previewBtn = document.getElementById('previewIdBtn');
const confirmCheckbox = document.getElementById('confirmId');
const errorBox = document.getElementById('errorBox');
const uploadForm = document.getElementById('uploadForm');
const uploadResult = document.getElementById('uploadResult');

uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const itemId = document.getElementById('uploadItemId').value.trim();
  const svg = document.getElementById('uploadSvg').files[0];
  const nc = document.getElementById('uploadNc').files[0];
  const preview = document.getElementById('uploadPreview').files[0];
  const force = document.getElementById('uploadForce').checked;

  if (!itemId || !svg || !nc) {
    alert('ID, SVG и NC обязательны');
    return;
  }

  const formData = new FormData();
  formData.append('svg', svg);
  formData.append('nc', nc);
  if (preview) formData.append('preview', preview);
  if (force) formData.append('force', 'true');

  uploadResult.textContent = 'Загрузка…';

  try {
    const res = await fetch(`/admin/api/items/${itemId}/files`, {
      method: 'POST',
      body: formData
    });

    const text = await res.text();

    if (!res.ok) {
      uploadResult.textContent = `Ошибка ${res.status}:\n${text}`;
      return;
    }

    uploadResult.textContent = `OK:\n${text}`;
  } catch (err) {
    uploadResult.textContent = `Ошибка запроса:\n${err}`;
  }
});

const articleInput = document.getElementById('article');
const itemIdInput = document.getElementById('itemId');

articleInput.addEventListener('blur', async () => {
  const article = articleInput.value.trim();
  if (!article) return;

  const res = await fetch('/admin/api/preview-id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ article })
  });

  if (!res.ok) return;

  const data = await res.json();
  itemIdInput.value = data.id;
});

const form = document.getElementById('itemForm');
const result = document.getElementById('result');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const payload = {
    article: article.value.trim(),
    name: name.value.trim(),
    brand: brand.value.trim(),
    category: category.value.trim(),
    scaleOverride: parseFloat(scaleOverride.value || 1.0),
    cuttingLengthMeters: parseFloat(cuttingLengthMeters.value || 0),
    enabled: enabled.checked
  };

  result.textContent = 'Сохранение metadata…';

  const metaRes = await fetch('/admin/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!metaRes.ok) {
    result.textContent = await metaRes.text();
    return;
  }

  const { id } = await metaRes.json();

  // ---- файлы ----

  const svgFile = svg.files[0];
  const ncFile = nc.files[0];
  const previewFile = preview.files[0];

  if (!svgFile && !ncFile && !previewFile) {
    result.textContent += '\nMetadata сохранены';
    return;
  }

  const fd = new FormData();
  if (svgFile) fd.append('svg', svgFile);
  if (ncFile) fd.append('nc', ncFile);
  if (previewFile) fd.append('preview', previewFile);
  if (force.checked) fd.append('force', 'true');

  result.textContent += '\nЗагрузка файлов…';

  const fileRes = await fetch(`/admin/api/items/${id}/files`, {
    method: 'POST',
    body: fd
  });

  const text = await fileRes.text();

  if (!fileRes.ok) {
    result.textContent += `\nОшибка файлов:\n${text}`;
    return;
  }

  result.textContent += `\nOK:\n${text}`;
});

const itemSelect = document.getElementById('itemSelect');

async function loadItems() {
  const res = await fetch('/admin/api/items');
  if (!res.ok) return;

  const data = await res.json();

  data.items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = `${item.article} — ${item.name}`;
    opt.dataset.item = JSON.stringify(item);
    itemSelect.appendChild(opt);
  });
}

loadItems();

function updateAssetStatus(item) {
  svgStatus.textContent = item.assets?.svg ? '✔ загружен' : '— нет';
  ncStatus.textContent = item.assets?.nc ? '✔ загружен' : '— нет';
  previewStatus.textContent = item.assets?.preview ? '✔ загружен' : '— нет';
}

itemSelect.addEventListener('change', () => {
  const opt = itemSelect.selectedOptions[0];
  if (!opt || !opt.dataset.item) return;
  updateAssetStatus(item);

  const item = JSON.parse(opt.dataset.item);

  article.value = item.article;
  itemId.value = item.id;
  name.value = item.name;
  enabled.checked = item.enabled;

  article.disabled = true; // id уже зафиксирован
});

function resetAssetStatus() {
  svgStatus.textContent = '';
  ncStatus.textContent = '';
  previewStatus.textContent = '';
}


previewBtn.addEventListener('click', async () => {
  const article = articleInput.value.trim();

  errorBox.textContent = '';
  idPreview.value = '';
  confirmCheckbox.checked = false;

  if (!article) {
    errorBox.textContent = 'Article обязателен';
    return;
  }

  try {
    const resp = await fetch('/admin/api/preview-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ article })
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.detail || 'Ошибка генерации id');
    }

    const data = await resp.json();
    idPreview.value = data.id;

  } catch (e) {
    errorBox.textContent = e.message;
  }
});
