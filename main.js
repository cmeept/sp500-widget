const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Store = require('electron-store');

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// Persistent storage
const store = new Store({
  defaults: {
    collapsedPosition: null,
    expandedPosition: null,
    portfolio: { stocks: [], lastUpdated: null },
    displayCurrency: 'ILS',
    migrated: false
  }
});

// ============================================================
// Migration from old version (v1.0.0 JSON files → electron-store)
// ============================================================

function migrateFromOldVersion() {
  if (store.get('migrated')) return;

  const homedir = os.homedir();
  const oldPortfolioPath = path.join(homedir, '.sp500-widget-portfolio.json');
  const oldConfigPath = path.join(homedir, '.sp500-widget-config.json');

  try {
    // Migrate portfolio data
    if (fs.existsSync(oldPortfolioPath)) {
      const data = JSON.parse(fs.readFileSync(oldPortfolioPath, 'utf8'));
      if (data && data.stocks && data.stocks.length > 0) {
        // Only migrate if new store has no stocks yet
        const current = store.get('portfolio', { stocks: [] });
        if (current.stocks.length === 0) {
          store.set('portfolio', data);
          console.log(`Migrated ${data.stocks.length} stocks from old portfolio`);
        }
      }
      // Remove old file after successful migration
      fs.unlinkSync(oldPortfolioPath);
    }

    // Migrate window position
    if (fs.existsSync(oldConfigPath)) {
      const config = JSON.parse(fs.readFileSync(oldConfigPath, 'utf8'));
      if (config.collapsedPosition && !store.get('collapsedPosition')) {
        store.set('collapsedPosition', config.collapsedPosition);
      }
      if (config.expandedPosition && !store.get('expandedPosition')) {
        store.set('expandedPosition', config.expandedPosition);
      }
      // Remove old file
      fs.unlinkSync(oldConfigPath);
    }

    // Clean up temp file
    const oldTempPath = path.join(homedir, '.sp500-widget-temp.json');
    if (fs.existsSync(oldTempPath)) fs.unlinkSync(oldTempPath);

  } catch (err) {
    console.error('Migration error (non-critical):', err.message);
  }

  store.set('migrated', true);
}

migrateFromOldVersion();

let tray = null;
let mainWindow = null;
let isExpanded = false;

const WIDGET_WIDTH = 290;
const COLLAPSED_HEIGHT = 220;
const BASE_EXPANDED_HEIGHT = 250;
const FORM_HEIGHT = 120;
const STOCK_ITEM_HEIGHT = 22;

// ============================================================
// Data cache — avoid hammering Yahoo Finance
// ============================================================

const cache = new Map();

function getCached(key, maxAgeMs) {
  const entry = cache.get(key);
  if (entry && (Date.now() - entry.time) < maxAgeMs) return entry.data;
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}

// ============================================================
// Fetch with retry
// ============================================================

async function fetchWithRetry(url, retries = 2, delayMs = 1000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
}

// ============================================================
// Window helpers
// ============================================================

function getMaxWindowHeight() {
  const { height } = screen.getPrimaryDisplay().workAreaSize;
  return Math.max(400, height - 100);
}

function getScreenBounds() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return { screenWidth: width, screenHeight: height };
}

function clampPosition(x, y, windowWidth, windowHeight) {
  const { screenWidth, screenHeight } = getScreenBounds();
  return {
    x: Math.max(0, Math.min(x, screenWidth - windowWidth)),
    y: Math.max(0, Math.min(y, screenHeight - windowHeight))
  };
}

function calcExpandedHeight(stockCount) {
  return Math.min(BASE_EXPANDED_HEIGHT + stockCount * STOCK_ITEM_HEIGHT, getMaxWindowHeight());
}

function savePosition(expanded) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [x, y] = mainWindow.getPosition();
  store.set(expanded ? 'expandedPosition' : 'collapsedPosition', { x, y });
}

function resizeWindow(height) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [currentX, currentY] = mainWindow.getPosition();
  const { x, y } = clampPosition(currentX, currentY, WIDGET_WIDTH, height);
  mainWindow.setBounds({ x, y, width: WIDGET_WIDTH, height });
}

