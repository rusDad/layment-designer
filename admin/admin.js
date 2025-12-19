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
