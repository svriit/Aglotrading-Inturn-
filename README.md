# Aglo Trading - Binary Options Trading Platform

A real-time binary options trading platform built with Flask and the Deriv API. Trade on Synthetic Indices, Forex, Commodities, and more with live charts and instant execution.

## Features

- **Real-Time Market Data** - Live tick-by-tick price feeds via WebSocket
- **Interactive Charts** - Custom canvas-based line and candlestick charts
- **Binary Options Trading** - Rise/Fall and Higher/Lower contracts
- **Portfolio Tracking** - Open positions with live P&L updates
- **Trade History** - Complete statement and transaction history
- **Multiple Markets** - Volatility indices, Jump indices, Forex, and more

## Tech Stack

- **Backend**: Python / Flask / Flask-SocketIO
- **Frontend**: HTML5 / CSS3 / Vanilla JavaScript
- **API**: Deriv WebSocket API (wss://ws.derivws.com)
- **Charts**: Custom HTML5 Canvas rendering engine

## Setup

1. Clone the repository:
```bash
git clone https://github.com/svriit/Aglotrading-Inturn-.git
cd Aglotrading-Inturn-
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Configure environment (optional):
```bash
cp .env.example .env
# Edit .env with your Deriv API token and app ID
```

4. Run the application:
```bash
python app.py
```

5. Open http://localhost:5000 in your browser.

## Getting a Deriv API Token

1. Create a free Deriv account at [deriv.com](https://deriv.com)
2. Go to [API Token settings](https://app.deriv.com/account/api-token)
3. Create a token with **Trade** and **Read** permissions
4. Use a **Demo account** to practice risk-free

## Project Structure

```
Aglotrading-Inturn-/
├── app.py                  # Flask application and SocketIO routes
├── deriv_api.py            # Deriv WebSocket API client
├── requirements.txt        # Python dependencies
├── .env.example            # Environment variables template
├── templates/
│   ├── index.html          # Landing page
│   └── dashboard.html      # Trading dashboard
├── static/
│   ├── css/
│   │   └── style.css       # All styles (landing + dashboard)
│   └── js/
│       ├── chart.js        # Canvas chart engine
│       └── trading.js      # Trading logic and WebSocket handler
└── simple moving avg.py    # Original SMA strategy script
```

## Disclaimer

Trading binary options involves substantial risk and may not be suitable for all investors. This platform is for educational and demonstration purposes. Past performance does not guarantee future results. Trade responsibly.
