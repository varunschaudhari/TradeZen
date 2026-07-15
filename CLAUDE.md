# SwingTrader AI — CLAUDE.md

Quantitative NSE swing trading signal platform. MERN stack + Python FastAPI + a deterministic verdict engine (Claude is advisory-only: Haiku news sentiment + chat widget).
**Never places trades. Never auto-executes orders. Sends alerts and tracks positions only.**

---

## Architecture at a glance

```
┌─────────────────────────────────────────────────────────────┐
│  React 18 + Vite (port 3001)                                │
│  Tailwind CSS 3 · React Router v6 · socket.io-client        │
│  Recharts (P&L) · lightweight-charts (candlesticks)         │
└──────────────────────┬──────────────────────────────────────┘
                       │ /api/* and /socket.io/* (Vite proxy → 5001)
┌──────────────────────▼──────────────────────────────────────┐
│  Node.js 20 / Express 5 (port 5001)  ← ES Modules           │
│  socket.io · mongoose · node-cron · @anthropic-ai/sdk        │
│  Winston logs · Joi validation · express-rate-limit          │
└──────────┬───────────────────────────┬──────────────────────┘
           │ mongoose                  │ axios (HTTP)
┌──────────▼──────────┐    ┌───────────▼─────────────────────┐
│  MongoDB Atlas       │    │  Python FastAPI (port 8001)      │
│  6 collections       │    │  yfinance · pandas · scipy       │
│  (see Models below)  │    │  OHLCV, indicators, S/R, Fibonacci│
└─────────────────────┘    └─────────────────────────────────┘
```

All secrets live in `server/.env` and `python-service/.env` — never hardcoded anywhere.

---

## The 8-Gate Safety System

This is the core of every decision. Gates run **sequentially** before the verdict is computed.

| Gate | Description | Type | Blocks if |
|------|-------------|------|-----------|
| G1 | Nifty 50 above 20-day EMA | **HARD BLOCK** | Nifty below EMA → entire market is in downtrend |
| G2 | Stock above weekly 50 EMA | **HARD BLOCK** | Weekly trend is BEARISH |
| G3 | No earnings within 15 days | **HARD BLOCK** | Earnings date ≤ 15 days away |
| G4 | RSI between 40–65 | strong filter | RSI outside sweet spot (overbought or no momentum) |
| G5 | Volume ≥ 1.5× 20-day average | strong filter | Weak participation — no institutional confirmation |
| G6 | Risk:Reward ≥ 2:1 | **HARD BLOCK** | Setup doesn't offer enough reward for the risk taken |
| G7 | Composite score confidence = HIGH | **HARD BLOCK** | Score below `SCORE_HIGH_CONFIDENCE` (60) — BUY requires the HIGH band |
| G8 | News sentiment not NEGATIVE | **HARD BLOCK** | Adverse news environment detected |

**Hard-block gates (1, 2, 3, 6, 8):** one failure cancels BUY regardless of total score.
**Strong-filter gates (4, 5):** failures reduce score but don't individually block.
**The verdict engine runs only when:** `hardBlockFired === false && gatesPassed >= 5` (out of
7 pre-verdict gates — the constant and the stored `shouldCallClaude`/`reachedClaude` field
names are kept from the Claude era for stored-data continuity).

Gate 7 is evaluated after the verdict engine runs — it is not part of `runAllGates()`.
See `server/src/services/gateChecker.js` and `server/src/services/verdictEngine.js`.

**History (2026-07-13):** Gate 7 was originally "Claude returns HIGH confidence" — a
Claude Sonnet call sat between the gates and every saved Signal. It was replaced by the
deterministic `verdictEngine.js` (same inputs → same verdict; BUY = score-confidence HIGH,
BEAR mode blocks BUY, T1_MIN_R geometry floor unchanged) because the LLM gate was the one
unvalidated filter in the system, non-reproducible in backtests, and it starved the go-live
evidence pipeline of BUY signals. Claude-judged signals created before this date remain in
the DB for before/after calibration comparison; `dataCollectionStartedAt` was reset at
cutover so the go-live gate judges only the new engine's record. Claude remains ONLY in:
Haiku headline sentiment (`newsFetcher.js`, feeds gate 8, has a keyword fallback) and the
Ask-Claude chat widget (`routes/chat.js`).

