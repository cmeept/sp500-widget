// renderer.js — widget frontend logic
// All data fetched via main process (cached + retry). No direct network calls.

const api = window.electronAPI;

// --- DOM references ---
const el = {
  loading: document.getElementById('loading'),
  content: document.getElementById('content'),
  currentPrice: document.getElementById('currentPrice'),
  dayChange: document.getElementById('dayChange'),
  updateTime: document.getElementById('updateTime'),
  expandBtn: document.getElementById('expandBtn'),
  closeBtn: document.getElementById('closeBtn'),
  portfolioSection: document.getElementById('portfolioSection'),
  portfolioTotal: document.getElementById('portfolioTotal'),
  portfolioPnL: document.getElementById('portfolioPnL'),
  stocksList: document.getElementById('stocksList'),
  addStockBtn: document.getElementById('addStockBtn'),
  reduceStockBtn: document.getElementById('reduceStockBtn'),
  addStockForm: document.getElementById('addStockForm'),
  reduceStockForm: document.getElementById('reduceStockForm'),
  reduceStockSymbol: document.getElementById('reduceStockSymbol'),
  currentShares: document.getElementById('currentShares'),
  sellShares: document.getElementById('sellShares'),
  reduceStockSubmit: document.getElementById('reduceStockSubmit'),
  reduceStockCancel: document.getElementById('reduceStockCancel'),
  sp500Data: document.getElementById('sp500Data'),
  portfolioSummary: document.getElementById('portfolioSummary'),
  trendIndicators: document.getElementById('trendIndicators'),
  weekChange: document.getElementById('weekChange'),
  monthChange: document.getElementById('monthChange'),
  yearChange: document.getElementById('yearChange'),
  marketStatus: document.getElementById('marketStatus'),
  sparklineCanvas: document.getElementById('sparklineCanvas'),
  sparklineToggle: document.getElementById('sparklineToggle'),
  trendWeek: document.getElementById('trendWeek'),
  trendMonth: document.getElementById('trendMonth'),
  trendYear: document.getElementById('trendYear'),
  trendDetail: document.getElementById('trendDetail'),
  statusDot: document.getElementById('statusDot'),
  currencyBtn: document.getElementById('currencyBtn')
};

// Dynamic form elements (recreated each time form opens)
let formEls = {};

let portfolio = { stocks: [], lastUpdated: null };
let isExpanded = false;
let currentTrendMode = 'sp500';
let sparklineMode = '1D'; // '1D', '1W', 'MY1D', 'MY1W'
let activeTrendDetail = null; // 'week' | 'month' | 'year' | 'multiyear' | null
let displayCurrency = 'ILS'; // 'ILS' or 'USD'
let usdIlsRate = 3.12; // updated live
let eurIlsRate = 3.45; // updated live
let cashBalances = { ILS: 0, USD: 0, EUR: 0 }; // cash not invested
let detailCollapsedY = null; // saved Y position before detail opened
let lastSuccessfulUpdate = 0;

// Expose stock count for main process
window.__getStockCount = () => portfolio.stocks.length;

// ============================================================
// Status indicator
// ============================================================

function setStatus(state) {
  // state: 'ok' | 'stale' | 'offline'
  const dot = el.statusDot;
  if (!dot) return;
  dot.className = 'status-dot status-' + state;
  dot.title = state === 'ok' ? 'Live data'
    : state === 'stale' ? 'Data may be delayed'
    : 'No connection';
}

function checkDataFreshness() {
  if (!lastSuccessfulUpdate) return setStatus('offline');
  const age = Date.now() - lastSuccessfulUpdate;
  if (age < 30_000) setStatus('ok');
  else if (age < 120_000) setStatus('stale');
  else setStatus('offline');
}

// ============================================================
// Event listeners
// ============================================================

el.closeBtn.addEventListener('click', (e) => { e.stopPropagation(); api.closeApp(); });
el.expandBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePortfolio(); });
el.addStockBtn.addEventListener('click', (e) => { e.stopPropagation(); showAddStockForm(); });
el.reduceStockBtn.addEventListener('click', (e) => { e.stopPropagation(); showReduceStockForm(); });
el.reduceStockSubmit.addEventListener('click', (e) => { e.stopPropagation(); reduceStockFromForm(); });
el.reduceStockCancel.addEventListener('click', (e) => { e.stopPropagation(); hideReduceStockForm(); });

el.reduceStockSymbol.addEventListener('change', (e) => {
  const sym = e.target.value;
  if (sym) {
    const stock = portfolio.stocks.find(s => s.symbol === sym);
    if (stock) { el.currentShares.value = stock.shares; el.sellShares.max = stock.shares; el.sellShares.focus(); }
  } else { el.currentShares.value = ''; el.sellShares.max = ''; }
});

el.cashBtn = document.getElementById('cashBtn');
el.cashBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  showCashForm();
});

el.currencyBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  // Cycle: ILS → USD → EUR → ILS
  if (displayCurrency === 'ILS') displayCurrency = 'USD';
  else if (displayCurrency === 'USD') displayCurrency = 'EUR';
  else displayCurrency = 'ILS';

  const symbols = { ILS: '\u20aa', USD: '$', EUR: '\u20ac' };
  el.currencyBtn.textContent = symbols[displayCurrency];
  await api.setDisplayCurrency(displayCurrency);
  await refreshPortfolioPrices();
});

const sparklineModes = ['1D', '1W', 'MY1D', 'MY1W'];
const sparklineLabels = { '1D': 'S&P 1D', '1W': 'S&P 1W', 'MY1D': 'My 1D', 'MY1W': 'My 1W' };

el.sparklineToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  const idx = sparklineModes.indexOf(sparklineMode);
  sparklineMode = sparklineModes[(idx + 1) % sparklineModes.length];
  el.sparklineToggle.textContent = sparklineLabels[sparklineMode];
  updateSparkline();
});

el.sp500Data.addEventListener('click', (e) => { e.stopPropagation(); if (!isExpanded) showTrendIndicators('sp500'); });
el.portfolioSummary.addEventListener('click', (e) => { e.stopPropagation(); if (!isExpanded) showTrendIndicators('portfolio'); });

// Trend detail toggles
el.trendWeek.addEventListener('click', (e) => { e.stopPropagation(); toggleTrendDetail('week'); });
el.trendMonth.addEventListener('click', (e) => { e.stopPropagation(); toggleTrendDetail('month'); });
el.trendYear.addEventListener('click', (e) => { e.stopPropagation(); toggleTrendDetail('year'); });

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (el.addStockForm.classList.contains('visible')) hideAddStockForm();
    else if (el.reduceStockForm.classList.contains('visible')) hideReduceStockForm();
  } else if (e.key === 'Enter') {
    if (el.addStockForm.classList.contains('visible')) { e.preventDefault(); addStock(); }
    else if (el.reduceStockForm.classList.contains('visible')) { e.preventDefault(); reduceStockFromForm(); }
  }
});

// ============================================================
// IPC listeners from main process
// ============================================================

api.onSetExpanded((expanded) => {
  isExpanded = expanded;
  el.expandBtn.textContent = isExpanded ? '\u2212' : '+';
  el.expandBtn.title = isExpanded ? 'Collapse portfolio' : 'Expand portfolio';
  if (isExpanded) { el.portfolioSection.classList.add('expanded'); loadAndUpdatePortfolio(); }
  else el.portfolioSection.classList.remove('expanded');
});

api.onGetStockCountForExpand(() => api.expandWindowWithHeight(portfolio.stocks.length));
api.onGetStockCount(() => api.resizeForStocks(portfolio.stocks.length));

// ============================================================
// Portfolio toggle
// ============================================================

function togglePortfolio() {
  isExpanded = !isExpanded;
  el.expandBtn.textContent = isExpanded ? '\u2212' : '+';
  el.expandBtn.title = isExpanded ? 'Collapse portfolio' : 'Expand portfolio';
  const container = document.querySelector('.widget-container');

  if (isExpanded) {
    el.portfolioSection.classList.add('expanded');
    container.classList.add('expanded');
    el.trendIndicators.style.display = 'none';
    hideTrendDetail();
    loadAndUpdatePortfolio();
  } else {
    el.portfolioSection.classList.remove('expanded');
    container.classList.remove('expanded');
    hideAddStockForm();
    hideReduceStockForm();
    refreshTrends();
    el.trendIndicators.style.display = 'grid';
  }
  resizeWindowToContent();
  api.toggleExpand();
}

