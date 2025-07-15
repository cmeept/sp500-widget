const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let tray = null;
let mainWindow = null;
let isExpanded = false;
const collapsedHeight = 160;
const baseExpandedHeight = 250;
const addFormHeight = 120; // Дополнительная высота для формы добавления
const stockItemHeight = 22;

// Функция для расчета максимальной высоты окна с учетом размера экрана
function getMaxWindowHeight() {
  const { height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  return Math.max(400, screenHeight - 100); // Минимум 400px, максимум - высота экрана минус 100px отступов
}

const configPath = path.join(os.homedir(), '.sp500-widget-config.json');
const portfolioPath = path.join(os.homedir(), '.sp500-widget-portfolio.json');

function saveWindowConfig(x, y, expanded = false) {
  try {
    // Загружаем существующий конфиг
    let config = { collapsedPosition: null, expandedPosition: null };
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(configData);
    }
    
    // Сохраняем позицию в соответствующем состоянии
    if (expanded) {
      config.expandedPosition = { x, y };
    } else {
      config.collapsedPosition = { x, y };
    }
    
    config.lastSaved = new Date().toISOString();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
  }
}

ipcMain.on('resize-for-stocks', (event, stockCount) => {
  if (!mainWindow || mainWindow.isDestroyed() || !isExpanded) return;
  
  
  const calculatedHeight = Math.min(
    baseExpandedHeight + (stockCount * stockItemHeight),
    getMaxWindowHeight()
  );
  
  const [currentX, currentY] = mainWindow.getPosition();
  const { height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  
  // При изменении количества акций подстраиваем высоту, но стараемся сохранить позицию
  let newY = currentY;
  
  // Если новая высота не помещается, корректируем позицию
  if (currentY + calculatedHeight > screenHeight - 50) {
    newY = Math.max(50, screenHeight - calculatedHeight - 50);
  }
  
  // Убеждаемся, что окно не выходит за левую и правую границы экрана
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
  const newX = Math.max(0, Math.min(currentX, screenWidth - 290));
  
  
  mainWindow.setBounds({ 
    x: newX, 
    y: newY, 
    width: 290, 
    height: calculatedHeight 
  });
  
  saveWindowConfig(newX, newY, isExpanded);
});

function loadWindowConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      
      // Всегда запускаем в свернутом виде
      isExpanded = false;
      
      // Используем позицию свернутого состояния
      if (config.collapsedPosition) {
        const { x, y } = config.collapsedPosition;
        const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
        
        // Проверяем, что позиция в пределах экрана
        if (x >= 0 && y >= 0 && x <= screenWidth - 290 && y <= screenHeight - collapsedHeight) {
          return { x, y };
        }
      }
      
      // Fallback для старого формата конфига
      if (config.windowPosition) {
        const { x, y } = config.windowPosition;
        const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
        
        if (x >= 0 && y >= 0 && x <= screenWidth - 290 && y <= screenHeight - collapsedHeight) {
          return { x, y };
        }
      }
    }
  } catch (error) {
  }
  
  // Позиция по умолчанию
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  isExpanded = false;
  return { x: width - 310, y: height - 180 };
}

// IPC Handlers
ipcMain.on('close-app', () => {
  // Принудительно закрываем все окна перед выходом
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
    mainWindow = null;
  }
  app.quit();
});
ipcMain.on('minimize-to-tray', () => { if (mainWindow) mainWindow.hide(); });

// Обработчик для исправления полей через DevTools
ipcMain.on('resize-to-content', (event, height) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      const [currentX, currentY] = mainWindow.getPosition();
      
      // Принудительно ограничиваем высоту для свернутого состояния
      let finalHeight = height;
      if (!isExpanded && height !== collapsedHeight) {
        finalHeight = collapsedHeight;
      }
      
      mainWindow.setBounds({ 
        x: currentX, 
        y: currentY, 
        width: 290, 
        height: finalHeight 
      });
    } catch (err) {
      console.error('Error resizing window:', err);
    }
  }
});

ipcMain.on('fix-fields-focus', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      // Убираем фокус с окна, делая его неактивным
      mainWindow.blur();
      
      // Через короткое время возвращаем фокус
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.focus();
          // Отправляем сигнал обратно в renderer
          mainWindow.webContents.send('focus-toggle-completed');
        }
      }, 10);
    } catch (err) {
    }
  }
});

ipcMain.handle('load-portfolio', async () => {
  try {
    if (fs.existsSync(portfolioPath)) {
      const portfolioData = fs.readFileSync(portfolioPath, 'utf8');
      return JSON.parse(portfolioData);
    }
    return { stocks: [], lastUpdated: null };
  } catch (error) {
    return { stocks: [], lastUpdated: null };
  }
});