function resizeForStockCount(stockCount, extraHeight = 0) {
  if (!mainWindow || mainWindow.isDestroyed() || !isExpanded) return;
  const height = Math.min(
    BASE_EXPANDED_HEIGHT + stockCount * STOCK_ITEM_HEIGHT + extraHeight,
    getMaxWindowHeight()
  );
  resizeWindow(height);
  savePosition(isExpanded);
}

function resizeForStockCountFromRenderer(extraHeight) {
  if (!mainWindow || mainWindow.isDestroyed() || !isExpanded) return;
  mainWindow.webContents.executeJavaScript('window.__getStockCount ? window.__getStockCount() : 0')
    .then(count => resizeForStockCount(count, extraHeight))
    .catch(() => {});
}

// ============================================================
// IPC — Window controls & resizing
// ============================================================

ipcMain.on('close-app', () => {
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.destroy(); mainWindow = null; }
  app.quit();
});

ipcMain.on('minimize-to-tray', () => { if (mainWindow) mainWindow.hide(); });

ipcMain.on('resize-to-content', (_event, height) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  resizeWindow((!isExpanded && height !== COLLAPSED_HEIGHT) ? COLLAPSED_HEIGHT : height);
});

// Resize upward: bottom edge stays fixed, window grows up
// collapsedY = the Y position when detail was first opened (bottom anchor)
ipcMain.on('resize-upward', (_event, newHeight, collapsedY) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [currentX] = mainWindow.getPosition();
  // Bottom edge = collapsedY + COLLAPSED_HEIGHT. New top = bottom - newHeight.
  const bottomEdge = collapsedY + COLLAPSED_HEIGHT;
  const newY = Math.max(0, bottomEdge - newHeight);
  mainWindow.setBounds({ x: currentX, y: newY, width: WIDGET_WIDTH, height: newHeight });
});

// Restore to collapsed height at original position
ipcMain.on('restore-collapsed', (_event, collapsedY) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [currentX] = mainWindow.getPosition();
  const y = collapsedY != null ? collapsedY : currentX;
  mainWindow.setBounds({ x: currentX, y: y, width: WIDGET_WIDTH, height: COLLAPSED_HEIGHT });
});

ipcMain.on('resize-for-stocks', (_event, stockCount) => resizeForStockCount(stockCount));

ipcMain.on('expand-window-with-height', (_event, stockCount) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const height = calcExpandedHeight(stockCount);
  const { screenWidth, screenHeight } = getScreenBounds();
  const x = Math.max(0, Math.min(Math.floor((screenWidth - WIDGET_WIDTH) / 2), screenWidth - WIDGET_WIDTH));
  const y = Math.max(0, Math.min(Math.floor((screenHeight - height) / 2), screenHeight - height));
  mainWindow.setBounds({ x, y, width: WIDGET_WIDTH, height });
  savePosition(isExpanded);
});

ipcMain.handle('get-window-position', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { x: 0, y: 0 };
  const [x, y] = mainWindow.getPosition();
  return { x, y };
});

ipcMain.on('show-add-form', () => resizeForStockCountFromRenderer(FORM_HEIGHT));
ipcMain.on('hide-add-form', () => resizeForStockCountFromRenderer(0));
ipcMain.on('show-reduce-form', () => resizeForStockCountFromRenderer(FORM_HEIGHT));
ipcMain.on('hide-reduce-form', () => resizeForStockCountFromRenderer(0));

ipcMain.on('toggle-expand', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [currentX, currentY] = mainWindow.getPosition();
  isExpanded = !isExpanded;

  if (isExpanded) {
    store.set('collapsedPosition', { x: currentX, y: currentY });
    mainWindow.webContents.send('get-stock-count-for-expand');
  } else {
    const pos = store.get('collapsedPosition');
    if (pos) {
      mainWindow.setBounds({ x: pos.x, y: pos.y, width: WIDGET_WIDTH, height: COLLAPSED_HEIGHT });
    } else {
      mainWindow.setBounds({ x: currentX, y: currentY, width: WIDGET_WIDTH, height: COLLAPSED_HEIGHT });
    }
    savePosition(isExpanded);
  }
});

