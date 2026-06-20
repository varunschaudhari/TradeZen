# SwingTrader AI — Claude Setup Prompt
# Copy this entire prompt into a new Claude conversation to scaffold the project

---

## MASTER PROMPT — PASTE THIS INTO A NEW CLAUDE CHAT

```
You are a senior full-stack engineer and AI integration specialist.
I want you to build a production-ready AI-powered swing trading platform
called "SwingTrader AI" using MERN stack + Python microservice + Claude API.

Read every requirement carefully before writing a single line of code.
Ask clarifying questions if anything is ambiguous.
Follow all coding standards listed below without exception.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 1 — PROJECT OVERVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SwingTrader AI is an automated NSE/BSE swing trading signal platform that:
- Fetches live stock data every 15 minutes during market hours
- Computes 8 technical indicators per stock
- Runs an 8-gate safety filter before any trade signal
- Sends indicator data to Claude Sonnet API for intelligent BUY/WAIT/SKIP verdict
- Displays results on a real-time React dashboard
- Sends Telegram + Email alerts instantly on BUY signals
- Never places trades automatically — human always confirms

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 2 — TECH STACK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FRONTEND   : React 18 + Vite + Tailwind CSS + socket.io-client
             - recharts for performance charts
             - lightweight-charts (TradingView) for candlestick charts
             - axios for REST API calls
             - react-router-dom v6 for routing
             - react-hot-toast for notifications

BACKEND    : Node.js 20 + Express 5 + socket.io
             - mongoose for MongoDB ODM
             - node-cron for scheduling (every 15 min)
             - @anthropic-ai/sdk for Claude API
             - node-telegram-bot-api for Telegram
             - nodemailer for Email alerts
             - rss-parser for Google News RSS (Gate 8)
             - axios for Python microservice calls
             - helmet + cors + express-rate-limit for security
             - winston for structured logging
             - joi for request validation
             - dotenv for environment config

DATABASE   : MongoDB Atlas (free tier) via Mongoose

PYTHON     : FastAPI + uvicorn (microservice on port 8001)
             - yfinance for NSE OHLCV data
             - pandas + pandas-ta for indicators
             - scipy for S/R swing detection
             - numpy for Fibonacci calculations

DEVOPS     : Docker + docker-compose for local development
             - .env files for all secrets (never hardcode)
             - ESLint + Prettier for JS/TS formatting
             - Black + isort for Python formatting

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 3 — PROJECT FOLDER STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Build exactly this structure — no deviations:

swing-trader/
├── client/                         ← React frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── MarketStatusBar.jsx
│   │   │   ├── SignalCard.jsx
│   │   │   ├── TradeCard.jsx
│   │   │   ├── PositionTracker.jsx
│   │   │   ├── PerformanceChart.jsx
│   │   │   ├── CandlestickChart.jsx
│   │   │   ├── NewsWidget.jsx
│   │   │   └── ChatWidget.jsx
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Positions.jsx
│   │   │   ├── Performance.jsx
│   │   │   ├── Watchlist.jsx
│   │   │   └── Settings.jsx
│   │   ├── hooks/
│   │   │   ├── useSocket.js
│   │   │   ├── useSignals.js
│   │   │   └── useMarketStatus.js
│   │   ├── services/
│   │   │   └── api.js              ← all axios calls centralized
│   │   ├── context/
│   │   │   └── AppContext.jsx
│   │   ├── utils/
│   │   │   ├── formatters.js       ← currency, %, date formatting
│   │   │   └── constants.js        ← gate names, colors, enums
│   │   └── App.jsx
│   ├── .env.local
│   ├── vite.config.js
│   └── tailwind.config.js
│
├── server/                         ← Node.js + Express backend
│   ├── src/
│   │   ├── config/
│   │   │   ├── db.js               ← MongoDB connection
│   │   │   ├── logger.js           ← Winston logger
│   │   │   └── constants.js        ← market hours, thresholds
│   │   ├── models/
│   │   │   ├── Signal.js
│   │   │   ├── Trade.js
│   │   │   ├── OHLCV.js
│   │   │   ├── News.js
│   │   │   ├── Performance.js
│   │   │   └── Config.js
│   │   ├── routes/
│   │   │   ├── signals.js
│   │   │   ├── trades.js
│   │   │   ├── watchlist.js
│   │   │   ├── performance.js
│   │   │   ├── news.js
│   │   │   └── chat.js             ← Ask Claude endpoint
│   │   ├── services/
│   │   │   ├── claudeEngine.js     ← Claude API + prompt builder
│   │   │   ├── gateChecker.js      ← All 8 gates logic
│   │   │   ├── notifier.js         ← Telegram + Email
│   │   │   ├── newsFetcher.js      ← RSS + sentiment (Gate 8)
│   │   │   ├── pythonBridge.js     ← calls Python microservice
│   │   │   └── reportGenerator.js  ← daily/weekly reports
│   │   ├── scheduler/
│   │   │   ├── marketScanner.js    ← main 15-min cron job
│   │   │   ├── morningBrief.js     ← 8:30 AM daily
│   │   │   ├── eveningSummary.js   ← 4:00 PM daily
│   │   │   └── weeklyReport.js     ← Sunday 8 AM
│   │   ├── socket/
│   │   │   └── socketHandlers.js   ← WebSocket events
│   │   ├── middleware/
│   │   │   ├── errorHandler.js
│   │   │   ├── validateRequest.js
│   │   │   └── rateLimiter.js
│   │   └── app.js                  ← Express app entry
│   ├── .env
│   └── package.json
│
├── python-service/                 ← Python FastAPI microservice
│   ├── app/
│   │   ├── main.py                 ← FastAPI entry point
│   │   ├── routers/
│   │   │   └── analyze.py          ← POST /analyze endpoint
│   │   ├── services/
│   │   │   ├── data_fetcher.py     ← yfinance OHLCV
│   │   │   ├── indicators.py       ← all 8 indicators
│   │   │   ├── support_resistance.py ← swing S/R + Fibonacci
│   │   │   └── market_data.py      ← Nifty, VIX, A/D ratio
│   │   ├── models/
│   │   │   └── schemas.py          ← Pydantic request/response
│   │   └── config.py
│   ├── requirements.txt
│   └── .env
│
├── docker-compose.yml              ← runs all 3 services
├── .gitignore
└── README.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 4 — CODING STANDARDS (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Apply ALL of these without being asked:

GENERAL:
- Every file must have a comment block at the top:
  file name, purpose, author, created date, last modified
- Every function must have a JSDoc comment (JS) or docstring (Python)
  explaining params, return value, and what it does
- No magic numbers — use named constants from constants.js/constants.py
- Max function length: 50 lines. If longer, split into sub-functions.
- Max file length: 300 lines. If longer, split into modules.
- Descriptive variable names — no single letters except loop counters
- One responsibility per function (Single Responsibility Principle)

ERROR HANDLING:
- Every async function wrapped in try/catch
- All errors logged via Winston (server) with stack trace
- Never expose internal error details to the client
- Return consistent error format: { success: false, error: string, code: number }
- Python: use FastAPI HTTPException with proper status codes

SECURITY:
- All secrets in .env files — never hardcoded
- .env files listed in .gitignore
- API routes protected with rate limiting (express-rate-limit)
- Request bodies validated with Joi before processing
- Mongoose models use strict: true
- helmet() on Express app for security headers
- CORS configured for specific origins only

JAVASCRIPT / NODE.JS:
- Use ES modules (import/export) throughout — not require()
- Use async/await — no .then().catch() chains
- Destructure objects and arrays where appropriate
- Use optional chaining (?.) and nullish coalescing (??)
- Prefer const over let, never use var
- All API responses follow this format:
  Success: { success: true, data: any, message: string }
  Error:   { success: false, error: string, code: number }

REACT:
- Functional components only — no class components
- Custom hooks for all data fetching and socket logic
- PropTypes or TypeScript interfaces for all component props
- Loading states and error states for every data fetch
- Tailwind CSS only — no inline styles
- Responsive design — mobile first
- Memoize expensive computations with useMemo/useCallback

PYTHON:
- Type hints on every function parameter and return value
- Pydantic models for all request/response schemas
- Virtual environment (venv) for dependencies
- requirements.txt pinned with exact versions
- All data operations return typed Pydantic models
- No global state — pure functions where possible

MONGODB MODELS:
- Timestamps: true on every schema (createdAt, updatedAt)
- Indexes on frequently queried fields (stock symbol, timestamp)
- Enums for fixed value fields (verdict, confidence, marketMode)
- Default values specified for all optional fields

GIT:
- .gitignore includes: node_modules/, .env, __pycache__/,
  *.pyc, dist/, .DS_Store, venv/
- Commit message format: type(scope): description
  e.g. feat(scanner): add Gate 8 news sentiment check
       fix(notifier): handle Telegram timeout gracefully
       refactor(claude): extract prompt builder to separate function

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 5 — CORE BUSINESS LOGIC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

THE 8-GATE SYSTEM (implement exactly as specified):

Gate 1 — Nifty 50 above 20 EMA
  Pass: price > ema20 | Fail: SKIP all stocks, send bear mode alert
  Type: HARD BLOCK — if fails, do not call Claude API at all

Gate 2 — Stock weekly trend bullish (price above 50 EMA on weekly)
  Pass: weeklyClose > weeklyEma50 | Fail: SKIP this stock
  Type: HARD BLOCK

Gate 3 — No earnings within 15 days
  Pass: daysToEarnings > 15 or daysToEarnings === null
  Fail: SKIP this stock
  Type: HARD BLOCK

Gate 4 — RSI between 40 and 65
  Pass: rsi >= 40 && rsi <= 65 | Fail: SKIP this stock
  Type: STRONG FILTER

Gate 5 — Volume at least 1.5x 20-day average
  Pass: volumeRatio >= 1.5 | Fail: WAIT — note in signal
  Type: STRONG FILTER

Gate 6 — Risk:Reward ratio minimum 2:1
  Calculation: (target1 - entry) / (entry - stopLoss) >= 2.0
  Pass: rr >= 2.0 | Fail: SKIP
  Type: HARD BLOCK

Gate 7 — Claude confidence is HIGH
  Pass: claudeConfidence === 'HIGH'
  Medium → WAIT card only, no entry/exit details
  Low → SKIP
  Type: INTELLIGENCE LAYER

Gate 8 — News sentiment is NEUTRAL or POSITIVE
  Pass: sentiment !== 'NEGATIVE'
  Fail: SKIP even if all other gates pass
  Type: HARD BLOCK

POSITION SIZING (always apply this formula):
  maxRisk = capital * riskPercent (default 1%)
  riskPerShare = entryPrice - stopLoss
  shares = Math.floor(maxRisk / riskPerShare)
  capitalDeployed = shares * entryPrice
  Rule: max 3 open trades, max 60% capital deployed

CLAUDE PROMPT TEMPLATE (use exactly this structure):
  Build a function buildClaudePrompt(stockData, marketData, newsData) that
  generates this prompt dynamically:

  "You are an expert NSE swing trading analyst. Analyze this setup and
  return a JSON verdict.

  MARKET CONTEXT:
  - Nifty 50: {niftyPrice} | 20 EMA: {niftyEma20} | Mode: {marketMode}
  - India VIX: {vix} | Bank Nifty: {bankNiftyTrend}
  - A/D Ratio: {adRatio}

  STOCK: {symbol}
  Price: ₹{price} | Change: {dayChange}%
  EMA20: ₹{ema20} | EMA50: ₹{ema50} | EMA200: ₹{ema200}
  RSI14: {rsi} | MACD: {macd} / Signal: {macdSignal}
  Volume ratio: {volRatio}x avg | ATR14: ₹{atr}
  Bollinger %B: {bollingerB}
  Today's candle: {candlePattern}

  KEY LEVELS:
  Support: ₹{s1} (strong), ₹{s2}, ₹{s3}
  Resistance: ₹{r1}, ₹{r2}, ₹{r3}
  Fibonacci: 38.2%=₹{fib382}, 50%=₹{fib50}, 61.8%=₹{fib618}

  EARNINGS: {earningsDate} ({daysToEarnings} days away)
  MARKET CAP: ₹{marketCap} Cr | Beta: {beta}

  NEWS LAST 24H:
  {newsHeadlines}
  News sentiment: {newsSentiment}

  CAPITAL: ₹{capital} | Max risk per trade: 1% = ₹{maxRisk}

  Gates passed: {gatesPassed}/8

  Return ONLY valid JSON in this exact format:
  {
    'verdict': 'BUY' | 'WAIT' | 'SKIP',
    'confidence': 'HIGH' | 'MEDIUM' | 'LOW',
    'entryZone': { 'low': number, 'high': number },
    'stopLoss': number,
    'target1': number,
    'target2': number,
    'riskReward': number,
    'shares': number,
    'capitalDeployed': number,
    'maxLoss': number,
    'maxProfit': number,
    'signalValidDays': number,
    'waitCondition': string | null,
    'skipReason': string | null,
    'reasoning': string,
    'keyRisks': [string],
    'entryTrigger': string
  }"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 6 — MONGODB SCHEMAS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Signal Schema:
  symbol, verdict (enum: BUY/WAIT/SKIP), confidence (enum: HIGH/MEDIUM/LOW),
  entryZone {low, high}, stopLoss, target1, target2, riskReward, shares,
  capitalDeployed, maxLoss, maxProfit, signalValidTill, waitCondition,
  skipReason, reasoning, keyRisks[], entryTrigger, gatesPassed,
  gateDetails {gate1..gate8: {passed: bool, reason: string}},
  indicators {ema20, ema50, ema200, rsi, macd, macdSignal, volRatio, atr, bollingerB},
  marketContext {niftyPrice, vix, marketMode, bankNiftyTrend},
  newsSentiment (enum: POSITIVE/NEUTRAL/NEGATIVE),
  newsHeadlines[], isActive, notificationSent, timestamps

Trade Schema:
  symbol, signalId (ref: Signal), status (enum: OPEN/CLOSED/EXPIRED),
  entryPrice, entryDate, stopLoss, target1, target2, shares,
  capitalDeployed, currentPrice, unrealizedPnl, unrealizedPnlPct,
  target1Hit (bool), target1HitDate, exitPrice, exitDate,
  realizedPnl, realizedPnlPct, exitReason (enum: TARGET1/TARGET2/STOPLOSS/MANUAL/EARNINGS),
  slTrailed (bool), timestamps

Config Schema (single document):
  capital, riskPercentage (default: 1), maxOpenTrades (default: 3),
  maxCapitalDeployedPct (default: 60), watchlist [{symbol, sector, addedDate}],
  telegramChatId, emailRecipient, marketMode (enum: BULL/CAUTION/BEAR),
  paperTradeMode (bool, default: true), updatedAt

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 7 — API ENDPOINTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Build these REST endpoints:

GET    /api/signals              → latest signals for all watchlist stocks
GET    /api/signals/:symbol      → signal history for one stock
GET    /api/signals/active       → only active BUY signals

GET    /api/trades               → all trades (open + closed)
GET    /api/trades/open          → currently open positions
POST   /api/trades               → log a new trade entry manually
PATCH  /api/trades/:id           → update trade (hit target, close, etc.)

GET    /api/performance          → win rate, P&L, drawdown stats
GET    /api/performance/weekly   → this week's summary
GET    /api/performance/monthly  → this month's breakdown

GET    /api/watchlist            → current watchlist
POST   /api/watchlist            → add stock to watchlist
DELETE /api/watchlist/:symbol    → remove stock

GET    /api/news/:symbol         → latest news + sentiment for a stock
GET    /api/market               → current Nifty, VIX, market mode

POST   /api/chat                 → Ask Claude anything (chat widget)
  body: { message: string, context?: string }
  response: { reply: string }

GET    /api/config               → get current config
PATCH  /api/config               → update capital, risk %, settings

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 8 — WEBSOCKET EVENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Server emits these events to React:
  signal:new        → new BUY/WAIT/SKIP signal generated
  signal:update     → existing signal changed (WAIT → BUY)
  market:update     → Nifty, VIX, market mode updated
  trade:target1     → target 1 hit on open position
  trade:target2     → target 2 hit — exit now
  trade:sl_warning  → price within 2% of stop loss
  trade:earnings    → 5 days to earnings — exit reminder
  market:bearmode   → Nifty broke below 20 EMA
  scan:complete     → 15-min scan finished, summary stats

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 9 — ENVIRONMENT VARIABLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server/.env:
  NODE_ENV=development
  PORT=5000
  MONGODB_URI=mongodb+srv://...
  ANTHROPIC_API_KEY=sk-ant-...
  CLAUDE_MODEL=claude-sonnet-4-6
  TELEGRAM_BOT_TOKEN=...
  TELEGRAM_CHAT_ID=...
  EMAIL_HOST=smtp.gmail.com
  EMAIL_PORT=587
  EMAIL_USER=...
  EMAIL_PASS=...
  EMAIL_TO=...
  PYTHON_SERVICE_URL=http://localhost:8001
  CLIENT_URL=http://localhost:3000
  SCAN_INTERVAL_MINUTES=15
  DEFAULT_CAPITAL=1000000
  DEFAULT_RISK_PCT=1

python-service/.env:
  PORT=8001
  LOG_LEVEL=INFO

client/.env.local:
  VITE_API_URL=http://localhost:5000
  VITE_SOCKET_URL=http://localhost:5000

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 10 — NOTIFICATION TEMPLATES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Build a notifier.js with these functions:

sendBuyAlert(signal)          → BUY signal fired
sendWaitToBuyUpgrade(signal)  → WAIT upgraded to BUY
sendSlWarning(trade)          → price near stop loss
sendTarget1Hit(trade)         → T1 hit, trail SL
sendTarget2Hit(trade)         → T2 hit, full exit
sendBearModeAlert()           → market went bearish
sendVixSpikeAlert(vix)        → VIX crossed 20
sendMorningBrief(data)        → 8:30 AM daily
sendEveningSummary(data)      → 4:00 PM daily
sendWeeklyReport(data)        → Sunday 8 AM

Each function sends both Telegram AND email.
Telegram uses Markdown formatting.
Email uses HTML template.
Include deduplication: same signal not sent within 4 hours.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 11 — PYTHON MICROSERVICE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

POST /analyze endpoint accepts:
  { symbols: string[], capital: number, riskPct: number }

Returns for each symbol:
  {
    symbol, currentPrice, prevClose, dayChangePct,
    high52w, low52w,
    indicators: {
      ema20, ema50, ema200,
      rsi14, macd, macdSignal, macdHist,
      bbUpper, bbLower, bbPctB,
      atr14, volRatio, candlePattern
    },
    supportLevels: [{ price, strength, method }],
    resistanceLevels: [{ price, strength, method }],
    fibonacci: { fib236, fib382, fib50, fib618, fib786 },
    weeklyTrend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS',
    suggestedEntry: number,
    suggestedStopLoss: number,
    suggestedTarget1: number,
    suggestedTarget2: number,
    error: string | null
  }

GET /market returns:
  { nifty50: {...}, bankNifty: {...}, vix: number, adRatio: number }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 12 — REACT DASHBOARD PAGES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Dashboard.jsx:
  - MarketStatusBar at top (Nifty, VIX, A/D, capital left, market mode)
  - Grid of SignalCards — one per watchlist stock
  - BUY signals shown as highlighted TradeCards with full entry/exit details
  - Real-time via WebSocket — no refresh needed
  - Show "Last scanned: X minutes ago" indicator

Positions.jsx:
  - Table of all open trades
  - Progress bar for each: SL → Entry → T1 → T2
  - Live P&L (green/red) updating via socket
  - Action buttons: Mark T1 Hit, Mark Closed, Mark SL Hit

Performance.jsx:
  - Win rate gauge
  - Monthly P&L bar chart (recharts)
  - Trade history table with filters
  - Capital growth line chart
  - Key stats: total trades, avg R:R, max drawdown

Settings.jsx:
  - Update capital, risk %
  - Toggle paper trade mode (prominent warning when disabling)
  - Add/remove watchlist stocks
  - Telegram chat ID and email settings
  - Market mode override (manual override for emergencies)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 13 — DOCKER SETUP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

docker-compose.yml must run:
  - mongo service (for local dev, use MongoDB Atlas in prod)
  - server service (Node.js on port 5000)
  - python-service (FastAPI on port 8001)
  - client service (React on port 3000)

All services must:
  - Use .env files (not hardcoded values)
  - Have health checks
  - Restart on failure (restart: unless-stopped)
  - Have named volumes for MongoDB data persistence

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 14 — BUILD ORDER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Build in this exact sequence. After each step, confirm it works before next:

STEP 1 — Project scaffolding
  Create all folders and files (empty shells with correct structure)
  Set up package.json files, requirements.txt, docker-compose.yml
  Set up .env files with placeholder values
  Set up ESLint, Prettier, Black, isort configs

STEP 2 — Python microservice
  FastAPI app with /analyze and /market endpoints
  yfinance data fetcher with error handling
  All 8 indicators via pandas-ta
  Support/resistance via scipy
  Fibonacci calculation
  Pydantic schemas
  Test with: curl localhost:8001/analyze

STEP 3 — MongoDB models + Express server
  All 6 Mongoose models
  Express app with middleware (helmet, cors, rate-limit, error handler)
  DB connection with retry logic
  Winston logger setup
  Test: server starts and connects to MongoDB

STEP 4 — Core services (Node.js)
  pythonBridge.js — calls Python microservice
  gateChecker.js — all 8 gates with clear pass/fail logging
  claudeEngine.js — prompt builder + Claude API call + JSON parser
  newsFetcher.js — Google News RSS + Gate 8 sentiment
  Test: run single stock analysis end to end

STEP 5 — Scheduler + Scanner
  marketScanner.js — main 15-min cron
  morningBrief.js, eveningSummary.js, weeklyReport.js
  Market hours check (9:15 AM - 3:30 PM IST weekdays)
  Test: trigger scanner manually, check signal saved to MongoDB

STEP 6 — Notifications
  notifier.js — all 10 alert types
  Telegram bot setup
  Email via nodemailer
  Deduplication logic
  Test: trigger BUY signal, verify Telegram message received

STEP 7 — REST API routes
  All endpoints with Joi validation
  Consistent response format
  Rate limiting per endpoint
  Test all endpoints with curl or Postman

STEP 8 — WebSocket
  socket.io server setup
  All emit events wired to services
  Test: connect from browser console, verify events received

STEP 9 — React frontend
  App.jsx with router
  Tailwind CSS setup
  AppContext with socket connection
  Dashboard page with real-time updates
  All components with loading/error states
  Test: dashboard shows live data from backend

STEP 10 — Integration test
  Run all 3 services via docker-compose
  Add 3 stocks to watchlist
  Trigger a manual scan
  Verify: signal generated → MongoDB saved → Telegram received → dashboard updated

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 15 — IMPORTANT CONSTRAINTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. NEVER place trades automatically. The system only sends alerts.
   There must be NO auto-order execution code anywhere.

2. Paper trade mode must be ON by default.
   When switching to live mode, show a confirmation dialog:
   "You are switching to LIVE mode. Real money is at risk.
    Are you sure?" with a 5-second countdown before confirming.

3. Capital protection rules — enforce in code, not just UI:
   - Never risk more than 1% per trade (hard-coded minimum, configurable up)
   - Never open more than 3 simultaneous trades
   - If daily loss exceeds 3% of capital, pause all signals for the day
   - If Nifty is below 20 EMA, block ALL BUY signals (not just warn)

4. Claude API cost control:
   - Only call Claude API when 5 or more gates pass (saves cost)
   - Log token usage per call to MongoDB
   - Alert via Telegram if daily API cost exceeds ₹50

5. Data quality checks:
   - If yfinance returns empty/stale data, skip that stock and log error
   - If Python microservice is unreachable, pause scanner and send alert
   - Validate all Claude API responses — if JSON parse fails, retry once then SKIP

6. Logging requirements:
   Every scan cycle must log:
   - Stocks scanned, gates passed/failed per stock
   - Claude API calls made, tokens used, cost estimate
   - Signals generated (BUY/WAIT/SKIP counts)
   - Total scan duration in milliseconds

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

START NOW with STEP 1 — Project scaffolding.

Show me:
1. The complete folder structure created
2. All package.json files with exact dependencies
3. requirements.txt with pinned versions
4. docker-compose.yml
5. All .env files with placeholder values
6. ESLint + Prettier config for Node.js
7. Black + isort config for Python
8. A README.md explaining how to run the project

After I confirm STEP 1 looks correct, proceed to STEP 2.
Do not skip ahead. Build one step at a time.
```