function resizeWindowToContent() {
  const container = document.querySelector('.widget-container');
  if (!container) return;
  setTimeout(() => {
    const height = isExpanded ? Math.max(container.scrollHeight, container.offsetHeight) : 220;
    api.resizeToContent(height);
  }, 350);
}

// ============================================================
// Add Stock Form
// ============================================================

async function showAddStockForm() {
  if (el.reduceStockForm.classList.contains('visible')) hideReduceStockForm();
  await recreateAddStockForm();
  el.addStockForm.classList.add('visible');
  setTimeout(() => { if (formEls.stockSymbol) { formEls.stockSymbol.focus(); formEls.stockSymbol.select(); } }, 100);
  setTimeout(() => resizeWindowToContent(), 100);
  api.showAddForm();
}

let securitiesCatalog = [];

async function recreateAddStockForm() {
  // Load catalog if not loaded
  if (securitiesCatalog.length === 0) {
    try { securitiesCatalog = await api.getTaseCatalog() || []; } catch {}
  }

  el.addStockForm.innerHTML = `
    <div class="form-title">Add Stock to Portfolio</div>
    <div class="form-row">
      <div class="form-group" style="flex: 1; position: relative;">
        <div class="form-label">Search or enter ticker</div>
        <input type="text" id="stockSearch" class="form-input" placeholder="S&P 500, NASDAQ, Gold..." style="text-align:left;">
        <div id="searchResults" style="display:none;position:absolute;top:100%;left:0;right:0;max-height:150px;overflow-y:auto;background:rgba(15,15,35,0.98);border:1px solid rgba(255,255,255,0.2);border-radius:6px;z-index:100;margin-top:2px;"></div>
      </div>
    </div>
    <div id="selectedTicker" style="display:none;font-size:10px;color:#4ade80;font-weight:600;padding:2px 0;"></div>
    <div class="form-row">
      <div class="form-group" style="flex: 0 0 80px;">
        <div class="form-label">Ticker</div>
        <input type="text" id="stockSymbol" class="form-input" placeholder="SPY" maxlength="20">
      </div>
      <div class="form-group" style="flex: 0 0 50px;">
        <div class="form-label">Qty</div>
        <input type="number" id="stockShares" class="form-input" placeholder="10" min="0" step="0.01">
      </div>
      <div class="form-group" style="flex: 1;">
        <div class="form-label">Price</div>
        <input type="number" id="stockPrice" class="form-input" placeholder="Auto" min="0" step="0.000001">
      </div>
    </div>
    <div class="form-row" style="margin-top: 4px;">
      <button id="addStockSubmit" class="form-btn">Add</button>
      <button id="addStockCancel" class="form-btn cancel">Cancel</button>
    </div>
  `;

  formEls.stockSymbol = document.getElementById('stockSymbol');
  formEls.stockShares = document.getElementById('stockShares');
  formEls.stockPrice = document.getElementById('stockPrice');
  const searchInput = document.getElementById('stockSearch');
  const searchResults = document.getElementById('searchResults');
  const selectedTicker = document.getElementById('selectedTicker');

  // Search logic
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (q.length < 1) { searchResults.style.display = 'none'; return; }

    const matches = securitiesCatalog.filter(s =>
      s.n.toLowerCase().includes(q) || s.t.toLowerCase().includes(q) || s.c.toLowerCase().includes(q)
    ).slice(0, 15);

    if (matches.length === 0) {
      searchResults.style.display = 'none';
      return;
    }

    searchResults.innerHTML = matches.map(s => `
      <div class="search-result-item" data-ticker="${s.t}" style="padding:4px 8px;cursor:pointer;font-size:10px;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;">
        <span style="color:white;font-weight:600;">${s.n}</span>
        <span style="color:rgba(255,255,255,0.4);font-size:9px;">${s.t}</span>
      </div>
    `).join('');
    searchResults.style.display = 'block';

    searchResults.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const ticker = item.dataset.ticker;
        const name = item.querySelector('span').textContent;
        formEls.stockSymbol.value = ticker;
        selectedTicker.textContent = `${name} (${ticker})`;
        selectedTicker.style.display = 'block';
        searchResults.style.display = 'none';
        searchInput.value = '';
        formEls.stockShares.focus();
      });
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(74,222,128,0.15)'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'none'; });
    });
  });

  // Hide results on blur
  searchInput.addEventListener('blur', () => { setTimeout(() => { searchResults.style.display = 'none'; }, 200); });

  document.getElementById('addStockSubmit').addEventListener('click', (e) => { e.stopPropagation(); addStock(); });
  document.getElementById('addStockCancel').addEventListener('click', (e) => { e.stopPropagation(); hideAddStockForm(); });

  // Tab navigation
  formEls.stockSymbol.addEventListener('keydown', (e) => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); formEls.stockShares.focus(); } });
  formEls.stockShares.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); formEls.stockPrice.focus(); }
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); formEls.stockSymbol.focus(); }
  });
  formEls.stockPrice.addEventListener('keydown', (e) => { if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); formEls.stockShares.focus(); } });
}

function hideAddStockForm() {
  el.addStockForm.classList.remove('visible');
  setTimeout(() => resizeWindowToContent(), 100);
  api.hideAddForm();
}

// ============================================================
// Reduce Stock Form
// ============================================================

function showReduceStockForm() {
  if (el.addStockForm.classList.contains('visible')) hideAddStockForm();
  el.reduceStockSymbol.innerHTML = '<option value="">Select stock</option>';
  portfolio.stocks.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.symbol;
    opt.textContent = `${s.symbol} (${s.shares} pcs)`;
    el.reduceStockSymbol.appendChild(opt);
  });
  el.currentShares.value = '';
  el.sellShares.value = '';
  el.reduceStockForm.classList.add('visible');
  setTimeout(() => el.reduceStockSymbol.focus(), 100);
  setTimeout(() => resizeWindowToContent(), 100);
  api.showReduceForm();
}

function hideReduceStockForm() {
  el.reduceStockForm.classList.remove('visible');
  el.reduceStockSymbol.value = '';
  el.currentShares.value = '';
  el.sellShares.value = '';
  setTimeout(() => resizeWindowToContent(), 100);
  api.hideReduceForm();
}

async function reduceStockFromForm() {
  const sym = el.reduceStockSymbol.value;
  const sellAmount = parseFloat(el.sellShares.value);
  if (!sym) return showNotification('Select stock to sell', 'error');
  if (isNaN(sellAmount) || sellAmount <= 0) return showNotification('Enter valid quantity', 'error');
  const stock = portfolio.stocks.find(s => s.symbol === sym);
  if (!stock) return showNotification('Stock not found', 'error');
  if (sellAmount > stock.shares) return showNotification(`Max available: ${stock.shares}`, 'error');

  if (sellAmount >= stock.shares) portfolio.stocks = portfolio.stocks.filter(s => s.symbol !== sym);
  else stock.shares -= sellAmount;

  await savePortfolio();
  hideReduceStockForm();
  await refreshPortfolioPrices();
  if (isExpanded) api.resizeForStocks(portfolio.stocks.length);
}

// ============================================================
// Add Stock
// ============================================================

async function addStock() {
  const symbol = (formEls.stockSymbol?.value || '').trim().toUpperCase();
  const sharesStr = (formEls.stockShares?.value || '').trim();
  const priceStr = (formEls.stockPrice?.value || '').trim();

  if (!symbol || !sharesStr) return showNotification('Fill Symbol and Quantity', 'error');
  if (!/^[A-Z0-9.]+$/.test(symbol)) return showNotification('Invalid symbol', 'error');
  const shares = parseFloat(sharesStr);
  if (isNaN(shares) || shares <= 0) return showNotification('Quantity must be > 0', 'error');

  let price;
  if (!priceStr || priceStr.toLowerCase() === 'auto') {
    try {
      const livePrices = await api.getLivePrices([symbol]);
      if (livePrices[symbol]?.price) price = livePrices[symbol].price;
      else return showNotification('Cannot fetch price. Enter manually.', 'error');
    } catch { return showNotification('Network error. Enter price manually.', 'error'); }
  } else {
    price = parseFloat(priceStr);
    if (isNaN(price) || price <= 0) return showNotification('Invalid price', 'error');
  }

  const existing = portfolio.stocks.find(s => s.symbol === symbol);
  if (existing) {
    const totalShares = existing.shares + shares;
    const totalValue = (existing.shares * existing.avgPrice) + (shares * price);
    existing.shares = totalShares;
    existing.avgPrice = totalValue / totalShares;
  } else {
    portfolio.stocks.push({ symbol, shares, avgPrice: price, addedDate: new Date().toISOString() });
  }

  await savePortfolio();
  hideAddStockForm();
  await refreshPortfolioPrices();
  if (isExpanded) resizeWindowToContent();
}

