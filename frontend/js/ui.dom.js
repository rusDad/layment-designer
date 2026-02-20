// ui.dom.js
// Единый доступ ко всем DOM-элементам приложения

window.UIDom = {
  inputs: {
    laymentPreset: document.getElementById('laymentPreset'),
    laymentWidth: document.getElementById('laymentWidth'),
    laymentHeight: document.getElementById('laymentHeight'),
    workspaceScale: document.getElementById('workspaceScale'),
    baseMaterialColor: document.getElementById('baseMaterialColor'),
    primitiveWidth: document.getElementById('primitiveWidth'),
    primitiveHeight: document.getElementById('primitiveHeight'),
    primitiveRadius: document.getElementById('primitiveRadius'),
  },

  buttons: {
    delete: document.getElementById('deleteButton'),
    rotate: document.getElementById('rotateButton'),
    addRect: document.getElementById('addRectButton'),
    addCircle: document.getElementById('addCircleButton'),
    saveWorkspace: document.getElementById('saveWorkspaceButton'),
    loadWorkspace: document.getElementById('loadWorkspaceButton'),
    export: document.getElementById('exportButton'),
    check: document.getElementById('checkLayoutButton'),
    alignLeft: document.getElementById('alignLeftButton'),
    alignCenterX: document.getElementById('alignCenterXButton'),
    alignRight: document.getElementById('alignRightButton'),
    alignTop: document.getElementById('alignTopButton'),
    alignCenterY: document.getElementById('alignCenterYButton'),
    alignBottom: document.getElementById('alignBottomButton'),
    distributeHorizontalGaps: document.getElementById('distributeHorizontalGapsButton'),
    distributeVerticalGaps: document.getElementById('distributeVerticalGapsButton'),
    snapLeft: document.getElementById('snapLeftButton'),
    snapRight: document.getElementById('snapRightButton'),
    snapTop: document.getElementById('snapTopButton'),
    snapBottom: document.getElementById('snapBottomButton'),
  },

  panels: {
    catalogList: document.getElementById('catalogList'),
    toolButtons: document.querySelector('.tool-buttons'),
    primitiveControls: document.getElementById('primitiveControls'),
  },

  primitive: {
    typeLabel: document.getElementById('primitiveTypeLabel'),
    widthRow: document.getElementById('primitiveWidthRow'),
    heightRow: document.getElementById('primitiveHeightRow'),
    radiusRow: document.getElementById('primitiveRadiusRow'),
  },

  catalog: {
    nav: document.getElementById('catalogNav'),
    breadcrumbAll: document.getElementById('catalogBreadcrumbAll'),
    breadcrumbSeparator: document.getElementById('catalogBreadcrumbSeparator'),
    breadcrumbCurrent: document.getElementById('catalogBreadcrumbCurrent'),
    categorySelect: document.getElementById('categorySelect'),
    searchInput: document.getElementById('catalogSearch'),
  },



  orderResult: {
    container: document.getElementById('orderResult'),
    message: document.getElementById('orderResultMessage'),
    details: document.getElementById('orderResultDetails'),
    orderId: document.getElementById('orderResultOrderId'),
    paymentLink: document.getElementById('orderResultPaymentLink'),
    meta: document.getElementById('orderResultMeta'),
  },

  status: {
    info: document.getElementById('status-info'),
  }
};