---

## HOW TO USE THIS PROMPT

1. Open a **new Claude conversation** (claude.ai)
2. Copy everything between the triple backticks above
3. Paste it as your first message
4. Claude will start with Step 1 — project scaffolding
5. Review each step before saying "looks good, proceed to Step 2"

---

## FOLLOW-UP PROMPTS — USE THESE IN SEQUENCE

After the initial setup is complete, use these prompts one by one:

### After Step 1 — Scaffold complete:
```
Step 1 looks good. Now build Step 2 — the Python FastAPI microservice.
Write complete working code for all files in python-service/.
Include full error handling, type hints, docstrings, and logging.
Test each function as you build it.
```

### After Step 2 — Python service complete:
```
Python microservice is working. Now build Step 3 — MongoDB models
and Express server setup. Include all 6 Mongoose schemas with
indexes, enums, and timestamps. Set up Express with all middleware.
```

### After Step 3 — Server setup complete:
```
Server is running. Now build Step 4 — the four core Node.js services:
pythonBridge.js, gateChecker.js, claudeEngine.js, newsFetcher.js.
These are the most critical files. Take your time and make them bulletproof.
```

### After Step 4 — Core services complete:
```
Core services are ready. Build Step 5 — the scheduler and market scanner.
Wire everything together. After building, write a test script that
manually triggers one full scan cycle for TATAMOTORS.NS and ICICIBANK.NS
and logs the complete output.
```