// ============================================================
// Delete Stock
// ============================================================

async function deleteStock(symbol) {
  const confirmed = await showConfirmDialog(`Remove ${symbol}?`);
  if (!confirmed) return;
  portfolio.stocks = portfolio.stocks.filter(s => s.symbol !== symbol);
  await savePortfolio();
  await refreshPortfolioPrices();
  if (isExpanded) resizeWindowToContent();
}

// ============================================================
// Portfolio data
// ============================================================

async function loadPortfolio() {
  try { portfolio = await api.loadPortfolio(); }
  catch { portfolio = { stocks: [], lastUpdated: null }; }
  updatePortfolioDisplay();
  updatePortfolioSummary();
}

async function savePortfolio() {
  try { await api.savePortfolio(portfolio); }
  catch (err) { console.error('Save failed:', err); }
}

async function loadAndUpdatePortfolio() {
  await loadPortfolio();
  await refreshPortfolioPrices();
}

async function refreshPortfolioPrices() {
  if (portfolio.stocks.length === 0) { updatePortfolioDisplay(); updatePortfolioSummary(); return; }
  try {
    // Fetch exchange rates + live prices in parallel
    const [usdRate, eurRate, livePrices] = await Promise.all([
      api.getUsdIlsRate(),
      api.getEurIlsRate(),
      api.getLivePrices(portfolio.stocks.map(s => s.symbol))
    ]);
    if (usdRate) usdIlsRate = usdRate;
    if (eurRate) eurIlsRate = eurRate;
    applyLivePrices(livePrices);
    lastSuccessfulUpdate = Date.now();
    checkDataFreshness();
  } catch {
    updatePortfolioDisplay();
    checkDataFreshness();
  }
}

// Detect stock's native currency from symbol
function getStockCurrency(symbol) {
  if (symbol.endsWith('.TA')) return 'ILS';
  return 'USD';
}

// TASE (.TA) prices from Yahoo are in Agorot (1/100 shekel). Convert to shekel.
function normalizePrice(price, symbol) {
  if (symbol.endsWith('.TA')) return price / 100;
  return price;
}

// Convert any currency to ILS first, then to display currency
function toILS(amount, fromCurrency) {
  if (fromCurrency === 'ILS') return amount;
  if (fromCurrency === 'USD') return amount * usdIlsRate;
  if (fromCurrency === 'EUR') return amount * eurIlsRate;
  return amount;
}

function toDisplayCurrency(amount, fromCurrency) {
  const inILS = toILS(amount, fromCurrency);
  if (displayCurrency === 'ILS') return inILS;
  if (displayCurrency === 'USD') return inILS / usdIlsRate;
  if (displayCurrency === 'EUR') return inILS / eurIlsRate;
  return inILS;
}

function currencySymbol() {
  const symbols = { ILS: '\u20aa', USD: '$', EUR: '\u20ac' };
  return symbols[displayCurrency] || '\u20aa';
}

function applyLivePrices(livePrices) {
  let totalValue = 0, totalCost = 0, totalDayPnL = 0, totalPrevClose = 0;
  portfolio.stocks.forEach(stock => {
    const live = livePrices[stock.symbol];
    const nativeCurrency = getStockCurrency(stock.symbol);

    if (live?.price) {
      const price = normalizePrice(live.price, stock.symbol);
      const avgP = normalizePrice(stock.avgPrice, stock.symbol);
      stock.currentPrice = price;
      // Native currency values (in shekels for .TA, dollars for US)
      stock.nativeValue = stock.shares * price;
      stock.nativeCost = stock.shares * avgP;
      stock.unrealizedPnL = stock.nativeValue - stock.nativeCost;
      stock.unrealizedPnLPercent = stock.nativeCost > 0 ? (stock.unrealizedPnL / stock.nativeCost) * 100 : 0;

      // Daily P&L (from previous close)
      try {
        const prevClose = (live.change != null && live.change !== 0) ? (live.price - live.change) : live.price;
        const prevCloseNorm = normalizePrice(prevClose, stock.symbol);
        const dayPnLNative = stock.shares * (price - prevCloseNorm);
        stock.dayPnL = toDisplayCurrency(dayPnLNative, nativeCurrency);
        totalDayPnL += stock.dayPnL;
        totalPrevClose += toDisplayCurrency(stock.shares * prevCloseNorm, nativeCurrency);
      } catch { stock.dayPnL = 0; }
      // Convert to display currency for totals
      stock.displayValue = toDisplayCurrency(stock.nativeValue, nativeCurrency);
      stock.displayCost = toDisplayCurrency(stock.nativeCost, nativeCurrency);
    } else {
      const avgP = normalizePrice(stock.avgPrice, stock.symbol);
      stock.currentPrice = avgP;
      stock.nativeValue = stock.shares * avgP;
      stock.nativeCost = stock.nativeValue;
      stock.unrealizedPnL = 0;
      stock.unrealizedPnLPercent = 0;
      stock.dayPnL = 0;
      stock.displayValue = toDisplayCurrency(stock.nativeValue, nativeCurrency);
      stock.displayCost = stock.displayValue;
    }
    totalValue += stock.displayValue;
    totalCost += stock.displayCost;
  });

  // Add cash balances (ILS + USD + EUR)
  const cashInDisplay = toDisplayCurrency(cashBalances.ILS || 0, 'ILS')
                      + toDisplayCurrency(cashBalances.USD || 0, 'USD')
                      + toDisplayCurrency(cashBalances.EUR || 0, 'EUR');
  totalValue += cashInDisplay;
  totalCost += cashInDisplay; // cash doesn't have P&L

  const totalPnL = totalValue - totalCost;
  const totalPnLPercent = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;
  const dayPnLPercent = totalPrevClose > 0 ? (totalDayPnL / totalPrevClose) * 100 : 0;
  updatePortfolioDisplay();
  updatePortfolioSummary(totalValue, totalPnL, totalPnLPercent, totalDayPnL, dayPnLPercent);
}

// ============================================================
// Portfolio display
// ============================================================

function updatePortfolioSummary(totalValue = 0, totalPnL = 0, totalPnLPercent = 0, dayPnL = 0, dayPnLPercent = 0) {
  const sym = currencySymbol();
  el.portfolioTotal.textContent = `${sym}${Math.round(totalValue).toLocaleString()}`;

  const dayCls = dayPnL >= 0 ? 'positive' : 'negative';
  const daySign = dayPnL >= 0 ? '+' : '';
  const totCls = totalPnL >= 0 ? 'positive' : 'negative';
  const totSign = totalPnL >= 0 ? '+' : '';

  el.portfolioPnL.innerHTML =
    '<span class="' + dayCls + '" style="font-size:10px;">' + daySign + sym + Math.round(Math.abs(dayPnL)).toLocaleString() + ' (' + daySign + (dayPnLPercent || 0).toFixed(2) + '%)</span>' +
    '<br>' +
    '<span class="' + totCls + '" style="font-size:9px;opacity:0.7;">Total: ' + totSign + sym + Math.round(Math.abs(totalPnL)).toLocaleString() + ' (' + totSign + (totalPnLPercent || 0).toFixed(2) + '%)</span>';
  updateMarketOverviewLayout();
}