// ============================================================
// IPC — Portfolio persistence
// ============================================================

ipcMain.handle('load-portfolio', async () => {
  return store.get('portfolio', { stocks: [], lastUpdated: null });
});

ipcMain.handle('save-portfolio', async (_event, portfolio) => {
  try {
    store.set('portfolio', { ...portfolio, lastUpdated: new Date().toISOString() });
    return true;
  } catch { return false; }
});

// ============================================================
// IPC — Market data (all fetches go through main process)
// ============================================================

// Get current S&P 500 price + extended hours (cache 10s)
ipcMain.handle('get-sp500-price', async () => {
  const cacheKey = 'sp500-price';
  const cached = getCached(cacheKey, 10_000);
  if (cached) return cached;

  try {
    // Fetch S&P 500 index + ES futures (for pre/post market)
    const [spData, futData] = await Promise.all([
      fetchWithRetry('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=1d&interval=1m'),
      fetchWithRetry('https://query1.finance.yahoo.com/v8/finance/chart/ES%3DF?range=1d&interval=1m').catch(() => null)
    ]);

    const result = spData.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    const currentPrice = meta.regularMarketPrice || meta.previousClose;
    const previousClose = meta.previousClose;

    // Extended hours from S&P futures (ES=F)
    let extendedPrice = null;
    let extendedChange = null;
    if (futData?.chart?.result?.[0]) {
      const futMeta = futData.chart.result[0].meta;
      extendedPrice = futMeta.regularMarketPrice;
      if (extendedPrice && previousClose) {
        extendedChange = ((extendedPrice - currentPrice) / currentPrice) * 100;
      }
    }

    const payload = {
      price: currentPrice,
      previousClose,
      change: currentPrice - previousClose,
      changePercent: ((currentPrice - previousClose) / previousClose) * 100,
      extendedPrice,
      extendedChange,
      timestamp: Date.now()
    };
    setCache(cacheKey, payload);
    return payload;
  } catch {
    return getCached(cacheKey, 120_000) || null; // stale cache up to 2 min
  }
});

// Get intraday / weekly sparkline data (cache 60s)
ipcMain.handle('get-sparkline-data', async (_event, mode) => {
  // mode: '1D' = today 1-min candles, '1W' = 5 days 5-min candles
  const cacheKey = `sparkline-${mode}`;
  const cached = getCached(cacheKey, 60_000);
  if (cached) return cached;

  try {
    const params = mode === '1W'
      ? 'range=5d&interval=5m'
      : 'range=1d&interval=2m';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?${params}`;
    const data = await fetchWithRetry(url);
    const result = data.chart?.result?.[0];
    if (!result) return null;

    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0];
    const closes = quotes?.close || [];
    const previousClose = result.meta?.previousClose || result.meta?.chartPreviousClose;

    // Filter out null values
    const points = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null && closes[i] > 0) {
        points.push({ t: timestamps[i], p: closes[i] });
      }
    }

    const payload = { points, previousClose, fetchedAt: Date.now() };
    setCache(cacheKey, payload);
    return payload;
  } catch {
    return getCached(cacheKey, 300_000) || null;
  }
});

// Get portfolio sparkline — combine multiple symbols (cache 30s)
ipcMain.handle('get-portfolio-sparkline', async (_event, holdings, mode) => {
  const cacheKey = `port-spark-${mode}`;
  const cached = getCached(cacheKey, 30_000);
  if (cached) return cached;

  try {
    const params = mode === 'MY1W' ? 'range=5d&interval=5m' : 'range=1d&interval=2m';

    // Fetch all holdings in parallel
    const results = await Promise.allSettled(
      holdings.map(async (h) => {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(h.symbol)}?${params}`;
        const data = await fetchWithRetry(url, 1, 500);
        const result = data.chart?.result?.[0];
        if (!result) return null;
        return {
          symbol: h.symbol,
          shares: h.shares,
          timestamps: result.timestamp || [],
          closes: result.indicators?.quote?.[0]?.close || [],
          previousClose: result.meta?.previousClose || result.meta?.chartPreviousClose || 0
        };
      })
    );

    const stocks = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);

    if (stocks.length === 0) return null;

    // Use the stock with most data points as the time axis
    const primary = stocks.reduce((a, b) => a.timestamps.length > b.timestamps.length ? a : b);
    const points = [];
    let prevTotal = 0;

    // Calculate previous close total
    for (const s of stocks) {
      const price = s.previousClose || 0;
      const isTA = s.symbol.endsWith('.TA');
      prevTotal += s.shares * (isTA ? price / 100 : price);
    }

    for (let i = 0; i < primary.timestamps.length; i++) {
      const t = primary.timestamps[i];
      let total = 0;

      for (const s of stocks) {
        // Find closest timestamp in this stock's data
        let closeIdx = 0;
        for (let j = 0; j < s.timestamps.length; j++) {
          if (s.timestamps[j] <= t) closeIdx = j;
          else break;
        }
        const price = s.closes[closeIdx];
        if (price && price > 0) {
          const isTA = s.symbol.endsWith('.TA');
          total += s.shares * (isTA ? price / 100 : price);
        }
      }

      if (total > 0) points.push({ t, p: total });
    }

    const payload = { points, previousClose: prevTotal, fetchedAt: Date.now() };
    setCache(cacheKey, payload);
    return payload;
  } catch {
    return getCached(cacheKey, 120_000) || null;
  }
});

