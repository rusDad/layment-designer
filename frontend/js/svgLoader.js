class SVGLoader {
    constructor() {
        this.svgCache = new Map();
    }

    async loadSVG(url) {
        if (this.svgCache.has(url)) {
            return this.svgCache.get(url);
        }

        try {
            const response = await fetch(url);
            const svgText = await response.text();
            this.svgCache.set(url, svgText);
            return svgText;
        } catch (error) {
            console.error('Ошибка загрузки SVG:', error);
            throw error;
        }
    }

    async createFabricObjectFromSVG(svgUrl) {
        try {
            const svgText = await this.loadSVG(svgUrl);
            return new Promise((resolve, reject) => {
                fabric.loadSVGFromString(svgText, (objects, options) => {
                    const group = fabric.util.groupSVGElements(objects, options);
                    resolve(group);
                });
            });
        } catch (error) {
            console.error('Ошибка создания объекта из SVG:', error);
            throw error;
        }
    }
}