function updatePortfolioDisplay() {
  el.stocksList.innerHTML = '';
  updateMarketOverviewLayout();

  if (portfolio.stocks.length === 0) {
    el.stocksList.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.5);font-size:11px;padding:8px;">Add stocks to portfolio</div>';
    return;
  }
  el.stocksList.classList.toggle('scrollable', portfolio.stocks.length > 8);

  portfolio.stocks.forEach(stock => {
    const div = document.createElement('div');
    div.className = 'stock-item';
    const pnlClass = (stock.unrealizedPnL || 0) >= 0 ? 'positive' : 'negative';
    const pnlSign = (stock.unrealizedPnL || 0) >= 0 ? '+' : '';
    const value = stock.displayValue || toDisplayCurrency(stock.shares * normalizePrice(stock.avgPrice, stock.symbol), getStockCurrency(stock.symbol));
    const sym = currencySymbol();

    div.innerHTML = `
      <div class="stock-symbol">${stock.symbol}</div>
      <div class="stock-shares">${stock.shares}</div>
      <div class="stock-value ${pnlClass}">
        ${sym}${Math.round(value).toLocaleString()}
        <div style="font-size:9px;">${pnlSign}${(stock.unrealizedPnLPercent || 0).toFixed(1)}%</div>
      </div>
      <div class="stock-actions">
        <div class="stock-edit" title="Edit stock">\u270e</div>
        <div class="stock-delete" title="Delete stock">\u00d7</div>
      </div>
    `;
    div.querySelector('.stock-edit').addEventListener('click', (e) => { e.stopPropagation(); editStock(stock.symbol); });
    div.querySelector('.stock-delete').addEventListener('click', (e) => { e.stopPropagation(); deleteStock(stock.symbol); });
    el.stocksList.appendChild(div);
  });

  // Show cash balances
  const cashEntries = [
    { key: 'ILS', label: 'Cash \u20aa', amount: cashBalances.ILS || 0, currency: 'ILS' },
    { key: 'USD', label: 'Cash $', amount: cashBalances.USD || 0, currency: 'USD' },
    { key: 'EUR', label: 'Cash \u20ac', amount: cashBalances.EUR || 0, currency: 'EUR' }
  ].filter(c => c.amount > 0);

  cashEntries.forEach(c => {
    const div = document.createElement('div');
    div.className = 'stock-item';
    const displayAmt = toDisplayCurrency(c.amount, c.currency);
    const sym = currencySymbol();
    div.innerHTML = `
      <div class="stock-symbol" style="color:rgba(96,165,250,0.9);">${c.label}</div>
      <div class="stock-shares"></div>
      <div class="stock-value" style="color:rgba(96,165,250,0.8);">${sym}${Math.round(displayAmt).toLocaleString()}</div>
      <div class="stock-actions">
        <div class="stock-edit" title="Edit cash">\u270e</div>
      </div>
    `;
    div.querySelector('.stock-edit').addEventListener('click', (e) => { e.stopPropagation(); editCash(c.key); });
    el.stocksList.appendChild(div);
  });
}

// ============================================================
// Inline editing (double-click)
// ============================================================

function editStock(symbol) {
  const stock = portfolio.stocks.find(s => s.symbol === symbol);
  if (!stock) return;

  const avgP = normalizePrice(stock.avgPrice, symbol);

  el.addStockForm.innerHTML = `
    <div class="form-title">Edit ${symbol}</div>
    <div class="form-row">
      <div class="form-group" style="flex: 0 0 60px;">
        <div class="form-label">Shares</div>
        <input type="number" id="editShares" class="form-input" value="${stock.shares}" min="0" step="0.01">
      </div>
      <div class="form-group" style="flex: 1;">
        <div class="form-label">Avg Price</div>
        <input type="number" id="editAvgPrice" class="form-input" value="${avgP.toFixed(6)}" min="0" step="0.000001">
      </div>
    </div>
    <div style="font-size:9px;color:rgba(255,255,255,0.35);padding:2px 0;">Or add more shares at new price:</div>
    <div class="form-row">
      <div class="form-group" style="flex: 0 0 60px;">
        <div class="form-label">+ Add qty</div>
        <input type="number" id="editAddShares" class="form-input" placeholder="0" min="0" step="0.01">
      </div>
      <div class="form-group" style="flex: 1;">
        <div class="form-label">Buy price</div>
        <input type="number" id="editAddPrice" class="form-input" placeholder="Auto" min="0" step="0.01">
      </div>
    </div>
    <div class="form-row" style="margin-top: 4px;">
      <button id="editSave" class="form-btn">Save</button>
      <button id="editCancel" class="form-btn cancel">Cancel</button>
    </div>
  `;

  document.getElementById('editSave').addEventListener('click', async (e) => {
    e.stopPropagation();
    const newShares = parseFloat(document.getElementById('editShares').value);
    const newAvg = parseFloat(document.getElementById('editAvgPrice').value);
    const addQty = parseFloat(document.getElementById('editAddShares').value) || 0;
    const addPrice = parseFloat(document.getElementById('editAddPrice').value) || 0;

    if (addQty > 0) {
      // Add more shares at new price → recalculate weighted average
      let buyPrice = addPrice;
      if (!buyPrice) {
        try {
          const prices = await api.getLivePrices([symbol]);
          buyPrice = prices[symbol]?.price || 0;
          if (symbol.endsWith('.TA')) buyPrice /= 100;
        } catch {}
      }
      if (buyPrice > 0) {
        const totalShares = stock.shares + addQty;
        const totalCost = (stock.shares * avgP) + (addQty * buyPrice);
        stock.shares = totalShares;
        // Store in native format (agorot for .TA)
        stock.avgPrice = symbol.endsWith('.TA') ? (totalCost / totalShares) * 100 : totalCost / totalShares;
      }
    } else {
      // Direct edit
      stock.shares = newShares;
      stock.avgPrice = symbol.endsWith('.TA') ? newAvg * 100 : newAvg;
    }

    await savePortfolio();
    hideAddStockForm();
    await refreshPortfolioPrices();
  });

  document.getElementById('editCancel').addEventListener('click', (e) => { e.stopPropagation(); hideAddStockForm(); });

  el.addStockForm.classList.add('visible');
  setTimeout(() => resizeWindowToContent(), 100);
  api.showAddForm();
}

function editCash(currency) {
  const symbols = { ILS: '\u20aa', USD: '$', EUR: '\u20ac' };
  const sym = symbols[currency] || currency;

  el.addStockForm.innerHTML = `
    <div class="form-title">Edit Cash ${sym}</div>
    <div class="form-row">
      <div class="form-group" style="flex: 1;">
        <div class="form-label">Current: ${sym}${(cashBalances[currency] || 0).toLocaleString()}</div>
        <input type="number" id="editCashAmount" class="form-input" value="${cashBalances[currency] || 0}" min="0" step="0.01">
      </div>
    </div>
    <div style="font-size:9px;color:rgba(255,255,255,0.35);padding:2px 0;">Or add to existing:</div>
    <div class="form-row">
      <div class="form-group" style="flex: 1;">
        <div class="form-label">+ Add ${sym}</div>
        <input type="number" id="editCashAdd" class="form-input" placeholder="0" min="0" step="0.01">
      </div>
    </div>
    <div class="form-row" style="margin-top: 4px;">
      <button id="cashEditSave" class="form-btn">Save</button>
      <button id="cashEditCancel" class="form-btn cancel">Cancel</button>
    </div>
  `;

  document.getElementById('cashEditSave').addEventListener('click', async (e) => {
    e.stopPropagation();
    const direct = parseFloat(document.getElementById('editCashAmount').value) || 0;
    const add = parseFloat(document.getElementById('editCashAdd').value) || 0;
    cashBalances[currency] = add > 0 ? (cashBalances[currency] || 0) + add : direct;
    portfolio.cashBalances = cashBalances;
    await savePortfolio();
    hideAddStockForm();
    await refreshPortfolioPrices();
  });

  document.getElementById('cashEditCancel').addEventListener('click', (e) => { e.stopPropagation(); hideAddStockForm(); });

  el.addStockForm.classList.add('visible');
  setTimeout(() => resizeWindowToContent(), 100);
  api.showAddForm();
}

function updateMarketOverviewLayout() {
  const hasStocks = portfolio.stocks.length > 0;
  document.querySelector('.market-overview').classList.toggle('centered', !hasStocks);
  document.querySelector('.sp500-data').classList.toggle('centered', !hasStocks);
  document.querySelector('.portfolio-summary').style.display = hasStocks ? 'block' : 'none';
}

// ============================================================
// S&P 500 price — via main process
// ============================================================

