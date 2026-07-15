# SwingTrader AI

An AI-powered NSE/BSE swing trading signal platform built with MERN stack + Python microservice + Claude Sonnet API.

## Architecture

```
swing-trader/
├── client/          React 18 + Vite + Tailwind (port 3001)
├── server/          Node.js 20 + Express 5 + socket.io (port 5001)
├── python-service/  FastAPI + yfinance + pandas-ta (port 8001)
└── docker-compose.yml
```

## Prerequisites

- Node.js >= 20.0.0
- Python >= 3.11
- Docker + Docker Compose
- MongoDB Atlas account (free tier)
- Anthropic API key
- Telegram Bot token (optional)
- Gmail account with App Password (optional)

## Quick Start (Docker)

```bash
# 1. Clone and navigate to project
cd swing-trader

# 2. Copy environment files and fill in your values
cp server/.env.example server/.env
cp python-service/.env.example python-service/.env
cp client/.env.local.example client/.env.local

# 3. Add your secrets to each .env file (see Configuration section)

# 4. Start all services
docker-compose up -d

# 5. Open the dashboard
open http://localhost:3001
```

## Manual Setup (Development)

### Python Microservice
```bash
cd python-service
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

### Node.js Server
```bash
cd server
npm install
# Ensure server/.env is filled in
npm run dev
```

### React Client
```bash
cd client
npm install
# Ensure client/.env.local is filled in
npm run dev
```

## Configuration

### server/.env — Required Keys

| Key | Description |
|-----|-------------|
| MONGODB_URI | MongoDB Atlas connection string |
| ANTHROPIC_API_KEY | Claude API key from console.anthropic.com |
| TELEGRAM_BOT_TOKEN | From @BotFather on Telegram |
| TELEGRAM_CHAT_ID | Your Telegram chat/group ID |
| EMAIL_USER | Gmail address for alerts |
| EMAIL_PASS | Gmail App Password (not your login password) |
| EMAIL_TO | Alert recipient email |

### Adding Stocks to Watchlist

1. Open the Settings page in the dashboard
2. Enter the NSE symbol (e.g., RELIANCE, TCS, INFY)
3. The scanner will include it in the next 15-minute cycle

## How It Works

1. Every 15 minutes during market hours (9:15 AM – 3:30 PM IST), the scanner runs
2. For each stock in your watchlist, the Python service fetches OHLCV data and computes 8 indicators
3. The Node.js server runs 8 safety gates (see below)
4. If 5+ gates pass, Claude Sonnet analyzes the setup and returns a BUY/WAIT/SKIP verdict
5. Results appear on the React dashboard in real-time via WebSocket
6. BUY signals trigger Telegram + email alerts instantly

## The 8-Gate System

| Gate | Check | Type |
|------|-------|------|
| Gate 1 | Nifty 50 above 20 EMA | HARD BLOCK |
| Gate 2 | Stock above weekly 50 EMA | HARD BLOCK |
| Gate 3 | No earnings within 15 days | HARD BLOCK |
| Gate 4 | RSI between 40–65 | STRONG FILTER |
| Gate 5 | Volume ≥ 1.5x 20-day avg | STRONG FILTER |
| Gate 6 | Risk:Reward ≥ 2:1 | HARD BLOCK |
| Gate 7 | Claude confidence = HIGH | INTELLIGENCE |
| Gate 8 | News sentiment ≠ NEGATIVE | HARD BLOCK |

## Capital Protection Rules

- Max 1% risk per trade (hard minimum)
- Max 3 simultaneous open trades
- Max 60% capital deployed at once
- If daily loss exceeds 3%, signals pause for the day
- If Nifty breaks below 20 EMA, ALL BUY signals are blocked

## Important: No Auto-Trading

This system **never** places trades automatically. All signals require human confirmation. Paper trade mode is ON by default.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/signals | Latest signals for all watchlist stocks |
| GET | /api/signals/active | Active BUY signals only |
| GET | /api/trades | All trades (open + closed) |
| POST | /api/trades | Log a new trade |
| GET | /api/performance | Win rate, P&L, drawdown stats |
| GET | /api/watchlist | Current watchlist |
| POST | /api/watchlist | Add stock |
| GET | /api/market | Nifty, VIX, market mode |
| POST | /api/chat | Ask Claude anything |

## Development Commands

```bash
# Lint server code
cd server && npm run lint

# Format server code
cd server && npm run format

# Lint client code
cd client && npm run lint

# Format Python code
cd python-service && black app/ && isort app/

# View logs
docker-compose logs -f server
docker-compose logs -f python-service

# Stop all services
docker-compose down

# Reset database
docker-compose down -v
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Vite, Tailwind CSS, socket.io-client |
| Charts | Recharts (performance), lightweight-charts (candlestick) |
| Backend | Node.js 20, Express 5, socket.io, mongoose |
| AI | Claude Sonnet via @anthropic-ai/sdk |
| Data | Python FastAPI, yfinance, pandas-ta, scipy |
| Database | MongoDB Atlas |
| Notifications | Telegram Bot API, Nodemailer |
| DevOps | Docker, docker-compose |

## License

Private — for personal trading use only. Not financial advice.
