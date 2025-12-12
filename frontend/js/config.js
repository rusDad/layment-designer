// config.js - Конфигурационные константы приложения

// ==================== ОБЩИЕ НАСТРОЙКИ ====================
export const LAYMENT_DEFAULT_WIDTH = 565;
export const LAYMENT_DEFAULT_HEIGHT = 375;
export const LAYMENT_MIN_SIZE = 100;
export const LAYMENT_OFFSET = 20;

export const WORKSPACE_SCALE = {
    DEFAULT: 1.0,
    MIN: 0.5,
    MAX: 10.0,
    STEP_NORMAL: 0.1,
    STEP_CTRL: 0.05
};

// ==================== ЦЕНЫ И РАСЧЕТЫ ====================
export const PRICES = {
    MATERIAL_DENSITY_KG_M2: 1.25,
    MATERIAL_PRICE_PER_KG: 2500,
    CUTTING_PRICE_PER_METER: 14,
    TOTAL_MULTIPLIER: 2.25
};

export const CONVERSION = {
    MM_TO_METERS: 0.001,
    MM2_TO_M2: 1e-6,
    SCALE_FACTOR: 0.0353  // 1px = 0.0353 мм
};

// ==================== API И ПУТИ ====================
export const API = {
    BASE_URL: '/api',
    EXPORT_Layment: '/export-layment',
    MANIFEST_URL: '/contours/manifest.json'
};

// ==================== ГЕОМЕТРИЯ ====================
export const GEOMETRY = {
    ALLOWED_ANGLES: [0, 90, 180, 270],
    LAYMENT_PADDING: 8
};

// ==================== ЦВЕТА ====================
export const COLORS = {
    CONTOUR: {
        NORMAL: '#101214ff',
        ERROR: '#e74c3c',
        NORMAL_STROKE_WIDTH: 10,
        ERROR_STROKE_WIDTH: 15
    },
    SELECTION: {
        BORDER: '#3498db',
        CORNER: '#3498db',
        ERROR_BORDER: '#e74c3c',
        ERROR_CORNER: '#c0392b'
    }
};

// ==================== FABRIC.JS НАСТРОЙКИ ====================
export const FABRIC_CONFIG = {
    GROUP: {
        hasControls: false,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
        lockMovementX: false,
        lockMovementY: false,
        hasBorders: true
    },
    CONTOUR: {
        hasControls: true,
        hasBorders: true,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: false,
        cornerColor: COLORS.SELECTION.CORNER,
        borderColor: COLORS.SELECTION.BORDER,
        transparentCorners: false
    },
    CONTROLS_VISIBILITY: {
        tl: true, tr: false, br: false, bl: false,
        ml: false, mt: false, mr: false, mb: false,
        mtr: true
    }
};

// ==================== DOM СЕЛЕКТОРЫ ====================
export const SELECTORS = {
    LAYMENT_WIDTH: '#laymentWidth',
    LAYMENT_HEIGHT: '#laymentHeight',
    WORKSPACE_SCALE: '#workspaceScale',
    DELETE_BUTTON: '#deleteButton',
    ROTATE_BUTTON: '#rotateButton',
    EXPORT_BUTTON: '#exportButton',
    CONTOURS_LIST: '#contoursList',
    STATUS_INFO: '#status-info'
};

// ==================== СООБЩЕНИЯ ====================
export const MESSAGES = {
    LOADING_ERROR: 'Не удалось загрузить список артикулов',
    EXPORT_ERROR: 'Исправьте ошибки перед заказом!',
    COLLISION_ERROR: 'Ошибка: есть пересечения или выход за границы',
    VALID_LAYOUT: 'Раскладка валидна! Можно заказывать',
    EXPORT_SUCCESS: (width, height, area, cutting, total) => 
        `Готово к заказу!\n\nРазмер: ${width}×${height} мм\nПлощадь: ${area} м²\nРезка: ${cutting} м\n\nСтоимость: ${total} ₽`
};