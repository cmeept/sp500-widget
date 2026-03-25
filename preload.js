const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  closeApp: () => ipcRenderer.send('close-app'),
  minimizeToTray: () => ipcRenderer.send('minimize-to-tray'),
  toggleExpand: () => ipcRenderer.send('toggle-expand'),

  // Window resizing
  resizeToContent: (height) => ipcRenderer.send('resize-to-content', height),
  resizeForStocks: (stockCount) => ipcRenderer.send('resize-for-stocks', stockCount),
  expandWindowWithHeight: (stockCount) => ipcRenderer.send('expand-window-with-height', stockCount),

  // Resize growing upward (bottom stays, top moves up)
  resizeUpward: (newHeight, collapsedY) => ipcRenderer.send('resize-upward', newHeight, collapsedY),
  restoreCollapsed: (collapsedY) => ipcRenderer.send('restore-collapsed', collapsedY),
  getWindowPosition: () => ipcRenderer.invoke('get-window-position'),

  // Form visibility
  showAddForm: () => ipcRenderer.send('show-add-form'),
  hideAddForm: () => ipcRenderer.send('hide-add-form'),
  showReduceForm: () => ipcRenderer.send('show-reduce-form'),
  hideReduceForm: () => ipcRenderer.send('hide-reduce-form'),

  // Portfolio persistence
  loadPortfolio: () => ipcRenderer.invoke('load-portfolio'),
  savePortfolio: (portfolio) => ipcRenderer.invoke('save-portfolio', portfolio),

  // Market data — all fetched through main process (cached + retry)
  getSP500Price: () => ipcRenderer.invoke('get-sp500-price'),
  getSparklineData: (mode) => ipcRenderer.invoke('get-sparkline-data', mode),
  getChartHistory: (symbol) => ipcRenderer.invoke('get-chart-history', symbol),
  getLongHistory: (symbol) => ipcRenderer.invoke('get-long-history', symbol),
  getLivePrices: (symbols) => ipcRenderer.invoke('get-live-prices', symbols),

  // Listeners from main process
  onSetExpanded: (callback) => {
    ipcRenderer.on('set-expanded', (_event, expanded) => callback(expanded));
  },
  onGetStockCountForExpand: (callback) => {
    ipcRenderer.on('get-stock-count-for-expand', () => callback());
  },
  onGetStockCount: (callback) => {
    ipcRenderer.on('get-stock-count', () => callback());
  }
});