---

## Non-negotiable security constraints

These are not configuration options — they are hard-coded requirements that must never be removed:

1. **No auto-execution.** The system never places, modifies, or cancels orders. It produces signals and alerts only. There must be no broker API integration that can submit orders.

2. **`paperTradeMode: true` by default.** The `Config` Mongoose schema defaults `paperTradeMode` to `true`. Switching to live mode in the Settings UI shows a 5-second countdown confirmation dialog. The backend never enforces live mode differently — the flag is a UI warning layer only, since no trading actually happens.

3. **`paperTradeMode` is default true because** there is no broker integration — the flag exists so the user knows they are tracking hypothetical positions, not real ones. If broker integration is ever added, this flag becomes the critical safety gate.

4. **Daily loss pause.** If closed trades today total a loss ≥ 3% of capital, BUY signals are downgraded to WAIT for the rest of the day. Implemented in `marketScanner.js → isDailyLossPaused()`. Constant: `DAILY_LOSS_PAUSE_PCT = 3`.

5. **Max 15 simultaneous positions.** `MAX_OPEN_TRADES = 15` (`constants.js`). Raised from the original 3-position design once risk-per-trade dropped to 0.4% — 15 concurrent positions ≈ 6% total portfolio risk if every one stops out simultaneously. The scanner enforces this before saving any BUY signal.

6. **Max 95% capital deployed, regime-tiered down from there.** `MAX_CAPITAL_DEPLOYED_PCT = 95` is the absolute ceiling; the effective cap is `min(95%, DEPLOYMENT_CAP_BY_MODE[marketMode])` — 80% in BULL, 65% in MIXED, 50% in CAUTION, 20% in BEAR — so capacity shrinks as the regime degrades, not just position size. Checked against sum of all open `capitalDeployed` fields before any new BUY.

7. **Never risk more than 0.4% per trade by default.** `DEFAULT_RISK_PCT = 0.4`. The `riskPercentage` field in `Config` is configurable (min 0.1, max 5). Position sizing: `shares = floor((capital × riskPct%) / (entry − stopLoss))`.

7a. **Sector concentration caps.** `MAX_POSITIONS_PER_SECTOR = 3` and `MAX_SECTOR_DEPLOYED_PCT = 25` (of capital) — checked when a BUY is saved and re-checked at auto-open. Added after the book once sat 59% in financials with the position-count cap alone.

8. **BUY verdict requires HIGH score confidence.** `decideVerdict()` in `verdictEngine.js` only returns BUY when the composite score reaches the HIGH band (`SCORE_HIGH_CONFIDENCE = 60`); MEDIUM → WAIT, LOW → SKIP, and BEAR market mode blocks BUY outright. The T1_MIN_R / RISK_REWARD_MIN target-geometry floor downgrades any BUY whose levels are too tight. Deterministic — enforced in code.

9. **All secrets in `.env` files.** `.env` files are in `.gitignore`. Never hardcode API keys, bot tokens, or passwords.

---

## Claude usage (post-2026-07-13: advisory only, never a gate)

The verdict pipeline makes **zero** Claude calls — `verdictEngine.js` is pure and free.
Claude remains in exactly two places, neither of which gates a verdict:

- **Headline sentiment** (`newsFetcher.js`): Haiku (`CLAUDE_SENTIMENT_MODEL`, default
  `claude-haiku-4-5`) scores headlines for gate 8; falls back to keyword scoring
  automatically on any API failure. Cached 6h per symbol.
- **Ask-Claude chat** (`routes/chat.js`): the floating chat widget, 10 req/min
  rate-limited (`claudeRateLimiter`).