// Get 1-year historical data for a symbol (cache 5 min)
ipcMain.handle('get-chart-history', async (_event, symbol) => {
  const cacheKey = `history-${symbol}`;
  const cached = getCached(cacheKey, 300_000); // 5 min
  if (cached) return cached;

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
    const data = await fetchWithRetry(url);
    const result = data.chart?.result?.[0];
    if (!result) return null;

    const payload = {
      timestamps: result.timestamp,
      prices: result.indicators.adjclose[0].adjclose,
      fetchedAt: Date.now()
    };
    setCache(cacheKey, payload);
    return payload;
  } catch {
    return getCached(cacheKey, 600_000) || null; // stale cache up to 10 min
  }
});

// Get USD/ILS exchange rate (cache 60s)
ipcMain.handle('get-usd-ils-rate', async () => {
  const cacheKey = 'usd-ils';
  const cached = getCached(cacheKey, 60_000);
  if (cached) return cached;

  try {
    const data = await fetchWithRetry('https://query1.finance.yahoo.com/v8/finance/chart/ILS%3DX?range=1d&interval=1d');
    const rate = data.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (rate) {
      setCache(cacheKey, rate);
      return rate;
    }
    return getCached(cacheKey, 300_000) || 3.12;
  } catch {
    return getCached(cacheKey, 300_000) || 3.12;
  }
});

// Get EUR/ILS exchange rate (cache 60s)
ipcMain.handle('get-eur-ils-rate', async () => {
  const cacheKey = 'eur-ils';
  const cached = getCached(cacheKey, 60_000);
  if (cached) return cached;

  try {
    const data = await fetchWithRetry('https://query1.finance.yahoo.com/v8/finance/chart/EURILS%3DX?range=1d&interval=1d');
    const rate = data.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (rate) { setCache(cacheKey, rate); return rate; }
    return getCached(cacheKey, 300_000) || 3.45;
  } catch {
    return getCached(cacheKey, 300_000) || 3.45;
  }
});

// TASE catalog for search
ipcMain.handle('get-tase-catalog', async () => {
  try {
    const catalogPath = path.join(__dirname, 'securities-catalog.json');
    return JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  } catch { return []; }
});

// Currency preference
ipcMain.handle('get-display-currency', async () => store.get('displayCurrency', 'ILS'));
ipcMain.handle('set-display-currency', async (_event, currency) => {
  store.set('displayCurrency', currency);
  return true;
});