### After Step 5 — Scanner working:
```
Scanner is working. Build Step 6 — notifier.js with all 10 alert types.
Set up Telegram bot and nodemailer. Include deduplication logic.
After building, write a test that sends a mock BUY alert for ICICIBANK
to both Telegram and email.
```

### After Step 6 — Notifications working:
```
Notifications are working. Build Steps 7 and 8 together —
all REST API routes and WebSocket setup.
After building, provide a complete Postman collection JSON
for testing all endpoints.
```

### After Steps 7+8 — API complete:
```
API and WebSocket are ready. Now build Step 9 — the complete
React frontend. Build all 5 pages and all components.
The dashboard must show live data via WebSocket.
Make it mobile-responsive with Tailwind CSS.
```

### Final integration test:
```
All components are built. Help me run the full integration test
from Step 10. Walk me through:
1. Starting all services with docker-compose
2. Adding TATAMOTORS, ICICIBANK, MOTILALOFS to the watchlist
3. Triggering a manual scan
4. Verifying the complete flow end to end
```

---

## QUICK REFERENCE — KEY FACTS TO GIVE CLAUDE

If Claude asks for clarification, use these answers:

- **Capital**: ₹10,00,000 (ten lakhs)
- **Risk per trade**: 1% = ₹10,000 maximum
- **Market**: NSE India (stocks use .NS suffix in yfinance)
- **Scan interval**: Every 15 minutes, 9:15 AM to 3:30 PM IST weekdays
- **Pre-market brief**: 8:30 AM IST daily
- **Evening summary**: 4:00 PM IST daily
- **Weekly report**: Sunday 8:00 AM IST
- **Claude model**: claude-sonnet-4-6
- **Max open trades**: 3 simultaneously
- **Paper trade**: ON by default — never disable without confirmation
- **Watchlist to start**: TATAMOTORS, ICICIBANK, MOTILALOFS, AXISBANK, SUNPHARMA

---

## WHAT THIS PROMPT WILL BUILD

When you follow all steps with Claude, you will get:

| Component | What you get |
|---|---|
| Python microservice | FastAPI app fetching NSE data + computing all indicators |
| Node.js backend | Express server + scheduler + Claude AI + notifications |
| MongoDB database | 6 collections storing all signals, trades, performance |
| React dashboard | Live real-time UI with charts, trade cards, P&L tracking |
| Telegram alerts | Instant messages for BUY signals, T1/T2 hits, SL warnings |
| Email alerts | HTML-formatted emails for all 10 alert types |
| Docker setup | One command to run entire system locally |
| 8-gate system | All safety filters built into the scanner |
| Claude AI engine | Intelligent BUY/WAIT/SKIP with full reasoning |
| News scanner | Gate 8 sentiment check on every signal |

**Estimated build time with Claude**: 8–12 hours across multiple sessions
**Lines of code**: approximately 3,000–4,000 across all files
**Monthly running cost**: ~₹12/day Claude API + ₹500 cloud (optional)