ipcMain.handle('save-portfolio', async (event, portfolio) => {
  try {
    const portfolioData = {
      ...portfolio,
      lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(portfolioPath, JSON.stringify(portfolioData, null, 2));
    return true;
  } catch (error) {
    return false;
  }
});

ipcMain.handle('get-live-prices', async (event, symbols) => {
  const prices = {};
  
  for (const symbol of symbols) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.chart && data.chart.result && data.chart.result[0]) {
        const result = data.chart.result[0];
        const currentPrice = result.meta.regularMarketPrice || result.meta.previousClose;
        const previousClose = result.meta.previousClose;
        
        prices[symbol] = {
          price: currentPrice,
          change: currentPrice - previousClose,
          changePercent: ((currentPrice - previousClose) / previousClose) * 100
        };
      }
    } catch (error) {
      prices[symbol] = null;
    }
  }
  
  return prices;
});

ipcMain.on('show-add-form', (event) => {
  if (!mainWindow || mainWindow.isDestroyed() || !isExpanded) return;
  
  // Получаем количество акций из renderer процесса
  mainWindow.webContents.executeJavaScript('portfolio.stocks.length')
    .then(count => {
      const calculatedHeight = Math.min(
        baseExpandedHeight + (count * stockItemHeight) + addFormHeight,
        getMaxWindowHeight()
      );
      
      const [currentX, currentY] = mainWindow.getPosition();
      const { height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
      
      // Корректируем позицию если окно выходит за экран
      let newY = currentY;
      if (currentY + calculatedHeight > screenHeight - 50) {
        newY = Math.max(50, screenHeight - calculatedHeight - 50);
      }
      
      // Убеждаемся, что окно не выходит за левую и правую границы экрана
      const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
      const newX = Math.max(0, Math.min(currentX, screenWidth - 290));
      
      
      mainWindow.setBounds({ 
        x: newX, 
        y: newY, 
        width: 290, 
        height: calculatedHeight 
      });
    })
});

ipcMain.on('hide-add-form', (event) => {
  if (!mainWindow || mainWindow.isDestroyed() || !isExpanded) return;
  
  // Получаем количество акций из renderer процесса
  mainWindow.webContents.executeJavaScript('portfolio.stocks.length')
    .then(count => {
      const calculatedHeight = Math.min(
        baseExpandedHeight + (count * stockItemHeight),
        getMaxWindowHeight()
      );
      
      const [currentX, currentY] = mainWindow.getPosition();
      
      
      mainWindow.setBounds({ 
        x: currentX, 
        y: currentY, 
        width: 290, 
        height: calculatedHeight 
      });
    })
});

ipcMain.on('show-reduce-form', (event) => {
  if (!mainWindow || mainWindow.isDestroyed() || !isExpanded) return;
  
  // Получаем количество акций из renderer процесса
  mainWindow.webContents.executeJavaScript('portfolio.stocks.length')
    .then(count => {
      const calculatedHeight = Math.min(
        baseExpandedHeight + (count * stockItemHeight) + addFormHeight,
        getMaxWindowHeight()
      );
      
      const [currentX, currentY] = mainWindow.getPosition();
      const { height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
      
      // Корректируем позицию если окно выходит за экран
      let newY = currentY;
      if (currentY + calculatedHeight > screenHeight - 50) {
        newY = Math.max(50, screenHeight - calculatedHeight - 50);
      }
      
      // Убеждаемся, что окно не выходит за левую и правую границы экрана
      const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
      const newX = Math.max(0, Math.min(currentX, screenWidth - 290));
      
      
      mainWindow.setBounds({ 
        x: newX, 
        y: newY, 
        width: 290, 
        height: calculatedHeight 
      });
    })
});

ipcMain.on('hide-reduce-form', (event) => {
  if (!mainWindow || mainWindow.isDestroyed() || !isExpanded) return;
  
  // Получаем количество акций из renderer процесса
  mainWindow.webContents.executeJavaScript('portfolio.stocks.length')
    .then(count => {
      const calculatedHeight = Math.min(
        baseExpandedHeight + (count * stockItemHeight),
        getMaxWindowHeight()
      );
      
      const [currentX, currentY] = mainWindow.getPosition();
      
      
      mainWindow.setBounds({ 
        x: currentX, 
        y: currentY, 
        width: 290, 
        height: calculatedHeight 
      });
    })
});

ipcMain.on('toggle-expand', () => {
  
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  
  const [currentX, currentY] = mainWindow.getPosition();
  
  isExpanded = !isExpanded;
  
  if (isExpanded) {
    
    // Сохраняем текущую позицию как "свернутую" для возврата
    const tempConfigPath = path.join(os.homedir(), '.sp500-widget-temp.json');
    const tempConfig = { 
      collapsedPosition: { x: currentX, y: currentY },
      timestamp: new Date().toISOString()
    };
    try {
      fs.writeFileSync(tempConfigPath, JSON.stringify(tempConfig, null, 2));
    } catch (error) {
    }
    
    // Получаем количество акций для расчета высоты
    mainWindow.webContents.send('get-stock-count-for-expand');
  } else {
    
    // Возвращаемся к свернутому состоянию
    // Сначала пробуем восстановить из временного файла
    const tempConfigPath = path.join(os.homedir(), '.sp500-widget-temp.json');
    try {
      if (fs.existsSync(tempConfigPath)) {
        const tempConfigData = fs.readFileSync(tempConfigPath, 'utf8');
        const tempConfig = JSON.parse(tempConfigData);
        if (tempConfig.collapsedPosition) {
          const { x, y } = tempConfig.collapsedPosition;
          mainWindow.setBounds({ x, y, width: 290, height: collapsedHeight });
          saveWindowConfig(x, y, isExpanded);
          
          // Удаляем временный файл
          fs.unlinkSync(tempConfigPath);
          return;
        }
      }
    } catch (error) {
    }
    
    // Если нет временного файла, пробуем основной конфиг
    try {
      if (fs.existsSync(configPath)) {
        const configData = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configData);
        if (config.collapsedPosition) {
          const { x, y } = config.collapsedPosition;
          mainWindow.setBounds({ x, y, width: 290, height: collapsedHeight });
          saveWindowConfig(x, y, isExpanded);
          return;
        }
      }
    } catch (error) {
    }
    
    // Fallback - просто изменяем размер без перемещения
    mainWindow.setBounds({ 
      x: currentX, 
      y: currentY, 
      width: 290, 
      height: collapsedHeight 
    });
    saveWindowConfig(currentX, currentY, isExpanded);
  }
  
});

ipcMain.on('expand-window-with-height', (event, stockCount) => {
  
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  
  const calculatedHeight = Math.min(
    baseExpandedHeight + (stockCount * stockItemHeight),
    getMaxWindowHeight()
  );
  
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  
  // Размещаем окно в центре экрана при расширении, но проверяем границы
  let centerX = Math.floor((screenWidth - 290) / 2);
  let centerY = Math.floor((screenHeight - calculatedHeight) / 2);
  
  // Убеждаемся, что окно не выходит за пределы экрана
  centerX = Math.max(0, Math.min(centerX, screenWidth - 290));
  centerY = Math.max(0, Math.min(centerY, screenHeight - calculatedHeight));
  
  
  try {
    mainWindow.setBounds({ 
      x: centerX, 
      y: centerY, 
      width: 290, 
      height: calculatedHeight 
    });
    
    const [newX, newY] = mainWindow.getPosition();
    const [newWidth, newHeight] = mainWindow.getSize();
    
    saveWindowConfig(centerX, centerY, isExpanded);
    
  } catch (error) {
  }
  
});

function setupAutostart() {
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: false,
      name: 'S&P 500 Widget',
      path: process.execPath
    });
  } catch (error) {
  }
}