`Signal.claudeCostInr` / `claudeTokensUsed` are 0 on all new signals (fields kept for
historical continuity — pre-cutover signals carry real costs).
Deduplication: BUY signals for the same symbol within 4 hours are not re-sent (`DEDUPLICATION_HOURS = 4`).

---

## Go-live evidence gate

`server/src/services/goLiveGate.js` decides, per lane (swing / intraday), whether the paper
track record is statistically consistent with a real edge — a hard PASS/FAIL, not a vibe:
≥30 settled results, ≥42-day span, positive net expectancy, profit factor ≥1.3, drawdown
≤10% of capital (intraday also requires avg alert latency ≤90s). Exposed at
`GET /api/intraday/golive` (despite the route, it evaluates both lanes).

`Config.dataCollectionStartedAt` is the evidence-window cutoff — trades/signals created
before it are excluded from the gate's stats entirely. Set this whenever a clean observation
period begins (e.g. after a data-recovery event, or after a prototype strategy is replaced),
so recovered/legacy records are never mistaken for the current system's own decisions.

---

## IST time handling

**The system treats all market times as IST (UTC+5:30). The server runs in UTC.**

```javascript
// The only correct way to get current IST time in this codebase:
function getNowIST() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}
// Then call .getUTCHours() / .getUTCDay() on the result — NOT .getHours()
```

Market hours check: 9:15–15:30 IST, Monday–Friday. Outside these hours the scanner skips automatically unless `forceRun: true` is passed.

BUY signal expiry: set to 15:30 IST (10:00 UTC) the same day.
WAIT signal expiry: 3 days from creation.

---

## Service ports and health endpoints

| Service | Port | Health endpoint |
|---------|------|-----------------|
| React (Vite dev) | 3001 | `http://localhost:3001` |
| React (Nginx prod) | 3001→80 | `http://localhost:80` |
| Node/Express | 5001 | `GET /health` → `{ success: true }` |
| Python FastAPI | 8001 | `GET /health` → `{ status: "healthy" }` |
| MongoDB | 27017 | — |

The Vite dev server proxies `/api/*` and `/socket.io/*` → `http://localhost:5001`.
The Nginx production config (`client/nginx.conf`) does the same for the built dist.

---

## Directory structure