// Get 15-year monthly history for multi-year view (cache 30 min)
ipcMain.handle('get-long-history', async (_event, symbol) => {
  const cacheKey = `long-history-${symbol}`;
  const cached = getCached(cacheKey, 1_800_000); // 30 min
  if (cached) return cached;

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=15y&interval=1mo`;
    const data = await fetchWithRetry(url);
    const result = data.chart?.result?.[0];
    if (!result) return null;

    const payload = {
      timestamps: result.timestamp,
      prices: result.indicators.adjclose[0].adjclose,
      fetchedAt: Date.now()
    };
    setCache(cacheKey, payload);
    return payload;
  } catch {
    return getCached(cacheKey, 3_600_000) || null; // stale cache up to 1 hour
  }
});

// Get live prices for multiple symbols in parallel (cache 10s each)
ipcMain.handle('get-live-prices', async (_event, symbols) => {
  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const cacheKey = `price-${symbol}`;
      const cached = getCached(cacheKey, 10_000);
      if (cached) return { symbol, data: cached };

      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
      const data = await fetchWithRetry(url, 1, 500);

      if (data.chart?.result?.[0]) {
        const meta = data.chart.result[0].meta;
        const currentPrice = meta.regularMarketPrice || meta.previousClose;
        const previousClose = meta.previousClose;
        const payload = {
          price: currentPrice,
          change: currentPrice - previousClose,
          changePercent: ((currentPrice - previousClose) / previousClose) * 100
        };
        setCache(cacheKey, payload);
        return { symbol, data: payload };
      }
      return { symbol, data: null };
    })
  );

  const prices = {};
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      prices[r.value.symbol] = r.value.data;
    }
  }
  return prices;
});

// ============================================================
// Autostart
// ============================================================

function setupAutostart() {
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: false,
      name: 'S&P 500 Widget',
      path: process.execPath
    });
  } catch { /* not available on this platform */ }
}

// ============================================================
// Tray
// ============================================================

function createTray() {
  const trayIconPath = path.join(__dirname, 'icons', 'sp500_cool_transparent_32x32.png');
  const trayIcon = nativeImage.createFromPath(trayIconPath);
  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Widget', click: () => showWidget() },
    { label: 'Hide Widget', click: () => hideWidget() },
    { type: 'separator' },
    {
      label: 'About',
      click: () => {
        dialog.showMessageBox(null, {
          type: 'info',
          title: 'About',
          message: 'S&P 500 Widget v1.0.0',
          detail: 'Desktop widget for S&P 500 tracking and portfolio management.\n\nFeatures:\n\u2022 S&P 500 index tracking\n\u2022 Portfolio management\n\u2022 Live quotes\n\u2022 Auto-start with Windows'
        });
      }
    },
    { type: 'separator' },
    { label: 'Exit', click: () => app.quit() }
  ]);

  tray.setToolTip('S&P 500 Widget - Market Tracker');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow && mainWindow.isVisible() && !mainWindow.isDestroyed()) hideWidget();
    else showWidget();
  });
}

// ============================================================
// Window
// ============================================================

function showWidget() {
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); return; }
  createWindow();
}

function hideWidget() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
}

function loadWindowPosition() {
  const pos = store.get('collapsedPosition');
  const { screenWidth, screenHeight } = getScreenBounds();
  if (pos && pos.x >= 0 && pos.y >= 0 &&
      pos.x <= screenWidth - WIDGET_WIDTH &&
      pos.y <= screenHeight - COLLAPSED_HEIGHT) {
    return pos;
  }
  return { x: screenWidth - WIDGET_WIDTH - 20, y: screenHeight - COLLAPSED_HEIGHT - 20 };
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.destroy(); mainWindow = null; }
  isExpanded = false;
  const pos = loadWindowPosition();

  mainWindow = new BrowserWindow({
    width: WIDGET_WIDTH,
    height: COLLAPSED_HEIGHT,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: false,
    icon: path.join(__dirname, 'icons', 'sp500_cool_transparent_ico256.ico'),
    titleBarStyle: 'hidden',
    title: '',
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: process.argv.includes('--dev')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    isExpanded = false;
    mainWindow.webContents.send('set-expanded', false);
  });
  mainWindow.on('move', () => savePosition(isExpanded));
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ============================================================
// App lifecycle
// ============================================================

app.whenReady().then(() => { createTray(); showWidget(); setupAutostart(); });

app.on('second-instance', () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  else showWidget();
});

app.on('window-all-closed', (e) => e.preventDefault());

app.on('before-quit', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    savePosition(isExpanded);
    mainWindow.destroy();
    mainWindow = null;
  }
});
