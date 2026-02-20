// config.js - Конфигурационные константы приложения

// ==================== ОБЩИЕ НАСТРОЙКИ ====================
window.Config = {
    LAYMENT_DEFAULT_WIDTH : 565,
    LAYMENT_DEFAULT_HEIGHT : 375,
    LAYMENT_MIN_SIZE : 100,
    LAYMENT_OFFSET : 20,
    LAYMENT_PRESETS: {
        SMALL: { width: 400, height: 300 },
        MEDIUM: { width: 500, height: 350 },
        LARGE: { width: 565, height: 375 }
    },

    WORKSPACE_SCALE : {
        DEFAULT: 1.0,
        MIN: 0.5,
        MAX: 10.0,
        STEP_NORMAL: 0.1,
        STEP_CTRL: 0.05
    },

    LABELS: {
        FONT_SIZE_MM: 4,
        DEFAULT_OFFSET: { x: 6, y: 0 }
    },

    // ==================== UI ====================
    UI : {
        PANEL_WIDTH: 320,
        CANVAS_PADDING: 40,
        HEADER_HEIGHT: 120,
        CANVAS_BACKGROUND: '#fafafa'
    },

    LAYMENT_STYLE : {
        STROKE: '#000',
        STROKE_WIDTH: 2,
        STROKE_DASH_ARRAY: [10, 5],
        FILL: '#464746',
        SAFE_AREA_STROKE: '#f1c40f',
        SAFE_AREA_STROKE_WIDTH: 1,
        SAFE_AREA_STROKE_DASH_ARRAY: [6, 4]
    },

    MATERIAL_COLORS: {
        green: '#208820',
        blue: '#1f6fd6'
    },
    DEFAULT_MATERIAL_COLOR: 'green',

    // ==================== ЦЕНЫ И РАСЧЕТЫ ====================
    PRICES : {
        MATERIAL_TECHNICAL_WASTE_K: 1.25,
        MATERIAL_PRICE_PER_M2: 2500,
        CUTTING_PRICE_PER_METER: 14,
        RRC_PRICE_MULTIPLIER: 2.25
    },

    CONVERSION : {
        MM_TO_METERS: 0.001,
        MM2_TO_M2: 1e-6,
        SCALE_FACTOR: 1  // 1px = 0.0353 мм
    },

    // ==================== API И ПУТИ ====================
    API : {
        BASE_URL: '/api',
        EXPORT_Layment: '/export-layment',
        MANIFEST_URL: '/api/contours/manifest'

    },

    // ==================== ГЕОМЕТРИЯ ====================
    GEOMETRY : {
        ALLOWED_ANGLES: [0, 90, 180, 270],
        LAYMENT_PADDING: 8,
        CLEARANCE_MM: 2,
        PRIMITIVES: {
            RECT: { MIN_WIDTH: 8, MAX_WIDTH: 800, MIN_HEIGHT: 8, MAX_HEIGHT: 400 },
            CIRCLE: { MIN_RADIUS: 4, MAX_RADIUS: 200 }
        }
    },

    // ==================== ЦВЕТА ====================
    COLORS : {
        CONTOUR: {
            NORMAL: '#101214ff',
            ERROR: '#e74c3c',
            FILL: '#208820',
            NORMAL_STROKE_WIDTH: 1,
            ERROR_STROKE_WIDTH: 3
        },
        SELECTION: {
            BORDER: '#3498db',
            CORNER: '#3498db',
            ERROR_BORDER: '#e74c3c',
            ERROR_CORNER: '#c0392b'
        },
        PRIMITIVE: {
            STROKE: '#00ff00',  // Зеленый для примитивов
            FILL: '#208820',
            ERROR: '#ff0000'     // Красный для ошибок (выход за край)
        }
    },

    // ==================== Константы PixelOverlap  ДЛЯ ПРОВЕРКИ ПЕРЕСЕЧЕНИЙ ====================
    CANVAS_OVERLAP : {
        TEMP_BACKGROUND: '#ffffff',
        PIXEL_CHECK_PADDING: 10,
        CENTER_OFFSET: 20,
        OVERLAP_COLOR: 'rgba(0,0,0,0.5)',
        OVERLAP_THRESHOLD: {
            COLOR_DIFF: 10,      // Максимальная разница между RGB
            MAX_RGB: 100,        // Максимальное значение RGB для тёмного серого
            MIN_ALPHA: 128       // Минимальная альфа-прозрачность
        }
    },

    // ==================== FABRIC.JS НАСТРОЙКИ ====================
    FABRIC_CONFIG : {
        GROUP: {                    //Разрешаем перемещение группы, но запрещаем всё остальное
            hasControls: false,     //убираем контроллы масштабирования и поворота
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true,
            lockMovementX: false,   //разрешаем двигать по X и Y
            lockMovementY: false,
            hasBorders: true        //оставляем рамку, чтобы было видно, что группа выделена
        },
        CONTOUR: {
            hasControls: true,
            hasBorders: true,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: false,
            cornerColor: '#3498db',
            borderColor: '#3498db',
            transparentCorners: false
        },
        CONTROLS_VISIBILITY: {
            tl: true, tr: false, br: false, bl: false,
            ml: false, mt: false, mr: false, mb: false,
            mtr: true
        }
    },

    
    // ==================== СООБЩЕНИЯ ====================
    MESSAGES : {
        LOADING_ERROR: 'Не удалось загрузить список артикулов',
        EXPORT_ERROR: 'Исправьте ошибки перед заказом!',
        COLLISION_ERROR: 'Ошибка: есть пересечения или выход за границы',
        OUT_OF_BOUNDS_ERROR: 'Элемент вышел за границы ложемента',
        TOO_CLOSE_ERROR: 'Инструменты слишком близко друг к другу',
        VALID_LAYOUT: 'Раскладка валидна! Можно заказывать',
    }
};    
