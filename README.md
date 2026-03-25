# S&P 500 Widget

**EN** | [RU](#ru)

Beautiful desktop widget for real-time S&P 500 tracking and stock portfolio management. Built with Electron.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Electron](https://img.shields.io/badge/Electron-41-blue)

---

## Features

- **Real-time S&P 500 tracking** — live index price, updated every 15 seconds
- **Portfolio management** — buy, sell, and track your stock holdings
- **Live quotes** — real-time stock prices from Yahoo Finance
- **Trend analytics** — weekly, monthly, and yearly performance (S&P 500 & portfolio)
- **Auto-start** — launches automatically with Windows
- **Compact design** — minimal, beautiful widget that stays out of your way
- **Transparent rounded corners** — pixel-perfect look, no visual artifacts
- **Connection status indicator** — green/yellow/red dot shows data freshness
- **Offline resilience** — cached data shown when connection is lost

## Security

This version has been fully hardened following Electron security best practices:

- **Context Isolation** enabled — renderer process has zero access to Node.js APIs
- **Preload script** with `contextBridge` — only whitelisted IPC methods are exposed
- **Content Security Policy (CSP)** — restricts script/style/font sources
- **No `nodeIntegration`** — renderer runs in a sandboxed environment
- **All network requests via main process** — renderer never touches the network directly
- **Fetch with retry + timeout** — resilient to transient network failures
- **No `alert()`/`confirm()`** — replaced with non-blocking HTML notifications and modals

## Architecture

```
sp500-widget/
├── main.js          # Electron main process (window, tray, IPC, data fetching, caching)
├── preload.js       # contextBridge — safe IPC API for renderer
├── renderer.js      # Frontend logic (UI, portfolio, trends)
├── styles.css       # All styles
├── index.html       # Clean HTML markup only
├── installer.nsh    # NSIS installer script (autostart, migration, cleanup)
├── package.json     # Config + electron-builder settings
└── icons/           # App icons
```

### Data flow

```
Yahoo Finance API  <-->  main.js (fetch + cache + retry)  <-->  preload.js (contextBridge)  <-->  renderer.js (UI)
```

- **Prices**: cached 10 seconds, retry up to 3 times with backoff
- **Historical data (1Y)**: cached 5 minutes — no hammering Yahoo API
- **Stale cache fallback**: if API fails, last cached data is used (up to 10 min)

## Installation

### Windows Installer
1. Download `SP500-Widget-Setup-1.0.0-x64.exe` from [Releases](https://github.com/cmeept/sp500-widget/releases)
2. Run the installer — choose install directory
3. Widget starts automatically after install and on every Windows boot

### Portable Version
Download `SP500-Widget-Portable-1.0.0.exe` — no installation required.

### Upgrading from old version
The installer automatically:
- Kills the running old widget process
- Cleans up old config files (`.sp500-widget-config.json`, `.sp500-widget-temp.json`)
- Preserves your portfolio data — migrated to new format on first launch
- Updates the Windows autostart registry entry

## Development

### Prerequisites
- Node.js 18+
- npm

### Setup
```bash
git clone https://github.com/cmeept/sp500-widget.git
cd sp500-widget
npm install
npm start          # Run the widget
npm run dev        # Run with DevTools enabled
npm run build-installer   # Build Windows installer
npm run build-portable    # Build portable version
```

## What was fixed in v1.1

### Security
- Enabled `contextIsolation: true` + disabled `nodeIntegration`
- Created `preload.js` with `contextBridge` (only safe IPC methods exposed)
- Added Content Security Policy header
- Replaced `alert()`/`confirm()`/`prompt()` with HTML notifications and modals
- DevTools only enabled via `--dev` flag

### Architecture
- Split monolithic `index.html` (2248 lines) into `index.html` + `styles.css` + `renderer.js`
- Eliminated 4x duplicated show/hide form handlers in main.js → single function
- Replaced 3 manual JSON config files with `electron-store`
- Removed `node-fetch` dependency (native `fetch` in Electron 28+)

### Data accuracy
- **Fixed portfolio trend calculation** — old code used array index offset (`findPriceAt(365)`) which confused trading days with calendar days. New code uses binary search on timestamps to find the correct price at any date
- **All network requests moved to main process** — cached, retried, with timeout
- **Separated update intervals**: prices every 15s, trends every 60s (historical data cached 5 min)

### Reliability
- Fetch with retry (3 attempts, exponential backoff, 10s timeout)
- Data cache with stale fallback (if API fails, shows last cached data)
- Connection status indicator (green/yellow/red)
- Graceful offline handling

### UI fixes
- Fixed widget not draggable after refactor (`-webkit-app-region: drag` on body)
- Fixed black corners — `transparent: true` window with CSS border-radius
- Removed all debug junk (test fields, alternative inputs, `window.testPrompt`, etc.)
- Removed old files: `index_old.html`, `main_old.js`, `nul`, `test.html`

### Installer
- Old process killed before install
- Old config files cleaned up
- Portfolio data preserved and migrated on first launch
- Clean uninstall with option to keep or remove user data

### Dependencies
- Electron: 37.2.1 → 41.0.4
- electron-builder: 24.13.3 → 26.8.1
- Removed: `node-fetch` (native fetch available)

---

<a id="ru"></a>

# S&P 500 Widget (RU)

[EN](#) | **RU**

Красивый десктопный виджет для отслеживания индекса S&P 500 в реальном времени и управления портфелем акций. Построен на Electron.

---

## Возможности

- **Отслеживание S&P 500 в реальном времени** — актуальная цена индекса, обновление каждые 15 секунд
- **Управление портфелем** — покупка, продажа и отслеживание акций
- **Живые котировки** — актуальные цены акций с Yahoo Finance
- **Аналитика трендов** — недельная, месячная и годовая динамика (S&P 500 и портфель)
- **Автозапуск** — запускается автоматически с Windows
- **Компактный дизайн** — минималистичный, красивый виджет
- **Прозрачные скруглённые углы** — идеальный вид без визуальных артефактов
- **Индикатор соединения** — зелёная/жёлтая/красная точка показывает свежесть данных
- **Работа офлайн** — кешированные данные показываются при потере соединения

## Безопасность

Версия полностью защищена по лучшим практикам безопасности Electron:

- **Context Isolation** включён — renderer-процесс не имеет доступа к Node.js API
- **Preload-скрипт** с `contextBridge` — открыты только разрешённые IPC-методы
- **Content Security Policy (CSP)** — ограничены источники скриптов, стилей, шрифтов
- **`nodeIntegration` отключён** — renderer работает в изолированной среде
- **Все сетевые запросы через main process** — renderer не обращается к сети напрямую
- **Fetch с повторами и таймаутом** — устойчивость к сбоям сети
- **Нет `alert()`/`confirm()`** — заменены на HTML-нотификации и модальные окна

## Архитектура

```
sp500-widget/
├── main.js          # Main process (окно, трей, IPC, загрузка данных, кеш)
├── preload.js       # contextBridge — безопасный IPC API для renderer
├── renderer.js      # Логика фронтенда (UI, портфель, тренды)
├── styles.css       # Все стили
├── index.html       # Чистая HTML-разметка
├── installer.nsh    # NSIS-скрипт установщика (автозапуск, миграция, очистка)
├── package.json     # Конфигурация + настройки electron-builder
└── icons/           # Иконки приложения
```

### Поток данных

```
Yahoo Finance API  <-->  main.js (fetch + кеш + retry)  <-->  preload.js (contextBridge)  <-->  renderer.js (UI)
```

- **Цены**: кеш 10 секунд, до 3 повторов с нарастающей задержкой
- **Исторические данные (1 год)**: кеш 5 минут
- **Fallback на устаревший кеш**: при сбое API показываются последние данные (до 10 мин)

## Установка

### Windows Installer
1. Скачайте `SP500-Widget-Setup-1.0.0-x64.exe` из [Releases](https://github.com/cmeept/sp500-widget/releases)
2. Запустите установщик — выберите каталог установки
3. Виджет запустится автоматически после установки и при каждой загрузке Windows

### Портативная версия
Скачайте `SP500-Widget-Portable-1.0.0.exe` — установка не требуется.

### Обновление со старой версии
Установщик автоматически:
- Завершает запущенный старый процесс виджета
- Удаляет старые файлы конфигурации
- Сохраняет данные портфеля — мигрирует в новый формат при первом запуске
- Обновляет запись автозапуска в реестре Windows

## Разработка

### Требования
- Node.js 18+
- npm

### Настройка
```bash
git clone https://github.com/cmeept/sp500-widget.git
cd sp500-widget
npm install
npm start          # Запуск виджета
npm run dev        # Запуск с DevTools
npm run build-installer   # Сборка Windows-установщика
npm run build-portable    # Сборка портативной версии
```

## Что исправлено в v1.1

### Безопасность
- Включён `contextIsolation: true` + отключён `nodeIntegration`
- Создан `preload.js` с `contextBridge` (открыты только безопасные IPC-методы)
- Добавлен заголовок Content Security Policy
- `alert()`/`confirm()`/`prompt()` заменены на HTML-нотификации и модальные окна
- DevTools включаются только через флаг `--dev`

### Архитектура
- Монолитный `index.html` (2248 строк) разделён на `index.html` + `styles.css` + `renderer.js`
- 4 дублированных обработчика show/hide форм → одна функция
- 3 ручных JSON-файла конфигурации заменены на `electron-store`
- Удалена зависимость `node-fetch` (нативный `fetch` в Electron 28+)

### Точность данных
- **Исправлен расчёт трендов портфеля** — старый код использовал смещение индекса массива (`findPriceAt(365)`), путая торговые и календарные дни. Новый код использует бинарный поиск по timestamp для нахождения цены на любую дату
- **Все сетевые запросы перенесены в main process** — с кешем, повторами и таймаутом
- **Разделены интервалы обновления**: цены каждые 15 сек, тренды каждые 60 сек (исторические данные кешируются 5 мин)

### Надёжность
- Fetch с повторами (3 попытки, экспоненциальный backoff, таймаут 10 сек)
- Кеш данных с fallback на устаревшие (при сбое API показываются последние данные)
- Индикатор состояния соединения (зелёный/жёлтый/красный)
- Корректная работа офлайн

### UI
- Исправлено перетаскивание виджета (`-webkit-app-region: drag` на body)
- Исправлены чёрные углы — `transparent: true` окно с CSS border-radius
- Удалён весь отладочный мусор (тестовые поля, альтернативные инпуты, `window.testPrompt` и т.д.)
- Удалены старые файлы: `index_old.html`, `main_old.js`, `nul`, `test.html`

### Установщик
- Старый процесс завершается перед установкой
- Старые файлы конфигурации очищаются
- Данные портфеля сохраняются и мигрируются при первом запуске
- Чистое удаление с возможностью сохранить или удалить данные пользователя

### Зависимости
- Electron: 37.2.1 → 41.0.4
- electron-builder: 24.13.3 → 26.8.1
- Удалён: `node-fetch` (доступен нативный fetch)

---

## License / Лицензия

MIT License — see [LICENSE](LICENSE)

**Made for traders and investors**
