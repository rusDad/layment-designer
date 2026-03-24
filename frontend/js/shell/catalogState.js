(function initCatalogState(global) {
    function toManifestMap(items) {
        if (Array.isArray(items)) {
            return items.reduce((acc, item) => {
                if (item?.id) {
                    acc[item.id] = item;
                }
                return acc;
            }, {});
        }

        if (items && typeof items === 'object') {
            return { ...items };
        }

        return {};
    }

    function getCategoryLabel(item, categoryLabels) {
        const raw = (item?.category || '').trim();
        if (!raw) {
            return 'Без категории';
        }
        const label = categoryLabels?.[raw]?.label;
        return label ? label.trim() || raw : raw;
    }

    function buildArticleEntries(items, categoryLabels) {
        const entries = new Map();
        items.forEach(item => {
            const article = (item?.article || item?.id || '').trim();
            if (!article) {
                return;
            }
            if (!entries.has(article)) {
                entries.set(article, {
                    article,
                    name: item.name || '',
                    category: getCategoryLabel(item, categoryLabels),
                    variants: []
                });
            }
            const entry = entries.get(article);
            entry.variants.push(item);
            if (!entry.name && item.name) {
                entry.name = item.name;
            }
        });

        return Array.from(entries.values())
            .map(entry => ({
                ...entry,
                variants: entry.variants.slice().sort((a, b) => ((a.poseLabel || a.poseKey || '').localeCompare(b.poseLabel || b.poseKey || '', 'ru')))
            }))
            .sort((a, b) => `${a.article} ${a.name}`.localeCompare(`${b.article} ${b.name}`, 'ru'));
    }

    function buildCategories(entries) {
        const categories = new Map();
        entries.forEach(entry => {
            const label = (entry?.category || '').trim() || 'Без категории';
            if (!categories.has(label)) {
                categories.set(label, label);
            }
        });
        return Array.from(categories.keys()).sort((a, b) => a.localeCompare(b, 'ru'));
    }

    function createCatalogState({ fetchImpl, manifestUrl, onManifestLoaded } = {}) {
        const state = {
            manifest: {},
            items: [],
            categories: [],
            currentCategory: null,
            query: '',
            loadError: null,
            categoryLabels: {}
        };

        const fetchFn = typeof fetchImpl === 'function' ? fetchImpl : fetch;

        function ensureValidCategory() {
            if (state.currentCategory && !state.categories.includes(state.currentCategory)) {
                state.currentCategory = null;
            }
        }

        function setManifestItems(items, categoryLabels = {}) {
            state.manifest = toManifestMap(items);
            state.categoryLabels = categoryLabels && typeof categoryLabels === 'object' ? categoryLabels : {};

            const enabledItems = Object.values(state.manifest).filter(item => item?.enabled);
            state.items = buildArticleEntries(enabledItems, state.categoryLabels);
            state.categories = buildCategories(state.items);
            ensureValidCategory();

            if (typeof onManifestLoaded === 'function') {
                onManifestLoaded(state.manifest);
            }

            return getState();
        }

        async function load() {
            state.loadError = null;
            try {
                const response = await fetchFn(manifestUrl || Config.API.MANIFEST_URL);
                const data = await response.json();
                setManifestItems(data?.items || [], data?.categories || {});
            } catch (error) {
                console.error('Ошибка загрузки manifest', error);
                state.loadError = Config.MESSAGES.LOADING_ERROR;
            }
            return getState();
        }

        function setFilters({ category = state.currentCategory, query = state.query } = {}) {
            state.currentCategory = category && state.categories.includes(category) ? category : null;
            state.query = typeof query === 'string' ? query : '';
            return getState();
        }

        function setCategory(category) {
            return setFilters({ category, query: state.query });
        }

        function setQuery(query) {
            return setFilters({ category: state.currentCategory, query });
        }

        function getState() {
            return {
                manifest: { ...state.manifest },
                currentCategory: state.currentCategory,
                query: state.query || '',
                categories: [...state.categories],
                loadError: state.loadError,
                categoryLabels: { ...state.categoryLabels },
                items: state.items.map(entry => ({
                    article: entry.article,
                    name: entry.name,
                    category: entry.category,
                    variants: (entry.variants || []).map(variant => ({ ...variant }))
                }))
            };
        }

        return {
            load,
            setManifestItems,
            setFilters,
            setCategory,
            setQuery,
            getState
        };
    }

    global.DesignerCatalogState = { create: createCatalogState };
})(window);
