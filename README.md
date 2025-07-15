# S&P 500 Widget 📈

Beautiful S&P 500 market data widget with portfolio tracking for your desktop. Built with Electron for Windows, Mac, and Linux.

![S&P 500 Widget](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

- **Real-time S&P 500 tracking** - Live index price updates every 10 seconds
- **Portfolio management** - Add, track, and manage your stock holdings
- **Live quotes** - Real-time stock prices from Yahoo Finance
- **Trends & analytics** - Weekly, monthly, and yearly performance charts
- **Auto-start** - Launches automatically with Windows
- **Compact design** - Minimal, beautiful interface that stays out of your way
- **Dual language** - English and Russian interface support

## 🚀 Installation

### Windows
1. Download the latest installer: `SP500-Widget-Setup-1.0.0-x64.exe`
2. Run the installer and follow the setup wizard
3. The widget will automatically start with Windows

### Portable Version
Download `SP500-Widget-Portable-1.0.0.exe` - no installation required!

## 🖥️ Usage

### Basic Operation
- **Collapsed view**: Shows S&P 500 price and trend indicators
- **Expanded view**: Click `+` to manage your portfolio
- **Add stocks**: Click `+ Buy Stocks` and enter symbol, quantity, and price
- **Auto-pricing**: Leave price field empty to fetch current market price
- **Sell stocks**: Click `- Sell Stocks` to reduce holdings

### Portfolio Features
- Real-time P&L calculation
- Percentage gains/losses
- Current market values
- Average cost basis tracking

## 🛠️ Development

### Prerequisites
- Node.js 16+ 
- npm or yarn

### Setup
```bash
# Clone the repository
git clone https://github.com/cmeept/sp500-widget.git
cd sp500-widget

# Install dependencies
npm install

# Run in development mode
npm start

# Build for production
npm run build-installer  # Windows installer
npm run build-portable   # Portable version
npm run build-win       # All Windows formats
```

### Project Structure
```
sp500-widget/
├── main.js              # Electron main process
├── index.html           # Widget UI
├── package.json         # Project configuration
├── installer.nsh       # Windows installer script
├── icons/              # Application icons
└── dist/               # Built installers (generated)
```

## 🔧 Configuration

The widget automatically saves:
- Window position and size
- Portfolio data
- User preferences

Configuration files are stored in:
- Windows: `%USERPROFILE%\.sp500-widget-*`
- macOS: `~/.sp500-widget-*`
- Linux: `~/.sp500-widget-*`

## 📊 Data Sources

- **S&P 500 Data**: Yahoo Finance API
- **Stock Quotes**: Yahoo Finance API
- **Update Frequency**: Every 10 seconds
- **Historical Data**: 1 year for trend calculations

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🐛 Issues & Support

Found a bug or need help? Please [open an issue](https://github.com/cmeept/sp500-widget/issues).

## 🌟 Acknowledgments

- Yahoo Finance for providing free market data APIs
- Electron framework for cross-platform desktop apps
- Inter font family for beautiful typography

---

**Made with ❤️ for traders and investors**