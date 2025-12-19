const articleInput = document.getElementById('articleInput');
const idPreview = document.getElementById('idPreview');
const previewBtn = document.getElementById('previewIdBtn');
const confirmCheckbox = document.getElementById('confirmId');
const errorBox = document.getElementById('errorBox');

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