```
swing-trader/
├── client/                     React 18 + Vite + Tailwind
│   ├── src/
│   │   ├── components/         Reusable UI components
│   │   │   ├── Layout.jsx      Sidebar + mobile hamburger nav
│   │   │   ├── SignalCard.jsx  BUY/WAIT/SKIP card with gate toggle
│   │   │   ├── TradeCard.jsx   Open position card
│   │   │   ├── LogTradeModal.jsx  Manual trade entry (no auto-order)
│   │   │   ├── MarketStatusBar.jsx  Nifty/VIX/A:D live strip
│   │   │   ├── PerformanceChart.jsx  Monthly P&L + capital growth
│   │   │   ├── CandlestickChart.jsx  TradingView lightweight-charts
│   │   │   ├── ChatWidget.jsx  Ask Claude floating panel
│   │   │   └── NewsWidget.jsx  Sentiment + headlines
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx   Signal grid + chart on click
│   │   │   ├── Signals.jsx     Full history with verdict filters
│   │   │   ├── Positions.jsx   Open trades + close/T1 actions
│   │   │   ├── Performance.jsx  8 stat cards + monthly table
│   │   │   ├── Watchlist.jsx   Add/remove symbols
│   │   │   └── Settings.jsx    Capital/risk config + live mode countdown
│   │   ├── hooks/
│   │   │   ├── useSocket.js    Module-level singleton socket.io-client
│   │   │   ├── useSignals.js   Fetch + SIGNAL_NEW/UPDATE subscription
│   │   │   ├── useMarketStatus.js  Fetch + MARKET_UPDATE + setMarketMode
│   │   │   └── useCandleData.js    OHLCV with abort on symbol change
│   │   ├── context/
│   │   │   └── AppContext.jsx  marketMode, isConnected, lastScanTime, config
│   │   ├── services/
│   │   │   └── api.js          axios instance + all API namespaces
│   │   └── utils/
│   │       ├── constants.js    Frontend enums (mirrors backend)
│   │       └── formatters.js  formatCurrency, formatPercent, timeAgo
│   ├── nginx.conf              Production Nginx config (SPA + proxy)
│   └── Dockerfile              Multi-stage: node builder → nginx:alpine
│
├── server/                     Node.js 20 / Express 5 (ES Modules)
│   ├── src/
│   │   ├── app.js              Express entry: wires routes, socket, cron, DB
│   │   ├── config/
│   │   │   ├── constants.js    ALL magic numbers live here (no others)
│   │   │   ├── db.js           mongoose.connect with retry
│   │   │   └── logger.js       Winston JSON logger
│   │   ├── models/             Mongoose schemas
│   │   │   ├── Config.js       Singleton config doc (paperTradeMode, capital, watchlist)
│   │   │   ├── Signal.js       Scan results (verdict, gates, Claude output)
│   │   │   ├── Trade.js        Open/closed positions
│   │   │   ├── Performance.js  Historical metrics snapshot
│   │   │   ├── News.js         Cached news + sentiment
│   │   │   └── OHLCV.js        Candlestick data cache
│   │   ├── routes/             REST endpoints (all under /api/*)
│   │   │   ├── signals.js      GET, POST /scan, GET /active, GET /:symbol
│   │   │   ├── trades.js       CRUD + PATCH /target1 + PATCH /close
│   │   │   ├── watchlist.js    GET, POST, DELETE /:symbol
│   │   │   ├── performance.js  GET /, GET /history
│   │   │   ├── news.js         GET /:symbol (validates /^[A-Z]{1,20}$/)
│   │   │   ├── chat.js         POST / (Claude chat, 10/min rate limit)
│   │   │   ├── prices.js       POST /update (SL warning check)
│   │   │   ├── config.js       GET /, PATCH /
│   │   │   ├── ohlcv.js        GET /:symbol?period=&interval=
│   │   │   └── market.js       GET / (Python proxy + Config.marketMode merge)
│   │   ├── services/
│   │   │   ├── gateChecker.js  8-gate system (runAllGates, checkGate7)
│   │   │   ├── verdictEngine.js decideVerdict — deterministic verdict/levels/reasoning
│   │   │   ├── pythonBridge.js analyzeStocks, fetchMarketData, fetchOhlcv
│   │   │   ├── newsFetcher.js  fetchNewsAndSentiment → { sentiment, headlines, score }
│   │   │   └── notifier.js     Telegram + email alerts (10 alert types, dedup)
│   │   ├── scheduler/
│   │   │   ├── marketScanner.js  Main cron (every 15 min, market hours only)
│   │   │   ├── morningBrief.js   9:00 IST daily summary
│   │   │   ├── eveningSummary.js 15:45 IST EOD recap
│   │   │   └── weeklyReport.js   Friday 16:00 IST weekly stats
│   │   ├── socket/
│   │   │   └── socketHandlers.js SOCKET_EVENTS frozen object + emitEvent()
│   │   └── middleware/
│   │       ├── errorHandler.js  Global error handler
│   │       ├── rateLimiter.js   globalRateLimiter + claudeRateLimiter (10/min)
│   │       └── validateRequest.js  Joi wrapper → 400 on invalid body
│   ├── scripts/
│   │   └── seed.js             One-time DB seed (Config + starter watchlist)
│   ├── .env                    Real secrets (not committed)
│   ├── .env.example            Template with placeholders
│   └── Dockerfile              node:20-alpine
│
├── python-service/             FastAPI technical analysis microservice
│   ├── app/
│   │   ├── main.py             FastAPI app, /health, /analyze, /market, /ohlcv/:symbol
│   │   ├── models.py           Pydantic schemas for request/response
│   │   ├── indicators.py       Pure-pandas: EMA, RSI, MACD, ATR, Bollinger, vol ratio
│   │   ├── support_resistance.py  S/R levels from pivot clusters
│   │   └── fibonacci.py        Fibonacci retracements (60-bar swing high/low)
│   ├── requirements.txt        fastapi, uvicorn, yfinance, pandas, scipy, numpy
│   ├── .env                    PORT=8001, LOG_LEVEL=INFO
│   └── Dockerfile              python:3.11-slim
│
├── docker-compose.yml          4 services: mongo, python-service, server, client
├── test-integration.mjs        Step 10 automated integration test (32 checks)
├── SwingTrader-AI.postman_collection.json  47 requests, 12 folders
└── CLAUDE.md                   This file
```

