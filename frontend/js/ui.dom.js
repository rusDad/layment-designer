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
    contoursList: document.getElementById('contoursList'),
    toolButtons: document.querySelector('.tool-buttons'),
  },

  status: {
    info: document.getElementById('status-info'),
  }
};
