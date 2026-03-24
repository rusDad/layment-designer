(function initCatalogShell(global) {
    function filterCatalogItems(state) {
        const query = (state.query || '').trim().toLowerCase();
        const hasQuery = Boolean(query);
        const baseItems = Array.isArray(state.items) ? state.items : [];

        const items = baseItems.filter(entry => {
            if (state.currentCategory && entry.category !== state.currentCategory) {
                return false;
            }
            if (!hasQuery) {
                return true;
            }

            const fields = [
                entry.article,
                entry.name,
                entry.category,
                ...(entry.variants || []).flatMap(variant => [variant?.name, variant?.poseLabel, variant?.poseKey])
            ].filter(Boolean).map(value => String(value).toLowerCase());

            return fields.some(value => value.includes(query));
        });

        return { items, hasQuery };
    }

    function createCatalogShell({ editorFacade, uiDom, feedback }) {
        const dom = uiDom?.catalog;
        const list = uiDom?.panels?.catalogList;
        const catalogState = global.DesignerCatalogState.create({
            onManifestLoaded: (manifest) => {
                editorFacade.commands.setCatalogManifest?.(manifest);
            }
        });

        function createPreviewElement(item) {
            const previewAsset = item?.assets?.preview;
            if (!previewAsset) {
                const placeholder = document.createElement('div');
                placeholder.className = 'catalog-preview-placeholder';
                placeholder.textContent = 'Нет превью';
                return placeholder;
            }

            const img = document.createElement('img');
            img.className = 'catalog-item-preview';
            img.alt = item.name || '';
            img.loading = 'lazy';
            img.src = `/contours/${previewAsset}`;
            img.onerror = () => {
                const placeholder = document.createElement('div');
                placeholder.className = 'catalog-preview-placeholder';
                placeholder.textContent = 'Нет превью';
                img.replaceWith(placeholder);
            };
            return img;
        }

        async function render() {
            const state = catalogState.getState();
            if (!dom || !list) {
                return state;
            }

            dom.breadcrumbSeparator.style.display = state.currentCategory ? 'inline' : 'none';
            dom.breadcrumbCurrent.style.display = state.currentCategory ? 'inline' : 'none';
            dom.breadcrumbCurrent.textContent = state.currentCategory || '';
            dom.searchInput.value = state.query || '';

            dom.categorySelect.innerHTML = '';
            const allOption = document.createElement('option');
            allOption.value = '';
            allOption.textContent = 'Все категории';
            dom.categorySelect.appendChild(allOption);
            (state.categories || []).forEach(category => {
                const option = document.createElement('option');
                option.value = category;
                option.textContent = category;
                dom.categorySelect.appendChild(option);
            });
            dom.categorySelect.value = state.currentCategory || '';

            list.innerHTML = '';

            if (state.loadError) {
                feedback?.showError?.(state.loadError, 'Каталог недоступен');
                const errorRow = document.createElement('div');
                errorRow.className = 'catalog-row';
                errorRow.textContent = state.loadError;
                list.appendChild(errorRow);
                return state;
            }

            const { items, hasQuery } = filterCatalogItems(state);
            if (!state.currentCategory && !hasQuery) {
                if (!(state.categories || []).length) {
                    const empty = document.createElement('div');
                    empty.className = 'catalog-row';
                    empty.textContent = 'Категории не найдены';
                    list.appendChild(empty);
                    return state;
                }

                (state.categories || []).forEach(category => {
                    const row = document.createElement('div');
                    row.className = 'catalog-row';
                    row.addEventListener('click', async () => {
                        catalogState.setCategory(category);
                        await render();
                    });

                    const icon = document.createElement('span');
                    icon.className = 'catalog-folder-icon';
                    icon.textContent = '📁';

                    const name = document.createElement('span');
                    name.className = 'catalog-folder-name';
                    name.textContent = category;

                    row.append(icon, name);
                    list.appendChild(row);
                });
                return state;
            }

            if (!items.length) {
                const empty = document.createElement('div');
                empty.className = 'catalog-row';
                empty.textContent = 'Контуры не найдены';
                list.appendChild(empty);
                return state;
            }

            items.forEach(entry => {
                const selectedVariant = entry.variants?.[0] || null;
                const row = document.createElement('div');
                row.className = 'catalog-row';
                row.dataset.selectedVariantIndex = '0';

                const meta = document.createElement('div');
                meta.className = 'catalog-item-meta';

                const article = document.createElement('div');
                article.className = 'catalog-item-article';
                article.textContent = entry.article || '';

                const name = document.createElement('div');
                name.className = 'catalog-item-name';
                name.textContent = entry.name || selectedVariant?.name || '';
                meta.append(article, name);

                if (entry.variants?.length > 1) {
                    const variantSelect = document.createElement('select');
                    variantSelect.className = 'catalog-variant-select';
                    entry.variants.forEach((variant, index) => {
                        const option = document.createElement('option');
                        option.value = String(index);
                        option.textContent = variant.poseLabel || variant.poseKey || 'Базовый';
                        variantSelect.appendChild(option);
                    });
                    variantSelect.addEventListener('click', event => event.stopPropagation());
                    variantSelect.addEventListener('change', event => {
                        const variant = entry.variants[Number(event.target.value)] || entry.variants[0];
                        row.dataset.selectedVariantIndex = event.target.value;
                        name.textContent = variant?.name || entry.name || '';
                    });
                    meta.appendChild(variantSelect);
                }

                if (!state.currentCategory && hasQuery && entry.category) {
                    const categoryLabel = document.createElement('div');
                    categoryLabel.className = 'catalog-item-article';
                    categoryLabel.textContent = entry.category;
                    meta.appendChild(categoryLabel);
                }

                const addVariant = async () => {
                    const variantIndex = Number(row.dataset.selectedVariantIndex || 0);
                    const variant = entry.variants?.[variantIndex] || entry.variants?.[0];
                    if (!variant) {
                        return;
                    }
                    await editorFacade.commands.addContour(variant);
                };

                const addButton = document.createElement('button');
                addButton.type = 'button';
                addButton.className = 'catalog-add-button';
                addButton.textContent = '+';
                addButton.addEventListener('click', async event => {
                    event.stopPropagation();
                    await addVariant();
                });

                row.addEventListener('click', addVariant);
                row.append(createPreviewElement(selectedVariant), meta, addButton);
                list.appendChild(row);
            });

            return state;
        }

        function bind() {
            if (!dom) {
                return;
            }

            dom.breadcrumbAll?.addEventListener('click', async () => {
                catalogState.setCategory(null);
                await render();
            });

            dom.categorySelect?.addEventListener('change', async event => {
                catalogState.setCategory(event.target.value || null);
                await render();
            });

            dom.searchInput?.addEventListener('input', async event => {
                catalogState.setQuery(event.target.value || '');
                await render();
            });
        }

        async function init() {
            await catalogState.load();
            return await render();
        }

        return { bind, render, init, load: catalogState.load };
    }

    global.DesignerCatalogShell = { create: createCatalogShell };
})(window);