---

## MongoDB models (6 collections)

**`Config`** — singleton document (always exactly one):
- `capital` (Number), `riskPercentage` (1–5%), `maxOpenTrades` (1–10), `maxCapitalDeployedPct` (10–90)
- `watchlist: [{ symbol, sector, addedDate }]`
- `paperTradeMode: Boolean` — **default `true`**
- `scannerEnabled: Boolean`, `marketMode: BULL|CAUTION|BEAR`, `marketModeOverride: Boolean`
- `telegramChatId`, `emailRecipient`

**`Signal`** — one document per scan result that passed Claude:
- `verdict: BUY|WAIT|SKIP`, `confidence: HIGH|MEDIUM|LOW`
- `entryZone: { low, high }`, `stopLoss`, `target1`, `target2`, `riskReward`
- `shares`, `capitalDeployed`, `maxLoss`, `maxProfit`
- `gatesPassed: Number` (max 8), `gateDetails: { gate1…gate8: { passed, reason } }`
- `indicators: { ema20, ema50, ema200, rsi, macd, macdSignal, volRatio, atr, bollingerB }`
- `marketContext: { niftyPrice, vix, marketMode, adRatio }`
- `newsSentiment`, `newsHeadlines`, `reasoning`, `keyRisks`, `entryTrigger`
- `claudeTokensUsed`, `claudeCostInr`

**`Trade`** — manually logged positions (never auto-created):
- `status: OPEN|CLOSED|EXPIRED`
- `entryPrice`, `stopLoss`, `target1`, `target2`, `shares`, `capitalDeployed`
- `currentPrice`, `unrealizedPnl`, `unrealizedPnlPct`
- `target1Hit: Boolean` (when T1 hit, SL trails to entry price)
- `exitPrice`, `exitReason: TARGET1|TARGET2|STOPLOSS|MANUAL|EARNINGS`, `realizedPnl`

**`Performance`** — daily snapshot (auto-updated on trade close):
- `winRate`, `avgRR`, `totalPnl`, `totalTrades`, `capital`

**`News`** — cached for 6 hours per symbol:
- `symbol`, `sentiment: POSITIVE|NEUTRAL|NEGATIVE`, `headlines: [String]`, `score: Number`

**`OHLCV`** — optional cache for candlestick data.

---

## WebSocket events (10 total)

All events defined in `SOCKET_EVENTS` frozen object (`server/src/socket/socketHandlers.js` and `client/src/utils/constants.js`).

| Event constant | Socket event name | Payload |
|----------------|-------------------|---------|
| `SIGNAL_NEW` | `signal:new` | Full Signal document |
| `SIGNAL_UPDATE` | `signal:update` | Updated Signal document |
| `MARKET_UPDATE` | `market:update` | `{ niftyPrice, niftyChange, niftyChangePct, bankNiftyPrice, vix, adRatio, marketMode }` |
| `TRADE_TARGET1` | `trade:target1` | Updated Trade document |
| `TRADE_TARGET2` | `trade:target2` | Updated Trade document |
| `TRADE_SL_WARNING` | `trade:sl_warning` | `{ tradeId, symbol, currentPrice, stopLoss, distancePct }` |
| `TRADE_EARNINGS` | `trade:earnings` | `{ symbol, daysToEarnings }` |
| `MARKET_BEARMODE` | `market:bearmode` | `{ marketMode, timestamp }` |
| `MARKET_VIXSPIKE` | `market:vixspike` | `{ vix, timestamp }` |
| `SCAN_COMPLETE` | `scan:complete` | `{ stocksScanned, signalsSaved, buySignals, claudeCalls, durationMs, marketMode, timestamp }` |

