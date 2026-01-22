// ui.dom.js
// Единый доступ ко всем DOM-элементам приложения

window.UIDom = {
  inputs: {
    laymentWidth: document.getElementById('laymentWidth'),
    laymentHeight: document.getElementById('laymentHeight'),
    workspaceScale: document.getElementById('workspaceScale'),
  },

  buttons: {
    delete: document.getElementById('deleteButton'),
    rotate: document.getElementById('rotateButton'),
    addRect: document.getElementById('addRectButton'),
    addCircle: document.getElementById('addCircleButton'),
    export: document.getElementById('exportButton'),
    check: document.getElementById('checkLayoutButton'),
  },

  panels: {
    catalogList: document.getElementById('catalogList'),
    toolButtons: document.querySelector('.tool-buttons'),
  },

  catalog: {
    nav: document.getElementById('catalogNav'),
    breadcrumbAll: document.getElementById('catalogBreadcrumbAll'),
    breadcrumbSeparator: document.getElementById('catalogBreadcrumbSeparator'),
    breadcrumbCurrent: document.getElementById('catalogBreadcrumbCurrent'),
    categorySelect: document.getElementById('categorySelect'),
    searchInput: document.getElementById('catalogSearch'),
  },

  status: {
    info: document.getElementById('status-info'),
  }
};
