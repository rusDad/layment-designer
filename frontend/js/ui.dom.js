// ui.dom.js
// Единый доступ ко всем DOM-элементам приложения

window.UIDom = {
  inputs: {
    laymentPreset: document.getElementById('laymentPreset'),
    laymentWidth: document.getElementById('laymentWidth'),
    laymentHeight: document.getElementById('laymentHeight'),
    workspaceScale: document.getElementById('workspaceScale'),
    baseMaterialColor: document.getElementById('baseMaterialColor'),
    laymentThicknessMm: document.getElementById('laymentThicknessMm'),
    primitiveWidth: document.getElementById('primitiveWidth'),
    primitiveHeight: document.getElementById('primitiveHeight'),
    primitiveRadius: document.getElementById('primitiveRadius'),
  },

  buttons: {
    delete: document.getElementById('deleteButton'),
    toggleLock: document.getElementById('toggleLockButton'),
    group: document.getElementById('groupButton'),
    ungroup: document.getElementById('ungroupButton'),
    rotate: document.getElementById('rotateButton'),
    duplicate: document.getElementById('duplicateButton'),
    addRect: document.getElementById('addRectButton'),
    addCircle: document.getElementById('addCircleButton'),
    saveWorkspace: document.getElementById('saveWorkspaceButton'),
    loadWorkspace: document.getElementById('loadWorkspaceButton'),
    preview3d: document.getElementById('preview3dButton'),
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
    toolButtons: document.getElementById('workspaceAddTools'),
    primitiveControls: document.getElementById('primitiveControls'),
  },

  texts: {
    panel: document.getElementById('textControls'),
    list: document.getElementById('textList'),
    value: document.getElementById('textValue'),
    fontSize: document.getElementById('textFontSize'),
    angle: document.getElementById('textAngle'),
    kind: document.getElementById('textKind'),
    role: document.getElementById('textRole'),
    owner: document.getElementById('textOwner'),
    addFreeBtn: document.getElementById('addFreeTextBtn'),
    addAttachedBtn: document.getElementById('addAttachedTextBtn'),
    attachBtn: document.getElementById('attachTextBtn'),
    detachBtn: document.getElementById('detachTextBtn'),
    deleteBtn: document.getElementById('deleteTextBtn'),
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

  customerModal: {
    overlay: document.getElementById('customerModalOverlay'),
    dialog: document.getElementById('customerModalDialog'),
    nameInput: document.getElementById('customerNameInput'),
    contactInput: document.getElementById('customerContactInput'),
    feedback: document.getElementById('customerModalFeedback'),
    summaryMeta: document.getElementById('customerModalSummaryMeta'),
    summaryComposition: document.getElementById('customerModalSummaryComposition'),
    summaryEmpty: document.getElementById('customerModalSummaryEmpty'),
    confirmButton: document.getElementById('customerModalConfirmButton'),
    cancelButton: document.getElementById('customerModalCancelButton'),
  },

  orderResult: {
    container: document.getElementById('orderResult'),
    title: document.getElementById('orderResultTitle'),
    message: document.getElementById('orderResultMessage'),
    details: document.getElementById('orderResultDetails'),
    orderNumber: document.getElementById('orderResultOrderNumber'),
    orderId: document.getElementById('orderResultOrderId'),
    statusLinkRow: document.getElementById('orderResultStatusLinkRow'),
    paymentLink: document.getElementById('orderResultPaymentLink'),
    meta: document.getElementById('orderResultMeta'),
  },

  status: {
    info: document.getElementById('status-info'),
    hint: document.getElementById('status-hint'),
  }
};