**Frontend socket singleton:** `client/src/hooks/useSocket.js` creates the socket once at module level and returns a `subscribe(event, handler)` function that returns an unsubscribe function. Never create a second socket.

---

## Key enums (must be consistent across frontend and backend)

```javascript
VERDICTS      = { BUY, WAIT, SKIP }
CONFIDENCE    = { HIGH, MEDIUM, LOW }
MARKET_MODES  = { BULL, CAUTION, BEAR }
SENTIMENTS    = { POSITIVE, NEUTRAL, NEGATIVE }
WEEKLY_TRENDS = { BULLISH, BEARISH, SIDEWAYS }
TRADE_STATUSES = { OPEN, CLOSED, EXPIRED }
EXIT_REASONS  = { TARGET1, TARGET2, STOPLOSS, MANUAL, EARNINGS }
```

All defined in `server/src/config/constants.js` (backend) and mirrored in `client/src/utils/constants.js` (frontend). If you add a value to one, add it to both.

---

## Gate thresholds (all in `server/src/config/constants.js`)

```javascript
RSI_MIN = 40, RSI_MAX = 70          // Gate 4 (RSI_MAX raised from 65 — see constants.js comment)
VOLUME_RATIO_MIN = 1.0              // Gate 5 (lowered from 1.5 — measured edge was inverted at 1.5×)
RISK_REWARD_MIN = 2.0               // Gate 6
EARNINGS_BUFFER_DAYS = 15           // Gate 3
GATES_REQUIRED_FOR_CLAUDE = 5       // minimum gates before the verdict engine runs (legacy name)
SL_WARNING_PCT = 2                  // % distance to SL that triggers warning event
DAILY_LOSS_PAUSE_PCT = 3            // daily loss % that pauses BUY signals
MAX_OPEN_TRADES = 15                // raised from 3 once risk-per-trade dropped to 0.4%
MAX_CAPITAL_DEPLOYED_PCT = 95       // absolute ceiling — see DEPLOYMENT_CAP_BY_MODE below
DEFAULT_RISK_PCT = 0.4              // lowered from 1% to keep aggregate risk in check at 15 positions
DEDUPLICATION_HOURS = 4             // min gap between BUY signals for same symbol
MAX_POSITIONS_PER_SECTOR = 3        // portfolio-level guard, checked at BUY-save and auto-open
MAX_SECTOR_DEPLOYED_PCT = 25        // % of capital, same sector — the book once sat 59% in financials
DEPLOYMENT_CAP_BY_MODE = { BULL: 80, MIXED: 65, CAUTION: 50, BEAR: 20 } // min() with MAX_CAPITAL_DEPLOYED_PCT
T1_MIN_R = 1.5                      // BUY downgraded to WAIT if target1 < 1.5× risk
ATR_TRAIL_MULT = 2.75               // post-T1 stop trails to hwm − this × ATR(14)
```

---

## Python service — data shapes

The Python `/market` endpoint returns a **flat object** (not nested):
```json
{ "niftyPrice": 24350, "niftyChange": 120, "niftyChangePct": 0.49,
  "bankNiftyPrice": 52100, "vix": 14.2, "adRatio": 0.67, "marketMode": "BULL" }
```

However, inside `gateChecker.js` and `marketScanner.js` the Python `/market` data is accessed as `marketData.nifty50` (a nested object with `{ price, ema20, aboveEma20, changePct }`). These are the raw Python service response fields — the `/api/market` Node route returns the flat shape after merging.

The Python `/analyze` endpoint returns:
```json
{ "results": [ StockAnalysis, ... ], "analyzedCount": N, "errorCount": N }
```