function createTray() {
  // Используем новую иконку PNG для трея | Use new PNG icon for tray
  const trayIconPath = path.join(__dirname, 'icons', 'sp500_cool_transparent_32x32.png');
  const trayIcon = nativeImage.createFromPath(trayIconPath);
  tray = new Tray(trayIcon);
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Показать виджет', 
      click: () => showWidget() 
    },
    { 
      label: 'Скрыть виджет', 
      click: () => hideWidget() 
    },
    { type: 'separator' },
    {
      label: 'О программе', 
      click: () => {
        dialog.showMessageBox(null, {
          type: 'info',
          title: 'О программе',
          message: 'S&P 500 Widget v1.0.0',
          detail: 'Красивый виджет с данными индекса S&P 500 и портфелем акций.\n\nФункции:\n• Отслеживание S&P 500\n• Управление портфелем\n• Актуальные котировки\n• Автозапуск с Windows'
        });
      }
    },
    { type: 'separator' },
    { 
      label: 'Выход', 
      click: () => app.quit() 
    }
  ]);
  
  tray.setToolTip('S&P 500 Widget - Market Tracker');
  tray.setContextMenu(contextMenu);
  
  tray.on('double-click', () => {
    if (mainWindow && mainWindow.isVisible() && !mainWindow.isDestroyed()) {
      hideWidget();
    } else {
      showWidget();
    }
  });
}

function showWidget() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  createWindow();
}

function hideWidget() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
    mainWindow = null;
  }
  
  const pos = loadWindowConfig();
  const windowHeight = isExpanded ? baseExpandedHeight : collapsedHeight;
  
  mainWindow = new BrowserWindow({
    width: 290,
    height: windowHeight,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: false,
    backgroundColor: "#191929",
    alwaysOnTop: false,
    icon: path.join(__dirname, 'icons', 'sp500_cool_transparent_ico256.ico'),
    titleBarStyle: 'hidden',
    title: '',
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      devTools: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Всегда запускаем в свернутом виде
    isExpanded = false;
    mainWindow.webContents.send('set-expanded', false);
  });
  
  mainWindow.on('move', () => {
    const [x, y] = mainWindow.getPosition();
    saveWindowConfig(x, y, isExpanded);
  });
  
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createTray();
  showWidget();
  setupAutostart();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    showWidget();
  }
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('before-quit', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const [x, y] = mainWindow.getPosition();
    saveWindowConfig(x, y, isExpanded);
    mainWindow.destroy();
    mainWindow = null;
  }
});

// Добавляем обработчик для принудительного завершения
app.on('will-quit', (event) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
    mainWindow = null;
  }
});