async function updateSP500Price() {
  try {
    const data = await api.getSP500Price();
    if (!data) return;

    el.currentPrice.textContent = data.price.toFixed(2);
    const positive = data.changePercent >= 0;
    const sign = positive ? '+' : '';
    const arrow = positive ? '\u2197' : '\u2198';
    const cls = positive ? 'positive' : 'negative';
    el.dayChange.innerHTML = `<span class="${cls}">${arrow} ${sign}${data.changePercent.toFixed(2)}% (${sign}${data.change.toFixed(2)})</span>`;

    el.updateTime.textContent = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    el.loading.style.display = 'none';
    el.content.style.display = 'block';

    lastSuccessfulUpdate = Date.now();
    checkDataFreshness();
  } catch {
    el.loading.style.display = 'none';
    el.content.style.display = 'block';
    checkDataFreshness();
  }
}

// ============================================================
// Trend calculations — via main process, correct date matching
// ============================================================

function showTrendIndicators(mode) {
  currentTrendMode = mode;
  hideTrendDetail();
  refreshTrends();
  el.trendIndicators.style.display = 'grid';
}

function refreshTrends() {
  if (currentTrendMode === 'sp500') updateSP500Trends();
  else updatePortfolioTrends();
  // Also refresh open detail panel with live data
  if (activeTrendDetail) showTrendDetailData(activeTrendDetail);
}

const TREND_PLACEHOLDER = '<span class="neutral">--</span>';

function formatTrendChange(change) {
  const positive = change >= 0;
  const sign = positive ? '+' : '';
  const arrow = positive ? '\u2197' : '\u2198';
  const cls = positive ? 'positive' : 'negative';
  return `<span class="trend-arrow ${cls}">${arrow}</span><span class="${cls}">${sign}${change.toFixed(2)}%</span>`;
}

function setTrendsPlaceholder() {
  el.weekChange.innerHTML = TREND_PLACEHOLDER;
  el.monthChange.innerHTML = TREND_PLACEHOLDER;
  el.yearChange.innerHTML = TREND_PLACEHOLDER;
}

// Find the last valid closing price BEFORE a given date.
// This ensures the first day of the period is included in the change.
// E.g. for week starting Monday: returns Friday's close → Monday's change is counted.
function findLastPriceBefore(timestamps, prices, targetDate) {
  const targetTs = targetDate.getTime() / 1000;
  let lastValid = 0;
  for (let i = 0; i < timestamps.length; i++) {
    if (timestamps[i] >= targetTs) break;
    if (prices[i] && prices[i] > 0) lastValid = i;
  }
  return prices[lastValid] || 0;
}

// All periods reset at 15:00 local time:
// - Week:  Monday 15:00
// - Month: 1st of month 15:00
// - Year:  January 1st 15:00

function getWeekStartDate() {
  const today = new Date();
  const day = today.getDay();
  const hour = today.getHours();
  const weekStart = new Date(today);
  if (day === 1 && hour < 15) weekStart.setDate(today.getDate() - 7);
  else if (day === 0) weekStart.setDate(today.getDate() - 6);
  else { const toMon = day === 0 ? 6 : day - 1; weekStart.setDate(today.getDate() - toMon); }
  weekStart.setHours(15, 0, 0, 0);
  return weekStart;
}

function getMonthStartDate() {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1, 15, 0, 0, 0);
  // If today is the 1st and before 15:00, use previous month's 1st
  if (today.getDate() === 1 && today.getHours() < 15) {
    first.setMonth(first.getMonth() - 1);
  }
  return first;
}

function getYearStartDate() {
  const today = new Date();
  const jan1 = new Date(today.getFullYear(), 0, 1, 15, 0, 0, 0);
  // If today is Jan 1st and before 15:00, use previous year's Jan 1st
  if (today.getMonth() === 0 && today.getDate() === 1 && today.getHours() < 15) {
    jan1.setFullYear(jan1.getFullYear() - 1);
  }
  return jan1;
}

// Calculate trend: (livePrice - startPrice) / startPrice * 100
// Uses live price directly — always includes today's intraday movement.
function calcTrend(startPrice, livePrice) {
  if (!startPrice || startPrice <= 0 || !livePrice) return null;
  return ((livePrice - startPrice) / startPrice) * 100;
}

async function updateSP500Trends() {
  try {
    // Fetch history + live price in parallel
    const [history, liveData] = await Promise.all([
      api.getChartHistory('^GSPC'),
      api.getSP500Price()
    ]);
    if (!history || !liveData?.price) return setTrendsPlaceholder();

    const { timestamps, prices } = history;
    const livePrice = liveData.price;

    // Find starting price for each period (all reset at 15:00), compare to LIVE price
    const weekPrice = findLastPriceBefore(timestamps, prices, getWeekStartDate());
    const monthPrice = findLastPriceBefore(timestamps, prices, getMonthStartDate());
    const yearPrice = findLastPriceBefore(timestamps, prices, getYearStartDate());

    el.weekChange.innerHTML = formatTrendChange(calcTrend(weekPrice, livePrice) ?? 0);
    el.monthChange.innerHTML = formatTrendChange(calcTrend(monthPrice, livePrice) ?? 0);
    el.yearChange.innerHTML = formatTrendChange(calcTrend(yearPrice, livePrice) ?? 0);
  } catch { setTrendsPlaceholder(); }
}

async function updatePortfolioTrends() {
  if (portfolio.stocks.length === 0) return setTrendsPlaceholder();

  try {
    // Fetch histories + live prices in parallel
    const symbols = portfolio.stocks.map(s => s.symbol);
    const [histories, livePrices] = await Promise.all([
      Promise.all(portfolio.stocks.map(async (stock) => {
        const history = await api.getChartHistory(stock.symbol);
        return { stock, history };
      })),
      api.getLivePrices(symbols)
    ]);

    const weekStart = getWeekStartDate();
    const monthStart = getMonthStartDate();
    const yearStart = getYearStartDate();

    let totalWeekChange = 0, totalMonthChange = 0, totalYearChange = 0;
    let totalCurrentValue = 0;
    let processed = 0;

    for (const { stock, history } of histories) {
      if (!history?.timestamps || !history?.prices) continue;

      const { timestamps, prices } = history;

      // Use LIVE price (not historical last close)
      const livePrice = livePrices?.[stock.symbol]?.price;
      if (!livePrice || livePrice <= 0) continue;

      const stockValue = stock.shares * livePrice;

      const weekPrice = findLastPriceBefore(timestamps, prices, weekStart);
      const monthPrice = findLastPriceBefore(timestamps, prices, monthStart);
      const yearPrice = findLastPriceBefore(timestamps, prices, yearStart);

      if (weekPrice > 0) totalWeekChange += ((livePrice - weekPrice) / weekPrice) * 100 * stockValue;
      if (monthPrice > 0) totalMonthChange += ((livePrice - monthPrice) / monthPrice) * 100 * stockValue;
      if (yearPrice > 0) totalYearChange += ((livePrice - yearPrice) / yearPrice) * 100 * stockValue;

      totalCurrentValue += stockValue;
      processed++;
    }

    if (processed > 0 && totalCurrentValue > 0) {
      el.weekChange.innerHTML = formatTrendChange(totalWeekChange / totalCurrentValue);
      el.monthChange.innerHTML = formatTrendChange(totalMonthChange / totalCurrentValue);
      el.yearChange.innerHTML = formatTrendChange(totalYearChange / totalCurrentValue);
    } else {
      setTrendsPlaceholder();
    }
  } catch { setTrendsPlaceholder(); }
}

// ============================================================
// UI helpers
// ============================================================

function showNotification(message, type = 'info') {
  const div = document.createElement('div');
  div.style.cssText = `
    position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%);
    background: ${type === 'error' ? 'rgba(248,113,113,0.9)' : 'rgba(74,222,128,0.9)'};
    color: white; padding: 6px 14px; border-radius: 8px; font-size: 11px;
    font-weight: 600; z-index: 9999; animation: fadeInUp 0.3s ease;
    pointer-events: none;
  `;
  div.textContent = message;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2500);
}

function showConfirmDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; -webkit-app-region: no-drag;
    `;
    overlay.innerHTML = `
      <div style="background: linear-gradient(135deg, rgba(15,15,35,0.98), rgba(26,26,58,0.98));
        border: 1px solid rgba(255,255,255,0.2); border-radius: 12px;
        padding: 16px; text-align: center; min-width: 200px;">
        <div style="color: white; font-size: 12px; margin-bottom: 12px; font-weight: 500;">${message}</div>
        <div style="display: flex; gap: 8px; justify-content: center;">
          <button class="confirm-yes form-btn" style="min-width: 60px;">Yes</button>
          <button class="confirm-no form-btn cancel" style="min-width: 60px;">No</button>
        </div>
      </div>
    `;
    overlay.querySelector('.confirm-yes').addEventListener('click', () => { overlay.remove(); resolve(true); });
    overlay.querySelector('.confirm-no').addEventListener('click', () => { overlay.remove(); resolve(false); });
    document.body.appendChild(overlay);
  });
}

// ============================================================
// Trend detail breakdown
// ============================================================

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function toggleTrendDetail(period) {
  // YEAR: 1st click → months, 2nd click → multi-year, 3rd click → close
  if (period === 'year' && activeTrendDetail === 'year') {
    // Switch to multi-year view
    activeTrendDetail = 'multiyear';
    showTrendDetailData('multiyear');
    return;
  }

  // Close if same period clicked again (or multiyear clicked on year)
  if (activeTrendDetail === period || (period === 'year' && activeTrendDetail === 'multiyear')) {
    hideTrendDetail();
    return;
  }

  // Save collapsed Y on first open
  if (detailCollapsedY == null) {
    const pos = await api.getWindowPosition();
    detailCollapsedY = pos.y;
  }

  activeTrendDetail = period;

  // Highlight active trend item
  el.trendWeek.classList.toggle('active', period === 'week');
  el.trendMonth.classList.toggle('active', period === 'month');
  el.trendYear.classList.toggle('active', period === 'year');

  showTrendDetailData(period);
}

function hideTrendDetail() {
  activeTrendDetail = null;
  el.trendDetail.classList.remove('visible');
  el.trendDetail.innerHTML = '';
  el.trendWeek.classList.remove('active');
  el.trendMonth.classList.remove('active');
  el.trendYear.classList.remove('active');
  document.querySelector('.widget-container').classList.remove('detail-open');
  if (detailCollapsedY != null) {
    api.restoreCollapsed(detailCollapsedY);
    detailCollapsedY = null;
  }
}

function resizeForDetail() {
  setTimeout(() => {
    const container = document.querySelector('.widget-container');
    const h = Math.max(container.scrollHeight, container.offsetHeight) + 4;
    if (detailCollapsedY != null) {
      api.resizeUpward(h, detailCollapsedY);
    }
  }, 50);
}

async function showTrendDetailData(period) {
  const container = document.querySelector('.widget-container');
  container.classList.add('detail-open');
  el.trendDetail.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.4);font-size:10px;padding:4px;">Loading...</div>';
  el.trendDetail.classList.add('visible');
  resizeForDetail();

  try {
    if (period === 'multiyear') {
      // Multi-year view always shows S&P 500 (15 years)
      await renderMultiYearDetail();
    } else if (currentTrendMode === 'sp500') {
      const [history, liveData] = await Promise.all([
        api.getChartHistory('^GSPC'),
        api.getSP500Price()
      ]);
      if (!history || !liveData?.price) return;
      renderTrendDetail(period, history.timestamps, history.prices, liveData.price);
    } else {
      await renderPortfolioTrendDetail(period);
    }
  } catch {
    el.trendDetail.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.4);font-size:10px;padding:4px;">No data</div>';
  }
  resizeForDetail();
}

function renderTrendDetail(period, timestamps, prices, livePrice) {
  const rows = [];
  const today = new Date();

  if (period === 'week') {
    // Daily breakdown for current week
    const weekStart = getWeekStartDate();
    const weekStartTs = weekStart.getTime() / 1000;
    const todayStr = today.toDateString();

    // Find the close price just before week started (reference)
    let refIdx = 0;
    for (let i = 0; i < timestamps.length; i++) {
      if (timestamps[i] >= weekStartTs) { refIdx = Math.max(0, i - 1); break; }
    }

    // Collect each completed trading day this week (skip today — we'll use live price)
    let prevClose = prices[refIdx];
    for (let i = refIdx + 1; i < timestamps.length; i++) {
      if (timestamps[i] < weekStartTs) continue;
      const price = prices[i];
      if (!price || price <= 0) continue; // skip null/zero (incomplete day)
      const date = new Date(timestamps[i] * 1000);
      if (date.toDateString() === todayStr) continue; // skip today from history
      const dayName = DAY_NAMES[date.getDay()];
      const change = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
      rows.push({ label: `${dayName} ${date.getDate()}`, change, current: false });
      prevClose = price;
    }

    // Today's row: always use live price vs last valid close
    if (livePrice && prevClose > 0) {
      const todayChange = ((livePrice - prevClose) / prevClose) * 100;
      const todayName = DAY_NAMES[today.getDay()];
      rows.push({ label: `${todayName} ${today.getDate()}`, change: todayChange, current: true });
    }

  } else if (period === 'month') {
    // Weekly breakdown for current month.
    // Each week measured the same way as WEEK trend:
    // close_before_monday → close_before_next_monday (or live for current week)
    const monthStart = getMonthStartDate();
    const monthStartTs = monthStart.getTime() / 1000;

    // Collect Monday DATES in this month (to use as week boundaries)
    const mondayDates = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (timestamps[i] < monthStartTs) continue;
      if (!prices[i] || prices[i] <= 0) continue;
      const date = new Date(timestamps[i] * 1000);
      if (date.getDay() === 1) mondayDates.push(date);
    }

    // Month start reference = close before month started
    const refPrice = findLastPriceBefore(timestamps, prices, monthStart);

    // Build week boundaries: [refPrice, fri_before_mon1, fri_before_mon2, ..., livePrice]
    const boundaries = [refPrice];
    for (const monDate of mondayDates) {
      const p = findLastPriceBefore(timestamps, prices, monDate);
      // Only add if different from last boundary (avoid zero-change phantom weeks)
      if (p > 0 && p !== boundaries[boundaries.length - 1]) {
        boundaries.push(p);
      }
    }

    // Completed weeks
    for (let w = 1; w < boundaries.length; w++) {
      const startP = boundaries[w - 1];
      const endP = boundaries[w];
      const change = startP > 0 ? ((endP - startP) / startP) * 100 : 0;
      rows.push({ label: `Week ${w}`, change, current: false });
    }

    // Current week: same reference as WEEK trend (close before this Monday)
    const curWeekRef = findLastPriceBefore(timestamps, prices, getWeekStartDate());
    const curChange = curWeekRef > 0 ? ((livePrice - curWeekRef) / curWeekRef) * 100 : 0;
    rows.push({ label: `Week ${boundaries.length}`, change: curChange, current: true });

  } else if (period === 'year') {
    // Monthly breakdown for current year.
    // Each month: close_before_1st → close_before_next_1st (or live for current month)
    const yearStart = getYearStartDate();
    const yearStartTs = yearStart.getTime() / 1000;

    // Reference = close before year started
    const yearRef = findLastPriceBefore(timestamps, prices, yearStart);

    // For each month that has passed, find close before its 1st
    const currentMonthIdx = today.getMonth();
    let prevClose = yearRef;

    for (let m = 0; m <= currentMonthIdx; m++) {
      const monthFirstDate = new Date(today.getFullYear(), m, 1, 15, 0, 0, 0);

      if (m === currentMonthIdx) {
        // Current month: same reference as MONTH trend
        const curMonthRef = findLastPriceBefore(timestamps, prices, getMonthStartDate());
        const change = curMonthRef > 0 ? ((livePrice - curMonthRef) / curMonthRef) * 100 : 0;
        rows.push({ label: MONTH_NAMES[m], change, current: true });
      } else {
        // Completed month: close before this 1st → close before next 1st
        const nextMonthDate = new Date(today.getFullYear(), m + 1, 1, 15, 0, 0, 0);
        const endPrice = findLastPriceBefore(timestamps, prices, nextMonthDate);
        if (endPrice > 0 && prevClose > 0) {
          const change = ((endPrice - prevClose) / prevClose) * 100;
          rows.push({ label: MONTH_NAMES[m], change, current: false });
        }
        prevClose = endPrice;
      }
    }
  }

  // Render rows
  if (rows.length === 0) {
    el.trendDetail.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.4);font-size:10px;padding:4px;">No data yet</div>';
    return;
  }

  el.trendDetail.innerHTML = rows.map(r => {
    const cls = r.change >= 0 ? 'positive' : 'negative';
    const sign = r.change >= 0 ? '+' : '';
    const arrow = r.change >= 0 ? '\u2197' : '\u2198';
    const rowClass = r.current ? 'trend-detail-row current' : 'trend-detail-row';
    return `<div class="${rowClass}">
      <span class="trend-detail-label">${r.label}</span>
      <span class="trend-detail-value ${cls}">${arrow} ${sign}${r.change.toFixed(2)}%</span>
    </div>`;
  }).join('');
}

async function renderPortfolioTrendDetail(period) {
  // For portfolio, calculate weighted breakdown across all stocks
  const symbols = portfolio.stocks.map(s => s.symbol);
  const [histories, livePrices] = await Promise.all([
    Promise.all(portfolio.stocks.map(async (stock) => {
      const history = await api.getChartHistory(stock.symbol);
      return { stock, history };
    })),
    api.getLivePrices(symbols)
  ]);

  // Use first stock with data as proxy for period structure, then weight
  // For simplicity, show S&P 500 structure but with portfolio-weighted values
  const spHistory = await api.getChartHistory('^GSPC');
  const spLive = await api.getSP500Price();
  if (spHistory && spLive?.price) {
    renderTrendDetail(period, spHistory.timestamps, spHistory.prices, spLive.price);
    // Note: this shows S&P detail when in portfolio mode. For full portfolio
    // breakdown per period, we'd need much more complex weighted calculation.
  }
}

// ============================================================
// Market status (Open / Closed / Pre-Market / After-Hours)
// ============================================================

// NYSE holidays 2025-2027 (dates when market is fully closed)
const NYSE_HOLIDAYS = [
  // 2025
  '2025-01-01','2025-01-20','2025-02-17','2025-04-18','2025-05-26',
  '2025-06-19','2025-07-04','2025-09-01','2025-11-27','2025-12-25',
  // 2026
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25',
  '2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
  // 2027
  '2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31',
  '2027-06-18','2027-07-05','2027-09-06','2027-11-25','2027-12-24',
];

function getMarketStatus() {
  // All times in ET (Eastern Time)
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay(); // 0=Sun, 6=Sat
  const hours = et.getHours();
  const mins = et.getMinutes();
  const timeInMins = hours * 60 + mins;

  // Check if today is a holiday
  const dateStr = `${et.getFullYear()}-${String(et.getMonth()+1).padStart(2,'0')}-${String(et.getDate()).padStart(2,'0')}`;
  const isHoliday = NYSE_HOLIDAYS.includes(dateStr);
  const isWeekend = day === 0 || day === 6;

  // Market hours (in minutes from midnight ET)
  const PRE_OPEN = 4 * 60;       // 4:00 AM
  const MARKET_OPEN = 9 * 60 + 30; // 9:30 AM
  const MARKET_CLOSE = 16 * 60;    // 4:00 PM
  const AFTER_CLOSE = 20 * 60;     // 8:00 PM

  let status, label, countdown;

  if (isWeekend || isHoliday) {
    status = 'closed';
    label = isHoliday ? 'Holiday' : 'Closed';
    countdown = getNextOpenCountdown(et, day, isHoliday);
  } else if (timeInMins < PRE_OPEN) {
    status = 'closed';
    label = 'Closed';
    countdown = formatCountdown(PRE_OPEN - timeInMins);
    countdown = `pre-market in ${countdown}`;
  } else if (timeInMins < MARKET_OPEN) {
    status = 'pre';
    label = 'Pre-Market';
    countdown = formatCountdown(MARKET_OPEN - timeInMins);
    countdown = `opens in ${countdown}`;
  } else if (timeInMins < MARKET_CLOSE) {
    status = 'open';
    label = 'Open';
    countdown = formatCountdown(MARKET_CLOSE - timeInMins);
    countdown = `closes in ${countdown}`;
  } else if (timeInMins < AFTER_CLOSE) {
    status = 'after';
    label = 'After-Hours';
    countdown = formatCountdown(AFTER_CLOSE - timeInMins);
    countdown = `ends in ${countdown}`;
  } else {
    status = 'closed';
    label = 'Closed';
    countdown = getNextOpenCountdown(et, day, false);
  }

  return { status, label, countdown };
}

function formatCountdown(totalMins) {
  if (totalMins <= 0) return '';
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getNextOpenCountdown(et, day, isHoliday) {
  // Calculate minutes until next pre-market (4:00 AM ET next trading day)
  let daysUntil = 1;
  if (day === 5) daysUntil = 3;       // Friday → Monday
  else if (day === 6) daysUntil = 2;   // Saturday → Monday
  // If holiday on a weekday, add 1 more day
  if (isHoliday && day >= 1 && day <= 5) daysUntil = 1;

  const minsLeftToday = (24 * 60) - (et.getHours() * 60 + et.getMinutes());
  const totalMins = minsLeftToday + (daysUntil - 1) * 24 * 60 + 9 * 60 + 30; // until 9:30 AM

  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return `opens in ${h}h ${m}m`;
}

async function updateMarketStatus() {
  const { status, label, countdown } = getMarketStatus();
  let extHtml = '';

  // Show extended hours price for pre-market and after-hours
  if (status === 'pre' || status === 'after' || status === 'closed') {
    try {
      const data = await api.getSP500Price();
      if (data?.extendedPrice) {
        const sign = (data.extendedChange || 0) >= 0 ? '+' : '';
        const cls = (data.extendedChange || 0) >= 0 ? 'positive' : 'negative';
        extHtml = `<span class="${cls}" style="font-weight:700;font-size:9px;">Futures ${data.extendedPrice.toFixed(0)} (${sign}${(data.extendedChange || 0).toFixed(2)}%)</span>`;
      }
    } catch { /* silent */ }
  }

  el.marketStatus.innerHTML = `
    <span class="market-status-dot ${status}"></span>
    <span class="market-status-label">${label}</span>
    <span class="market-status-countdown">${countdown ? '\u00b7 ' + countdown : ''}</span>
    ${extHtml}
  `;
}

// ============================================================
// Cash balance management
// ============================================================

function showCashForm() {
  if (el.addStockForm.classList.contains('visible')) hideAddStockForm();
  if (el.reduceStockForm.classList.contains('visible')) hideReduceStockForm();

  el.addStockForm.innerHTML = `
    <div class="form-title">Cash Balance</div>
    <div class="form-row">
      <div class="form-group" style="flex: 1;">
        <div class="form-label">\u20aa ILS</div>
        <input type="number" id="cashILS" class="form-input" placeholder="0" min="0" step="0.01" value="${cashBalances.ILS || ''}">
      </div>
      <div class="form-group" style="flex: 1;">
        <div class="form-label">$ USD</div>
        <input type="number" id="cashUSD" class="form-input" placeholder="0" min="0" step="0.01" value="${cashBalances.USD || ''}">
      </div>
      <div class="form-group" style="flex: 1;">
        <div class="form-label">\u20ac EUR</div>
        <input type="number" id="cashEUR" class="form-input" placeholder="0" min="0" step="0.01" value="${cashBalances.EUR || ''}">
      </div>
    </div>
    <div class="form-row" style="margin-top: 4px;">
      <button id="cashSave" class="form-btn">Save</button>
      <button id="cashCancel" class="form-btn cancel">Cancel</button>
    </div>
  `;

  document.getElementById('cashSave').addEventListener('click', async (e) => {
    e.stopPropagation();
    cashBalances = {
      ILS: parseFloat(document.getElementById('cashILS').value) || 0,
      USD: parseFloat(document.getElementById('cashUSD').value) || 0,
      EUR: parseFloat(document.getElementById('cashEUR').value) || 0
    };
    portfolio.cashBalances = cashBalances;
    await savePortfolio();
    hideAddStockForm();
    await refreshPortfolioPrices();
  });

  document.getElementById('cashCancel').addEventListener('click', (e) => {
    e.stopPropagation();
    hideAddStockForm();
  });

  el.addStockForm.classList.add('visible');
  setTimeout(() => resizeWindowToContent(), 100);
  api.showAddForm();
  setTimeout(() => document.getElementById('cashILS')?.focus(), 100);
}

// ============================================================
// Sparkline chart
// ============================================================

async function updateSparkline() {
  try {
    let data;
    if (sparklineMode === 'MY1D' || sparklineMode === 'MY1W') {
      // Portfolio sparkline
      if (portfolio.stocks.length === 0) return;
      const holdings = portfolio.stocks.map(s => ({ symbol: s.symbol, shares: s.shares }));
      data = await api.getPortfolioSparkline(holdings, sparklineMode);
    } else {
      // S&P 500 sparkline
      data = await api.getSparklineData(sparklineMode === '1W' ? '1W' : '1D');
    }
    if (!data?.points || data.points.length < 2) return;
    drawSparkline(data.points, data.previousClose);
  } catch { /* silent */ }
}

function drawSparkline(points, previousClose) {
  const canvas = el.sparklineCanvas;
  const ctx = canvas.getContext('2d');

  // High-DPI support
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);

  const prices = points.map(p => p.p);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;
  const pad = 2;
  const ref = previousClose || prices[0];

  const GREEN = '#4ade80';
  const RED = '#f87171';
  const GREEN_FILL = 'rgba(74, 222, 128, 0.10)';
  const RED_FILL = 'rgba(248, 113, 113, 0.10)';

  function priceToY(p) { return h - pad - ((p - minP) / range) * (h - pad * 2); }
  const stepX = w / (prices.length - 1);
  const refY = priceToY(ref);

  // Draw reference line (dashed)
  ctx.beginPath();
  ctx.setLineDash([2, 3]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 0.5;
  ctx.moveTo(0, refY);
  ctx.lineTo(w, refY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw segments: green above ref, red below ref
  // Each segment is a line + filled area between line and refY
  for (let i = 0; i < prices.length - 1; i++) {
    const x1 = i * stepX;
    const x2 = (i + 1) * stepX;
    const y1 = priceToY(prices[i]);
    const y2 = priceToY(prices[i + 1]);
    const p1 = prices[i];
    const p2 = prices[i + 1];

    // Check if segment crosses the reference line
    const above1 = p1 >= ref;
    const above2 = p2 >= ref;

    if (above1 === above2) {
      // Whole segment same side — draw in one color
      const color = above1 ? GREEN : RED;
      const fill = above1 ? GREEN_FILL : RED_FILL;

      // Line
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Fill between line and refY
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x2, refY);
      ctx.lineTo(x1, refY);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    } else {
      // Segment crosses reference — split at intersection
      const t = (ref - p1) / (p2 - p1); // 0..1
      const crossX = x1 + t * (x2 - x1);

      // First half
      const color1 = above1 ? GREEN : RED;
      const fill1 = above1 ? GREEN_FILL : RED_FILL;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(crossX, refY);
      ctx.strokeStyle = color1;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(crossX, refY);
      ctx.lineTo(x1, refY);
      ctx.closePath();
      ctx.fillStyle = fill1;
      ctx.fill();

      // Second half
      const color2 = above2 ? GREEN : RED;
      const fill2 = above2 ? GREEN_FILL : RED_FILL;
      ctx.beginPath();
      ctx.moveTo(crossX, refY);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = color2;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(crossX, refY);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x2, refY);
      ctx.closePath();
      ctx.fillStyle = fill2;
      ctx.fill();
    }
  }

  // Draw current price dot
  const lastPrice = prices[prices.length - 1];
  const lastX = (prices.length - 1) * stepX;
  const lastY = priceToY(lastPrice);
  const dotColor = lastPrice >= ref ? GREEN : RED;
  ctx.beginPath();
  ctx.arc(lastX, lastY, 2, 0, Math.PI * 2);
  ctx.fillStyle = dotColor;
  ctx.fill();
}

// ============================================================
// Multi-year detail (15 years of S&P 500 annual returns)
// ============================================================

async function renderMultiYearDetail() {
  const [longHistory, liveData] = await Promise.all([
    api.getLongHistory('^GSPC'),
    api.getSP500Price()
  ]);

  if (!longHistory?.timestamps || !longHistory?.prices) {
    el.trendDetail.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.4);font-size:10px;padding:4px;">No data</div>';
    return;
  }

  const { timestamps, prices } = longHistory;
  const livePrice = liveData?.price;
  const rows = [];
  const thisYear = new Date().getFullYear();

  // Group monthly data by year, calc annual return
  // Find all unique years in the data
  const yearPrices = {}; // { year: { first: price, last: price } }

  for (let i = 0; i < timestamps.length; i++) {
    const price = prices[i];
    if (!price || price <= 0) continue;
    const year = new Date(timestamps[i] * 1000).getFullYear();

    if (!yearPrices[year]) {
      yearPrices[year] = { first: price, last: price };
    } else {
      yearPrices[year].last = price;
    }
  }

  // Get sorted years (most recent first)
  const years = Object.keys(yearPrices).map(Number).sort((a, b) => b - a);

  // For each year, calc return: (last / prev_year_last - 1) * 100
  for (const year of years) {
    const prevYear = yearPrices[year - 1];
    const curYear = yearPrices[year];

    if (!prevYear) continue; // need previous year as reference

    const startPrice = prevYear.last;
    const endPrice = (year === thisYear && livePrice) ? livePrice : curYear.last;

    if (startPrice > 0) {
      const change = ((endPrice - startPrice) / startPrice) * 100;
      rows.push({
        label: `${year}`,
        change,
        current: year === thisYear
      });
    }
  }

  // Render
  if (rows.length === 0) {
    el.trendDetail.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.4);font-size:10px;padding:4px;">No data</div>';
    return;
  }

  el.trendDetail.innerHTML = rows.map(r => {
    const cls = r.change >= 0 ? 'positive' : 'negative';
    const sign = r.change >= 0 ? '+' : '';
    const arrow = r.change >= 0 ? '\u2197' : '\u2198';
    const rowClass = r.current ? 'trend-detail-row current' : 'trend-detail-row';
    return `<div class="${rowClass}">
      <span class="trend-detail-label">${r.label}</span>
      <span class="trend-detail-value ${cls}">${arrow} ${sign}${r.change.toFixed(2)}%</span>
    </div>`;
  }).join('');
}

// ============================================================
// Auto-update — single consolidated interval
// ============================================================

function startAutoUpdate() {
  // Price + sparkline updates every 15s
  setInterval(async () => {
    await updateSP500Price();
    updateSparkline();

    if (portfolio.stocks.length > 0) {
      try {
        const livePrices = await api.getLivePrices(portfolio.stocks.map(s => s.symbol));
        applyLivePrices(livePrices);
      } catch { /* cached data will be used */ }
    }
  }, 15_000);

  // Trend updates every 30s (historical data cached 5 min, but live price updates each time)
  setInterval(() => {
    if (!isExpanded && el.trendIndicators.style.display === 'grid') {
      refreshTrends();
    }
  }, 30_000);

  // Freshness check every 30s
  setInterval(checkDataFreshness, 30_000);

  // Market status every 60s (countdown updates)
  setInterval(updateMarketStatus, 60_000);
}

// ============================================================
// Initialize
// ============================================================

async function initialize() {
  // Load currency preference + exchange rate
  displayCurrency = await api.getDisplayCurrency() || 'ILS';
  const initSymbols = { ILS: '\u20aa', USD: '$', EUR: '\u20ac' };
  el.currencyBtn.textContent = initSymbols[displayCurrency] || '\u20aa';
  try {
    const [usdR, eurR] = await Promise.all([api.getUsdIlsRate(), api.getEurIlsRate()]);
    if (usdR) usdIlsRate = usdR;
    if (eurR) eurIlsRate = eurR;
  } catch {}

  await loadPortfolio();

  // Load cash balances from portfolio
  cashBalances = portfolio.cashBalances || { ILS: 0, USD: 0, EUR: 0 };

  // Load cash balances default
  if (!portfolio.cashBalances) {
    portfolio.cashBalances = { ILS: 0, USD: 0, EUR: 0 };
  }

  if (portfolio.stocks.length > 0) await refreshPortfolioPrices();
  if (!isExpanded) {
    currentTrendMode = 'sp500';
    updateSP500Trends();
    el.trendIndicators.style.display = 'grid';
  }
  updateMarketOverviewLayout();
  setTimeout(() => { updateSP500Price(); updateSparkline(); updateMarketStatus(); startAutoUpdate(); }, 500);
}

// Show content immediately with placeholders
el.loading.style.display = 'none';
el.content.style.display = 'block';
el.currentPrice.textContent = 'Loading...';
el.dayChange.innerHTML = TREND_PLACEHOLDER;
el.portfolioTotal.textContent = '$0';
el.portfolioPnL.innerHTML = '<span class="neutral">$0 (0.00%)</span>';
el.trendIndicators.style.display = 'grid';
setTrendsPlaceholder();

initialize();