Each `StockAnalysis` has:
- `symbol`, `currentPrice`, `dayChangePct`, `weeklyTrend`, `earningsTimestamp`
- `suggestedEntry`, `suggestedStopLoss`, `suggestedTarget1`, `suggestedTarget2`
- `indicators: { ema20, ema50, ema200, rsi14, macd, macdSignal, macdHist, atr14, bbPctB, volRatio, candlePattern }`
- `supportLevels: [{ price, strength }]`, `resistanceLevels: [{ price, strength }]`
- `fibonacci: { fib236, fib382, fib50, fib618, fib786 }`
- `error: string | null`

The news API (`/api/news/:symbol`) returns:
```json
{ "sentiment": "NEUTRAL", "headlines": ["string", ...], "score": 0 }
```
Not an array — always a flat object. `headlines` is the array of strings.

---

## How to run locally

```powershell
# 1. MongoDB — local, no auth (skip if using Atlas)
docker run -d -p 27017:27017 --name st-mongo mongo:7.0

# 2. Python service
cd python-service
python -m uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload

# 3. Seed DB (only needed once)
cd server
node scripts/seed.js

# 4. Node server
cd server
node src/app.js

# 5. React dev server
cd client
npm run dev
```

Or with Docker Compose (local Mongo, no auth — no extra `.env` needed):
```powershell
docker-compose up -d --build
docker-compose exec server node scripts/seed.js
```

**Integration test:**
```powershell
cd swing-trader
node test-integration.mjs
```

---

## Environment variables

`server/.env` — required keys:

| Variable | Purpose |
|----------|---------|
| `MONGODB_URI` | Atlas connection string OR `mongodb://localhost:27017/swing-trader` for local docker mongo (no auth). Note: under docker-compose the server overrides this to `mongodb://mongo:27017/swing-trader` automatically. |
| `ANTHROPIC_API_KEY` | From console.anthropic.com — gates are checked first, Claude called only if 5+ pass |
| `CLAUDE_MODEL` | `claude-sonnet-4-6` (default; change only for testing) |
| `TELEGRAM_BOT_TOKEN` | Optional — omit to skip Telegram alerts |
| `TELEGRAM_CHAT_ID` | Optional |
| `EMAIL_USER` / `EMAIL_PASS` | Optional Gmail App Password — omit to skip email alerts |
| `EMAIL_TO` | Alert recipient |
| `PYTHON_SERVICE_URL` | `http://localhost:8001` for local; docker-compose overrides to `http://python-service:8001` |
| `SCAN_INTERVAL_MINUTES` | Default 15 |
| `PORT` | Default 5001 |

`python-service/.env` — only two variables: `PORT=8001`, `LOG_LEVEL=INFO`.

---

## Tailwind custom colors

```javascript
// tailwind.config.js
colors: {
  buy:  '#22c55e',
  wait: '#eab308',
  skip: '#ef4444',
  bull: '#22c55e',
  bear: '#ef4444',
  surface: {
    DEFAULT: '#0f172a',
    card: '#1e293b',
    elevated: '#334155',
  },
}
```

Use `text-buy`, `text-wait`, `text-skip`, `bg-surface`, `bg-surface-card`, `bg-surface-elevated` throughout.
CSS utility classes in `client/src/index.css`: `.card`, `.badge-buy`, `.badge-wait`, `.badge-skip`, `.btn-primary`, `.btn-danger`, `.input`, `select.input`.

---

## What does NOT exist (intentional gaps)

- **No authentication.** The API has no auth middleware. Adding JWT is the logical next step.
- ~~No automatic price refresh~~ — **stale, this exists.** JOB 12 (`position-monitor`, `scheduler/index.js`) calls `refreshOpenPositions()` every 2 minutes during market hours, entirely server-side — gated only on `isMarketOpen()`, independent of `Config.scannerEnabled` and of any browser tab being open.
- **No backtesting.** No `/api/backtest` route. Historical gate replay is the logical next step.
- **No broker API.** Zero integration with Zerodha, Upstox, or any broker. By design.
- **No auto-order execution.** See security constraints above. This is a permanent constraint.
