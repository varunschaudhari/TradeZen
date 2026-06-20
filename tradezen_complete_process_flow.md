# TradeZen — Complete Process Flow for Claude AI Implementation
# Version 2.0 — Full Simons-Inspired Strategy
# Paste this into Claude Code or a new Claude chat to implement

---

## HOW TO USE THIS DOCUMENT

This is a complete implementation guide. Paste the relevant section into Claude Code
in VS Code with your tradezen/ project open. Claude Code will implement each flow
exactly as specified.

Command to use in Claude Code:
```
Read this process flow carefully and implement it exactly as specified.
Follow all coding standards from the original setup prompt.
Build one flow at a time. Test before moving to the next.
```

---

## SECTION 1 — COMPLETE SYSTEM PROCESS FLOW

```
┌─────────────────────────────────────────────────────────────┐
│                    TRADEZEN MASTER FLOW                      │
│                  Runs every 15 minutes                       │
└─────────────────────────────────────────────────────────────┘

TRIGGER: node-cron → every 15 min (9:00 AM – 3:30 PM IST, weekdays)

STEP 1: Market health check
  └─→ Fetch Nifty 50, Bank Nifty, India VIX, A/D ratio
  └─→ Determine market mode: BULL / CAUTION / BEAR
  └─→ If BEAR → suspend all BUY signals → send bear mode alert → EXIT

STEP 2: Stock universe scan
  └─→ Load 350 stocks (Nifty50 + Next50 + Midcap150 + Smallcap100)
  └─→ Apply 6 pre-filters (liquidity, market cap, trend, momentum, ATR, earnings)
  └─→ 350 → ~45 candidates remain

STEP 3: 8-gate evaluation
  └─→ Run all 8 gates on each candidate
  └─→ Hard blocks: Gate 1, 2, 3, 6, 8 — instant SKIP if failed
  └─→ Strong filters: Gate 4, 5 — logged but not hard block
  └─→ 45 → ~15 stocks pass 5+ gates

STEP 4: Simons signal scoring
  └─→ Calculate composite score for each of the 15 stocks
  └─→ Apply all Simons signals (momentum, RS, volume anomaly, etc.)
  └─→ Rank by score — top 15 sent to Claude

STEP 5: Claude AI analysis
  └─→ Build structured prompt for each stock
  └─→ Call claude-sonnet-4-6 API
  └─→ Parse JSON response
  └─→ Save signal to MongoDB

STEP 6: Output signals
  └─→ HIGH confidence → Full trade card on dashboard + Telegram + Email
  └─→ MEDIUM → WAIT card on dashboard only
  └─→ LOW → SKIP logged silently

STEP 7: Open trade monitoring
  └─→ Check all open trades against current prices
  └─→ SL approach → urgent alert
  └─→ T1/T2 hit → action alert
  └─→ Earnings approaching → exit reminder
```

---

## SECTION 2 — FLOW 1: MARKET HEALTH CHECK

### File: server/src/services/marketHealthService.js

```javascript
/**
 * MARKET HEALTH SERVICE
 *
 * Purpose: Determine market mode before any scanning begins.
 * If market is BEAR — entire scan is suspended.
 *
 * Data sources:
 * - Nifty 50: ^NSEI via Python microservice
 * - Bank Nifty: ^NSEBANK via Python microservice
 * - India VIX: ^INDIAVIX via Python microservice
 * - A/D Ratio: calculated from advance/decline counts
 *
 * Called by: marketScanner.js at start of every scan cycle
 */

FUNCTION getMarketHealth():
  INPUT: none
  OUTPUT: {
    nifty50: { price, ema20, ema50, trend, dayChangePct },
    bankNifty: { price, ema20, trend },
    vix: number,
    adRatio: number,
    marketMode: 'BULL' | 'CAUTION' | 'BEAR',
    allowTrading: boolean,
    reason: string
  }

LOGIC:
  1. Call Python microservice GET /market
  2. Calculate market mode:

     BEAR conditions (ANY one = BEAR):
     - nifty50.price < nifty50.ema20
     - vix > 20
     - nifty50 down 3 consecutive days
     - adRatio < 0.7

     CAUTION conditions (ANY one = CAUTION, none of BEAR):
     - nifty50 within 1% below/above ema20
     - vix between 15 and 20
     - adRatio between 0.7 and 0.9

     BULL conditions (all must be true):
     - nifty50.price > nifty50.ema20
     - vix < 15
     - adRatio > 0.9

  3. Set allowTrading:
     - BULL → true
     - CAUTION → true (but reduce position sizes by 50%)
     - BEAR → false (no new BUY signals)

  4. If BEAR and was previously BULL → send bear mode alert via Telegram

  5. Save to Config collection in MongoDB (marketMode field)

  6. Return full market health object

ERROR HANDLING:
  - If Python microservice unreachable → use last known values from MongoDB
  - If last known values older than 30 min → set allowTrading = false
  - Log all errors via Winston
```

---

## SECTION 3 — FLOW 2: STOCK DISCOVERY ENGINE (8-STAGE FUNNEL)

### File: server/src/services/stockDiscovery.js

```
UNIVERSE: 350 NSE stocks
SOURCE: config/stockUniverse.js — hardcoded list with sector tags

STAGE 1 — LIQUIDITY FILTER
  Rule: avgVolume20d > 500000 AND price > 100
  Data: from Python microservice indicators response
  Eliminates: penny stocks, illiquid stocks
  Expected output: 350 → ~280

STAGE 2 — MARKET CAP FILTER
  Rule: marketCap > 2000 (Crore)
  Data: from Python microservice (calculated as price × sharesOutstanding)
  Eliminates: microcaps susceptible to manipulation
  Expected output: 280 → ~220

STAGE 3 — LONG-TERM TREND FILTER
  Rule: price > ema200
  Data: Python indicators
  Eliminates: stocks in structural downtrend
  Expected output: 220 → ~140

STAGE 4 — MOMENTUM + RELATIVE STRENGTH FILTER (Simons)
  Rule:
    momentum6m = (currentPrice - price180daysAgo) / price180daysAgo * 100
    momentum6m > 5 (stock up at least 5% in 6 months)
    AND
    relativeStrength = stock20dReturn / nifty20dReturn
    relativeStrength > 0.9 (stock not significantly underperforming Nifty)
  Data: Python indicators + Nifty comparison
  Eliminates: laggards, underperformers
  Expected output: 140 → ~85

STAGE 5 — VOLATILITY SWEET SPOT FILTER
  Rule: atrPercent >= 1.5 AND atrPercent <= 6.0
    where atrPercent = (atr14 / currentPrice) * 100
  Too low (<1.5%) = won't move enough for swing profit
  Too high (>6%) = stop losses get randomly hit
  Expected output: 85 → ~60

STAGE 6 — EARNINGS SAFETY FILTER
  Rule: daysToEarnings > 15 OR daysToEarnings === null
  Data: earningsCalendar collection in MongoDB (updated daily at 8 AM)
  Eliminates: earnings gap risk
  Expected output: 60 → ~45

STAGE 7 — 8-GATE PRELIMINARY CHECK
  Rule: at least 5 of 8 gates must pass
  Run full gateChecker.js on each stock
  Only pass stocks where gatesPassed >= 5
  Expected output: 45 → ~15

STAGE 8 — CLAUDE AI DEEP ANALYSIS
  Pass remaining 15 stocks to claudeEngine.js
  Claude evaluates each with full context
  Returns HIGH/MEDIUM/LOW confidence
  Expected output: 15 → 2-5 HIGH confidence signals

IMPLEMENTATION NOTES:
  - Run stages sequentially — stop processing a stock the moment it fails
  - Log how many stocks eliminated at each stage (for debugging)
  - Cache stage 1-3 results for 4 hours (they don't change fast)
  - Always re-run stages 4-8 fresh every scan
  - Maximum 15 Claude API calls per scan cycle (cost control)
```

---

## SECTION 4 — FLOW 3: 8-GATE EVALUATION ENGINE

### File: server/src/services/gateChecker.js

```
FUNCTION evaluateAllGates(stockData, marketData, newsData):
  INPUT:
    stockData: { symbol, price, ema20, ema50, ema200, rsi, macd, macdSignal,
                 volRatio, atr, bollingerB, candlePattern, weeklyEma50,
                 weeklyPrice, daysToEarnings, marketCap, momentum6m, rs }
    marketData: { nifty50, bankNifty, vix, adRatio, marketMode }
    newsData: { headlines[], sentiment, sentimentScore }
  OUTPUT:
    { gatesPassed: number, gateDetails: object, overallPass: boolean }

─────────────────────────────────────────────────────────────
GATE 1 — NIFTY 50 ABOVE 20 EMA
  Type: HARD BLOCK
  Check: marketData.nifty50.price > marketData.nifty50.ema20
  Pass action: proceed to Gate 2
  Fail action: SKIP entire stock. Log: "Gate 1 failed — bear market"
  Exception: none — this gate has zero exceptions
─────────────────────────────────────────────────────────────
GATE 2 — WEEKLY TREND BULLISH
  Type: HARD BLOCK
  Check: stockData.weeklyPrice > stockData.weeklyEma50
  Also check: stockData.rs > 0.8 (relative strength vs Nifty)
  Pass action: proceed to Gate 3
  Fail action: SKIP. Log: "Gate 2 failed — weekly downtrend"
─────────────────────────────────────────────────────────────
GATE 3 — NO EARNINGS WITHIN 15 DAYS
  Type: HARD BLOCK
  Check: stockData.daysToEarnings > 15 OR stockData.daysToEarnings === null
  Pass action: proceed to Gate 4
  Fail action: SKIP. Log: "Gate 3 failed — earnings in X days"
  Warning: if daysToEarnings between 15-20 → add warning to Claude prompt
─────────────────────────────────────────────────────────────
GATE 4 — RSI IN SWEET SPOT
  Type: STRONG FILTER
  Check: stockData.rsi >= 40 AND stockData.rsi <= 65
  Pass action: proceed to Gate 5
  Fail action:
    - RSI < 40: tag as "OVERSOLD" — could be mean reversion setup
      → Don't block. Flag differently. Reduce confidence.
    - RSI > 65: tag as "OVERBOUGHT" → SKIP
  Note: Mean reversion special case:
    If rsi < 38 AND bollingerB < 0.15 AND price > ema200
    → Flag as "MEAN_REVERSION" setup → still pass gate
─────────────────────────────────────────────────────────────
GATE 5 — VOLUME CONFIRMATION
  Type: STRONG FILTER
  Check: stockData.volRatio >= 1.5
  Advanced check (Simons volume anomaly):
    cumulative3dVolume = vol_day1 + vol_day2 + vol_day3
    avgCumulative = volAvg20d * 3
    volumeAnomaly = cumulative3dVolume > avgCumulative * 2.5
  Pass action: proceed to Gate 6
  Fail action:
    - volRatio < 1.5 AND no anomaly: tag as WAIT (volume not confirmed)
    - volRatio >= 1.5: pass
    - volumeAnomaly = true: add +10 to composite score (Simons signal)
─────────────────────────────────────────────────────────────
GATE 6 — RISK:REWARD MINIMUM 2:1
  Type: HARD BLOCK
  Inputs needed:
    entry = suggestedEntry from Python (midpoint of entry zone)
    stopLoss = suggestedStopLoss from Python
    target1 = suggestedTarget1 from Python
    target2 = suggestedTarget2 from Python
  Check:
    riskPerShare = entry - stopLoss
    rewardT1 = target1 - entry
    rewardT2 = target2 - entry
    rrT1 = rewardT1 / riskPerShare
    rrT2 = rewardT2 / riskPerShare
    PASS if rrT2 >= 2.0
  Fail action: SKIP. Log: "Gate 6 failed — R:R only X:1"
  Position sizing:
    maxRisk = capital * (riskPercent / 100)
    shares = Math.floor(maxRisk / riskPerShare)
    capitalDeployed = shares * entry
─────────────────────────────────────────────────────────────
GATE 7 — CLAUDE CONFIDENCE (evaluated AFTER Claude API call)
  Type: INTELLIGENCE LAYER
  Check: claudeResponse.confidence === 'HIGH'
  Pass: generate full trade card
  MEDIUM: generate WAIT card only
  LOW: log as SKIP with reason
─────────────────────────────────────────────────────────────
GATE 8 — NEWS SENTIMENT
  Type: HARD BLOCK
  Data: newsData from newsFetcher.js
  Check: newsData.sentiment !== 'NEGATIVE'
  Sentiment scoring:
    For each headline → Claude rates -10 to +10
    Sum = sentimentScore
    > +5 = POSITIVE
    -1 to +5 = NEUTRAL
    < -1 = NEGATIVE

  Automatic NEGATIVE triggers (instant SKIP regardless of score):
    - Contains: "SEBI notice", "SEBI probe", "investigation"
    - Contains: "promoter selling", "promoter pledging increased"
    - Contains: "analyst downgrade", "target cut", "sell rating"
    - Contains: "results miss", "below estimates", "profit decline"
    - Contains: "contract cancelled", "order cancelled"
    - Contains: "fraud", "scam", "corporate governance"

  Pass action: proceed to Claude analysis
  Fail action: SKIP. Log: "Gate 8 failed — negative news: [headline]"
─────────────────────────────────────────────────────────────

COMPOSITE SCORE CALCULATION (Simons-style):
  Base score if 8 gates passed: 40 points

  Add points:
  +10 → Volume anomaly (3x+ cumulative)
  +8  → Relative strength vs Nifty > 1.2
  +8  → FII net buyer 3+ consecutive days
  +7  → Promoter holding increased last quarter
  +7  → PEAD setup (earnings beat >15%, within 10 days)
  +6  → Stock in top 2 performing sectors this week
  +5  → Sentiment score > +5 (strong positive news)
  +5  → Put/Call ratio > 1.3 (market fear = contrarian buy)
  +4  → Within 5% of 52-week high (momentum)
  +3  → Bullish candlestick pattern (hammer/engulfing/morning star)
  +2  → MACD histogram rising for 3+ days

  Subtract points:
  -10 → FII net seller 3+ consecutive days
  -8  → Promoter holding decreased last quarter
  -6  → Stock in bottom 3 performing sectors
  -5  → Nifty down 2+ consecutive days
  -3  → Bollinger %B > 0.85 (overbought within band)

  Score interpretation:
  70+  → HIGH confidence → full trade card
  50-69 → MEDIUM → WAIT card
  <50  → LOW → SKIP
```

---

## SECTION 5 — FLOW 4: CLAUDE AI PROMPT BUILDER

### File: server/src/services/claudeEngine.js

```
FUNCTION buildClaudePrompt(stockData, marketData, newsData, gateResults, compositeScore, capital):

PROMPT TEMPLATE (build this string dynamically):

"""
You are TradeZen — an expert NSE swing trading analyst inspired by Jim Simons
quantitative approach. Analyze this setup using ONLY the data provided.
Return ONLY valid JSON. No explanation outside the JSON.

═══════════════════════════════════════════════════════
MARKET CONTEXT
═══════════════════════════════════════════════════════
Market Mode: {marketMode} ({marketModeReason})
Nifty 50: ₹{niftyPrice} | 20 EMA: ₹{niftyEma20} | Change: {niftyChangePct}%
Bank Nifty: ₹{bankNiftyPrice} | Trend: {bankNiftyTrend}
India VIX: {vix} ({vixInterpretation})
Advance/Decline Ratio: {adRatio}
FII Flow (last 3 days): {fiiFlow} ({fiiTrend})
Put/Call Ratio: {pcRatio}
Top Performing Sectors: {topSectors}

═══════════════════════════════════════════════════════
STOCK DATA: {symbol}
═══════════════════════════════════════════════════════
Current Price: ₹{price} | Previous Close: ₹{prevClose} | Change: {dayChangePct}%
52W High: ₹{high52w} | 52W Low: ₹{low52w} | From High: {fromHighPct}%
Market Cap: ₹{marketCap} Cr | Beta: {beta}

TECHNICAL INDICATORS:
EMA 20:  ₹{ema20} | Price vs EMA20: {priceVsEma20}%
EMA 50:  ₹{ema50} | Price vs EMA50: {priceVsEma50}%
EMA 200: ₹{ema200} | Price vs EMA200: {priceVsEma200}%
RSI 14:  {rsi} ({rsiInterpretation})
MACD:    {macd} | Signal: {macdSignal} | Histogram: {macdHist} ({macdTrend})
Bollinger %B: {bollingerB} | Upper: ₹{bbUpper} | Lower: ₹{bbLower}
ATR 14:  ₹{atr} ({atrPct}% daily range)
Volume Ratio: {volRatio}x 20-day average
Volume Anomaly: {volumeAnomaly}
Today's Candle: {candlePattern}

MOMENTUM (Simons):
6-Month Momentum: {momentum6m}%
Relative Strength vs Nifty: {relativeStrength}
Weekly Trend: {weeklyTrend}
52W High Proximity: {proximity52wHigh}%

KEY LEVELS:
Support S1: ₹{s1} ({s1Method}) — {s1Strength}
Support S2: ₹{s2} ({s2Method}) — {s2Strength}
Support S3: ₹{s3} ({s3Method}) — {s3Strength}
Resistance R1: ₹{r1} ({r1Method})
Resistance R2: ₹{r2} ({r2Method})
Resistance R3: ₹{r3} ({r3Method})
Fibonacci 38.2%: ₹{fib382}
Fibonacci 50.0%: ₹{fib50}
Fibonacci 61.8%: ₹{fib618}
Unfilled Gaps: {gaps}

FUNDAMENTALS:
Earnings Date: {earningsDate} ({daysToEarnings} days away)
Promoter Holding Change: {promoterChange}
PEAD Signal: {peadSignal}
Sector Rank This Week: {sectorRank} of 12

═══════════════════════════════════════════════════════
8-GATE RESULTS
═══════════════════════════════════════════════════════
Gate 1 — Nifty trend:    {gate1Result} ({gate1Reason})
Gate 2 — Weekly trend:   {gate2Result} ({gate2Reason})
Gate 3 — Earnings safe:  {gate3Result} ({gate3Reason})
Gate 4 — RSI zone:       {gate4Result} ({gate4Reason})
Gate 5 — Volume:         {gate5Result} ({gate5Reason})
Gate 6 — R:R ratio:      {gate6Result} ({gate6Reason})
Gate 7 — [YOU decide]
Gate 8 — News:           {gate8Result} ({gate8Reason})
Gates Passed: {gatesPassed}/8

COMPOSITE SCORE: {compositeScore}/100
Score Breakdown: {scoreBreakdown}

═══════════════════════════════════════════════════════
NEWS SENTIMENT (Last 24 hours)
═══════════════════════════════════════════════════════
Headlines:
{newsHeadlines}
Sentiment: {newsSentiment} (Score: {sentimentScore}/10)

═══════════════════════════════════════════════════════
SUGGESTED LEVELS (from Python technical engine)
═══════════════════════════════════════════════════════
Entry Zone: ₹{suggestedEntryLow} – ₹{suggestedEntryHigh}
Stop Loss: ₹{suggestedStopLoss}
Target 1: ₹{suggestedTarget1}
Target 2: ₹{suggestedTarget2}
Risk per share: ₹{riskPerShare}
R:R at T1: {rrT1}:1
R:R at T2: {rrT2}:1

═══════════════════════════════════════════════════════
CAPITAL & POSITION SIZING
═══════════════════════════════════════════════════════
Total Capital: ₹{capital}
Max Risk (1%): ₹{maxRisk}
Calculated Shares: {shares}
Capital to Deploy: ₹{capitalDeployed} ({deployedPct}%)
Currently Open Trades: {openTrades}/3

═══════════════════════════════════════════════════════
SETUP TYPE DETECTED
═══════════════════════════════════════════════════════
{setupType}
{setupDescription}

═══════════════════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════════════════
Analyze ALL the above data holistically.
Consider market context, technical setup, momentum signals, and news together.
Return your verdict as ONLY valid JSON in this exact format:

{
  "verdict": "BUY" | "WAIT" | "SKIP",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "setupType": "MOMENTUM_BREAKOUT" | "PULLBACK_TO_SUPPORT" | "MEAN_REVERSION" | "PEAD" | "VOLUME_ANOMALY" | "SECTOR_ROTATION" | "OTHER",
  "entryZone": { "low": number, "high": number },
  "entryTrigger": "exact candle/condition that must occur before entering",
  "stopLoss": number,
  "stopLossReason": "why this specific level",
  "target1": number,
  "target1Reason": "why this level",
  "target2": number,
  "target2Reason": "why this level",
  "riskReward": number,
  "shares": number,
  "capitalDeployed": number,
  "maxLoss": number,
  "maxProfit": number,
  "signalValidDays": number,
  "exitBeforeDate": "YYYY-MM-DD or null",
  "waitCondition": "exactly what to wait for (if WAIT verdict)",
  "skipReason": "exactly why skipping (if SKIP verdict)",
  "keyRisks": ["risk1", "risk2", "risk3"],
  "tailwindFactors": ["factor1", "factor2"],
  "simonsSignals": ["which Simons signals are active"],
  "compositeScoreAssessment": "your assessment of the composite score",
  "reasoning": "3-4 sentence explanation covering: trend, momentum, risk, and why you chose this verdict"
}
"""

FUNCTION callClaudeAPI(prompt):
  Model: claude-sonnet-4-6
  Max tokens: 1000
  Temperature: 0 (deterministic — same data = same verdict)

  Request:
    messages: [{ role: "user", content: prompt }]

  Response handling:
    1. Extract text from response.content[0].text
    2. Strip any markdown backticks if present
    3. Parse JSON
    4. Validate all required fields exist
    5. If JSON parse fails → retry once with "Return ONLY JSON, no other text"
    6. If second attempt fails → return SKIP with reason "Claude response parse error"

  Error handling:
    - Rate limit error → wait 60 seconds → retry
    - API error → log → return SKIP with reason "Claude API error"
    - Timeout (30s) → log → return SKIP with reason "Claude timeout"

  Cost tracking:
    - Log inputTokens and outputTokens per call
    - Estimate cost: (inputTokens/1M * 3) + (outputTokens/1M * 15) USD
    - Save to MongoDB dailyCost collection
    - If daily cost > $2 → send Telegram alert "API cost warning"
```

---

## SECTION 6 — FLOW 5: SIMONS SIGNAL CALCULATORS

### File: server/src/services/simonsSignals.js

```
All Simons signals calculated here. Called before building Claude prompt.

─────────────────────────────────────────────────────────────
SIGNAL 1: MEAN REVERSION DETECTOR
─────────────────────────────────────────────────────────────
FUNCTION detectMeanReversion(indicators):
  Conditions:
    bollingerB < 0.15 (price near lower band)
    AND rsi < 38 (oversold)
    AND price > ema200 (long-term trend still up)
    AND atrPct > 2 (enough daily range to profit)
  Returns: { isMeanReversion: boolean, strength: 'STRONG'|'MODERATE'|'WEAK' }
  Score impact: +8 if STRONG, +4 if MODERATE

─────────────────────────────────────────────────────────────
SIGNAL 2: MOMENTUM SCORE (12-1 MOMENTUM like Simons)
─────────────────────────────────────────────────────────────
FUNCTION calculateMomentumScore(priceHistory):
  momentum6m = (currentPrice - price180dAgo) / price180dAgo * 100
  momentum3m = (currentPrice - price90dAgo) / price90dAgo * 100
  momentum1m = (currentPrice - price30dAgo) / price30dAgo * 100

  Score:
    momentum6m > 20% → +8
    momentum6m > 10% → +5
    momentum6m > 5%  → +3
    momentum6m < 0%  → -5

  Returns: { momentum6m, momentum3m, momentum1m, momentumScore }

─────────────────────────────────────────────────────────────
SIGNAL 3: RELATIVE STRENGTH VS NIFTY
─────────────────────────────────────────────────────────────
FUNCTION calculateRelativeStrength(stockReturns, niftyReturns):
  rs20d = stock20dReturn / nifty20dReturn
  rs60d = stock60dReturn / nifty60dReturn

  Interpretation:
    rs20d > 1.3 → "STRONG LEADER" → +8 score
    rs20d > 1.0 → "LEADER" → +4 score
    rs20d > 0.8 → "IN LINE" → 0 score
    rs20d < 0.8 → "LAGGARD" → -6 score (consider filtering out)

  Returns: { rs20d, rs60d, rsCategory, rsScore }

─────────────────────────────────────────────────────────────
SIGNAL 4: VOLUME ANOMALY DETECTION (Simons smart money)
─────────────────────────────────────────────────────────────
FUNCTION detectVolumeAnomaly(volumeHistory):
  avgVol20d = average of last 20 sessions volume
  cumVol3d = sum of last 3 sessions volume
  expectedCumVol = avgVol20d * 3

  anomalyRatio = cumVol3d / expectedCumVol

  Classification:
    > 2.5x → "HIGH ANOMALY" → +10 score → tag as institutional accumulation
    > 1.8x → "MODERATE ANOMALY" → +5 score
    > 1.3x → "ELEVATED" → +2 score
    ≤ 1.3x → "NORMAL" → 0 score

  Also check: Was today's candle bullish on high volume?
    If yes AND anomaly → add "INSTITUTIONAL ACCUMULATION" tag

  Returns: { anomalyRatio, classification, score, institutionalAccumulation }

─────────────────────────────────────────────────────────────
SIGNAL 5: 52-WEEK HIGH MOMENTUM
─────────────────────────────────────────────────────────────
FUNCTION check52WHighMomentum(price, high52w, rsi):
  proximity = ((high52w - price) / high52w) * 100

  Conditions for momentum breakout setup:
    proximity < 3% (within 3% of 52W high)
    AND rsi between 50 and 65 (not overbought)
    AND price > ema20 (short-term trend intact)

  Returns:
    { proximity52wHigh: proximity, is52WMomentum: boolean, score: +4 }

  Note: This is counterintuitive — most retail avoid 52W highs.
  Simons found this is exactly when institutions are most active.

─────────────────────────────────────────────────────────────
SIGNAL 6: PEAD DETECTOR (Post-Earnings Announcement Drift)
─────────────────────────────────────────────────────────────
FUNCTION detectPEAD(symbol, earningsHistory):
  Check if:
    1. Company reported results in last 10 trading days
    2. Actual EPS > estimated EPS by more than 15%
    3. Stock has pulled back from initial pop (RSI came down from >70)
    4. Currently on first pullback to 20 EMA after results

  If all conditions met:
    tag as "PEAD_SETUP"
    score += 7
    Add to Claude prompt: "PEAD SIGNAL ACTIVE — results beat {beatPct}% — drift likely continues"

  Data source: Tickertape.in scraper (run once after results season starts)

─────────────────────────────────────────────────────────────
SIGNAL 7: SECTOR ROTATION DETECTOR
─────────────────────────────────────────────────────────────
FUNCTION detectSectorMomentum():
  Runs every Monday at 8:30 AM
  Tracks 12 NSE sector indices (4-week return):
    ^NSEBANK, ^CNXIT, ^CRSLDX (Auto), ^CNXPHARMA
    ^CNXFMCG, ^CNXMETAL, ^CNXREALTY, ^CNXENERGY
    ^CNXINFRA, ^CNXPSUBANK, ^CNXMEDIA, ^CNXCONSUM

  Rank sectors by 4-week return
  topSectors = top 3 ranked sectors
  bottomSectors = bottom 3 ranked sectors

  For each stock:
    if stock.sector in topSectors → score += 6 → "SECTOR TAILWIND"
    if stock.sector in bottomSectors → score -= 6 → "SECTOR HEADWIND"

  Returns: { sectorRanking, topSectors, bottomSectors }

─────────────────────────────────────────────────────────────
SIGNAL 8: FII FLOW MOMENTUM
─────────────────────────────────────────────────────────────
FUNCTION fetchFIIData():
  Runs daily at 6:00 PM (after NSE publishes data)
  Source: NSE India FII/FPI activity page (scrape or API)

  Track:
    fiiNetBuy3d = sum of FII net buy/sell last 3 days
    fiiTrend = "BUYING" | "SELLING" | "NEUTRAL"

  Rules:
    FII net buyer 3+ consecutive days → fiiTrend = "BUYING" → score += 8
    FII net seller 3+ consecutive days → fiiTrend = "SELLING" → score -= 10
    Mixed → fiiTrend = "NEUTRAL" → score unchanged

  Also track by sector (if available):
    Which sectors are FIIs buying into?
    Cross-reference with sector rotation signal

─────────────────────────────────────────────────────────────
SIGNAL 9: PUT/CALL RATIO (Market sentiment)
─────────────────────────────────────────────────────────────
FUNCTION fetchPutCallRatio():
  Source: NSE options data (free)
  Fetch daily Nifty options P/C ratio

  Rules:
    pcRatio > 1.3 → extreme fear → contrarian bullish → score += 5
    pcRatio 1.0-1.3 → elevated fear → mildly bullish → score += 2
    pcRatio 0.8-1.0 → neutral → no adjustment
    pcRatio < 0.8 → extreme greed → caution → score -= 3

─────────────────────────────────────────────────────────────
SIGNAL 10: GAP ANALYSIS
─────────────────────────────────────────────────────────────
FUNCTION findUnfilledGaps(priceHistory):
  Scan last 90 days of OHLCV
  Identify gaps: when today's low > yesterday's high (up gap)
                 or today's high < yesterday's low (down gap)

  For each unfilled gap:
    gapSize = |gap high - gap low| / gap midpoint * 100
    Only track gaps where gapSize > 1% (significant)

  Find gaps within 15% of current price:
    Up gaps above price → RESISTANCE zones → use as targets
    Down gaps below price → SUPPORT zones → use as stop loss levels

  Returns: { upGaps: [], downGaps: [], nearestGap: {} }
  Note: Add to Claude prompt as additional S/R context
```

---

## SECTION 7 — FLOW 6: NEWS FETCHER (GATE 8)

### File: server/src/services/newsFetcher.js

```
FUNCTION fetchNewsForStock(symbol, companyName):
  INPUT: symbol (e.g. "ICICIBANK"), companyName (e.g. "ICICI Bank")
  OUTPUT: { headlines: [], sentiment: string, sentimentScore: number }

DATA SOURCES (fetch from all 3, deduplicate):

  SOURCE 1: Google News RSS
    URL: https://news.google.com/rss/search?q={companyName}+NSE+stock&hl=en-IN&gl=IN&ceid=IN:en
    Parse with: rss-parser npm package
    Take: last 10 articles published in last 48 hours
    Extract: title, publishedAt, source

  SOURCE 2: NSE Corporate Announcements
    URL: https://www.nseindia.com/companies-listing/corporate-filings-announcements
    Filter by: symbol
    Take: last 5 announcements
    Extract: subject, date
    Flag immediately if subject contains:
      "Board Meeting", "Results", "Dividend", "Buyback", "Rights Issue"
      "SEBI", "Penalty", "Litigation"

  SOURCE 3: Moneycontrol RSS (if available)
    URL: https://www.moneycontrol.com/rss/latestnews.xml
    Filter: articles mentioning the company name
    Take: last 5 relevant articles

SENTIMENT ANALYSIS:
  Send all headlines to Claude with this mini-prompt:
  """
  Rate each headline for {symbol} stock on NSE from -10 (very negative) to +10 (very positive).
  Consider impact on stock price specifically.
  Return JSON: { scores: [number], total: number, sentiment: "POSITIVE"|"NEUTRAL"|"NEGATIVE" }
  Headlines:
  {headlinesList}
  """

AUTO-NEGATIVE DETECTION (check before calling Claude — instant block):
  negativeKeywords = [
    'SEBI notice', 'SEBI probe', 'SEBI investigation', 'SEBI penalty',
    'promoter selling', 'promoter pledged', 'promoter stake reduced',
    'analyst downgrade', 'target cut', 'sell rating', 'reduce rating',
    'results miss', 'below estimates', 'profit decline', 'revenue miss',
    'contract cancelled', 'order cancelled', 'client lost',
    'fraud', 'scam', 'corporate governance', 'accounting irregularities',
    'MD resigned', 'CEO resigned', 'CFO resigned',
    'NPA increased', 'bad loans', 'write-off'
  ]

  If ANY headline contains ANY negativeKeyword:
    Return { sentiment: 'NEGATIVE', autoNegative: true, reason: keyword }
    → Gate 8 fails immediately → SKIP signal

CACHING:
  Cache news for each symbol for 4 hours
  Don't re-fetch if cache is fresh (reduces API calls)
  Store in MongoDB news collection with TTL index

MARKET-WIDE NEWS:
  Also fetch: RBI announcements, budget updates, global market news
  If RBI meeting today or tomorrow:
    → Add "RBI_MEETING_RISK" flag to all signals
    → Reduce position sizes by 50% for banking stocks
```

---

## SECTION 8 — FLOW 7: SIGNAL STORAGE & DEDUPLICATION

### File: server/src/services/signalManager.js

```
FUNCTION saveSignal(claudeResponse, stockData, gateResults, marketData):

MONGODB SIGNAL DOCUMENT:
{
  symbol: string,
  verdict: 'BUY' | 'WAIT' | 'SKIP',
  confidence: 'HIGH' | 'MEDIUM' | 'LOW',
  setupType: string,
  compositeScore: number,

  entryZone: { low: number, high: number },
  entryTrigger: string,
  stopLoss: number,
  stopLossReason: string,
  target1: number,
  target1Reason: string,
  target2: number,
  target2Reason: string,
  riskReward: number,
  shares: number,
  capitalDeployed: number,
  maxLoss: number,
  maxProfit: number,

  signalValidTill: Date,
  exitBeforeDate: Date | null,

  waitCondition: string | null,
  skipReason: string | null,
  keyRisks: [string],
  tailwindFactors: [string],
  simonsSignals: [string],
  reasoning: string,

  gatesPassed: number,
  gateDetails: {
    gate1: { passed: boolean, reason: string },
    gate2: { passed: boolean, reason: string },
    gate3: { passed: boolean, reason: string },
    gate4: { passed: boolean, reason: string },
    gate5: { passed: boolean, reason: string },
    gate6: { passed: boolean, reason: string },
    gate7: { passed: boolean, reason: string },
    gate8: { passed: boolean, reason: string }
  },

  indicators: {
    price: number, ema20: number, ema50: number, ema200: number,
    rsi: number, macd: number, macdSignal: number, macdHist: number,
    volRatio: number, atr: number, bollingerB: number,
    candlePattern: string, momentum6m: number, relativeStrength: number
  },

  marketContext: {
    niftyPrice: number, niftyEma20: number, marketMode: string,
    vix: number, adRatio: number, fiiTrend: string, pcRatio: number
  },

  newsContext: {
    sentiment: string, sentimentScore: number, headlines: [string]
  },

  isActive: boolean,
  notificationSent: boolean,
  scanTimestamp: Date,
  createdAt: Date,
  updatedAt: Date
}

DEDUPLICATION LOGIC:
  Before saving, check:
    existingSignal = Signal.findOne({
      symbol: symbol,
      verdict: 'BUY',
      isActive: true,
      createdAt: { $gte: 4 hours ago }
    })

  If existingSignal exists AND verdict unchanged:
    Don't save duplicate
    Don't send notification again
    Just update scanTimestamp

  If existingSignal exists BUT verdict changed (WAIT → BUY):
    Save as new signal
    Mark old as inactive
    Send "UPGRADED to BUY" notification

  If no existing signal:
    Save new signal
    Send notification if BUY or WAIT

SIGNAL EXPIRY:
  signalValidTill = createdAt + (signalValidDays * 24 * 60 * 60 * 1000)
  Cron job runs daily at 9 AM:
    Signal.updateMany(
      { signalValidTill: { $lt: new Date() }, isActive: true },
      { isActive: false }
    )
```

---

## SECTION 9 — FLOW 8: NOTIFICATION ENGINE

### File: server/src/services/notifier.js

```
All notification functions below. Each sends BOTH Telegram AND Email.

─────────────────────────────────────────────────────────────
NOTIFICATION 1: BUY SIGNAL ALERT
─────────────────────────────────────────────────────────────
FUNCTION sendBuyAlert(signal):

TELEGRAM FORMAT:
"""
🟢 *BUY SIGNAL — {symbol}*
━━━━━━━━━━━━━━━━━━━━━━━
📊 *Setup:* {setupType}
🎯 *Confidence:* {confidence} | Score: {compositeScore}/100

💰 *TRADE PLAN*
📈 Entry zone: ₹{entryZone.low} – ₹{entryZone.high}
🛡 Stop loss: ₹{stopLoss}
🎯 Target 1: ₹{target1} (+{t1ProfitPct}%)
🏆 Target 2: ₹{target2} (+{t2ProfitPct}%)
⚖️ Risk:Reward = {riskReward}:1

📦 *POSITION SIZE (₹{capital})*
Shares: {shares}
Capital: ₹{capitalDeployed}
Max loss: ₹{maxLoss}
Max profit: ₹{maxProfit}

⚡ *ENTRY TRIGGER*
{entryTrigger}

🚦 *ACTIVE SIMONS SIGNALS*
{simonsSignals}

⏰ Valid till: {signalValidTill}
📅 Exit before: {exitBeforeDate}

⚠️ *KEY RISKS*
{keyRisks}

🤖 {reasoning}
━━━━━━━━━━━━━━━━━━━━━━━
📊 Dashboard: http://localhost:3000
"""

EMAIL FORMAT: HTML version of above with color coding
  - Green border for BUY
  - Red for stop loss
  - Green for targets
  - Professional table layout

─────────────────────────────────────────────────────────────
NOTIFICATION 2: WAIT → BUY UPGRADE
─────────────────────────────────────────────────────────────
FUNCTION sendUpgradeAlert(signal):
"""
⬆️ *UPGRADED: WAIT → BUY — {symbol}*
Trigger condition met: {entryTrigger}
{full trade details same as BUY alert}
"""

─────────────────────────────────────────────────────────────
NOTIFICATION 3: STOP LOSS WARNING
─────────────────────────────────────────────────────────────
FUNCTION sendSlWarning(trade):
  Trigger: price comes within 2% of stop loss
"""
🚨 *SL WARNING — {symbol}*
Current price: ₹{currentPrice}
Stop loss: ₹{stopLoss}
Distance: {slDistancePct}%
Unrealized P&L: ₹{unrealizedPnl} ({unrealizedPct}%)
Action: Watch closely — SL may be hit soon
"""

─────────────────────────────────────────────────────────────
NOTIFICATION 4: TARGET 1 HIT
─────────────────────────────────────────────────────────────
FUNCTION sendTarget1Hit(trade):
"""
🎯 *TARGET 1 HIT — {symbol}*
━━━━━━━━━━━━━━━━
✅ ACTION REQUIRED:
1. SELL {halfShares} shares at ₹{target1} NOW
2. Move SL from ₹{originalSL} to ₹{entryPrice}
3. Let remaining {halfShares} shares ride to ₹{target2}

Profit booked: ₹{t1Profit} (+{t1ProfitPct}%)
Remaining position: RISK FREE ✅
"""

─────────────────────────────────────────────────────────────
NOTIFICATION 5: TARGET 2 HIT
─────────────────────────────────────────────────────────────
FUNCTION sendTarget2Hit(trade):
"""
🏆 *TARGET 2 HIT — {symbol}* 🏆
━━━━━━━━━━━━━━━━
✅ EXIT ALL REMAINING SHARES NOW
Sell {remainingShares} shares at ₹{target2}

TRADE SUMMARY:
Entry: ₹{entryPrice} | Exit T1: ₹{target1} | Exit T2: ₹{target2}
Total profit: ₹{totalProfit} (+{totalProfitPct}%)
Duration: {tradeDuration} days
"""

─────────────────────────────────────────────────────────────
NOTIFICATION 6: BEAR MODE ALERT
─────────────────────────────────────────────────────────────
FUNCTION sendBearModeAlert(marketData):
"""
🔴 *BEAR MODE — ALL SIGNALS SUSPENDED*
Nifty broke below 20 EMA
VIX: {vix}
Action: No new BUY signals until Nifty recovers
Open positions: Tighten stop losses
"""

─────────────────────────────────────────────────────────────
NOTIFICATION 7: MORNING BRIEF (8:30 AM daily)
─────────────────────────────────────────────────────────────
FUNCTION sendMorningBrief():
"""
☀️ *TRADEZEN MORNING BRIEF*
{date} | {dayOfWeek}
━━━━━━━━━━━━━━━━
📊 *MARKET OVERVIEW*
Nifty 50: {niftyPrice} ({niftyChangePct}%)
SGX Nifty indication: {sgxNifty}
US markets last close: {usMarkets}
India VIX: {vix} — {vixComment}
FII yesterday: {fiiYesterday}
Market mode: {marketMode}

🔥 *TOP SECTORS TODAY*
1. {sector1} (+{sector1Ret}%)
2. {sector2} (+{sector2Ret}%)
3. {sector3} (+{sector3Ret}%)

📋 *WATCHLIST — STOCKS TO WATCH*
{watchlistSummary}

🎯 *OPEN POSITIONS*
{openPositionsSummary}

⚠️ *EVENTS TODAY*
{eventsToday}
━━━━━━━━━━━━━━━━
TradeZen scanning starts at 9:00 AM
"""

─────────────────────────────────────────────────────────────
NOTIFICATION 8: EVENING SUMMARY (4:00 PM daily)
─────────────────────────────────────────────────────────────
FUNCTION sendEveningSummary():
"""
🌙 *TRADEZEN EVENING SUMMARY*
{date}
━━━━━━━━━━━━━━━━
📊 *TODAY'S SCAN RESULTS*
Stocks scanned: {totalScanned}
BUY signals: {buyCount}
WAIT signals: {waitCount}
SKIP signals: {skipCount}
Claude API calls: {apiCalls} (cost: ₹{apiCost})

💼 *OPEN POSITIONS P&L*
{positionsSummary}

📋 *STOCKS TO WATCH TOMORROW*
{tomorrowWatchlist}

📅 *TOMORROW'S EVENTS*
{tomorrowEvents}
━━━━━━━━━━━━━━━━
Next scan: Tomorrow 9:00 AM
"""

─────────────────────────────────────────────────────────────
NOTIFICATION 9: WEEKLY REPORT (Sunday 8:00 AM)
─────────────────────────────────────────────────────────────
FUNCTION sendWeeklyReport():
EMAIL ONLY (too long for Telegram — send Telegram summary + link)
"""
HTML EMAIL with:
  - Win rate this week vs last week
  - Total signals generated
  - Trades taken vs signals (discipline ratio)
  - P&L this week
  - Best trade of the week
  - Worst trade of the week
  - API cost this week
  - Which Simons signals fired most
  - Market mode days (Bull/Caution/Bear)
  - Capital growth chart (recharts data)
  - Recommendations for next week
"""

─────────────────────────────────────────────────────────────
NOTIFICATION 10: EARNINGS EXIT REMINDER (5 days before)
─────────────────────────────────────────────────────────────
FUNCTION sendEarningsReminder(trade):
"""
📅 *EXIT REMINDER — {symbol}*
Earnings in 5 days: {earningsDate}
Current P&L: ₹{currentPnl} ({currentPnlPct}%)
Action: Exit before {exitBeforeDate} to avoid earnings gap risk
"""
```

---

## SECTION 10 — FLOW 9: TRADE TRACKING

### File: server/src/services/tradeTracker.js

```
TRADE LOGGING:

Method 1: Telegram command /trade SYMBOL PRICE SHARES
  Parse: /trade ICICIBANK 1300 22
  Action:
    1. Find matching active signal for symbol
    2. Create Trade document in MongoDB
    3. Send GTT reminder
    4. Start monitoring

Method 2: Dashboard button "I entered this trade"
  API: POST /api/trades
  Body: { symbol, entryPrice, shares, signalId }

TRADE DOCUMENT:
{
  symbol: string,
  signalId: ObjectId (ref: Signal),
  status: 'OPEN' | 'CLOSED' | 'EXPIRED',
  entryPrice: number,
  entryDate: Date,
  shares: number,
  capitalDeployed: number,
  stopLoss: number,
  target1: number,
  target2: number,
  target1Shares: number (shares/2),
  target2Shares: number (shares/2),
  currentPrice: number,
  unrealizedPnl: number,
  unrealizedPnlPct: number,
  target1Hit: boolean,
  target1HitDate: Date | null,
  target1ExitPrice: number | null,
  slTrailed: boolean,
  slTrailedTo: number | null,
  exitPrice: number | null,
  exitDate: Date | null,
  realizedPnl: number | null,
  realizedPnlPct: number | null,
  exitReason: 'TARGET1' | 'TARGET2' | 'STOPLOSS' | 'EARNINGS' | 'MANUAL' | null,
  notes: string,
  createdAt: Date,
  updatedAt: Date
}

MONITORING LOGIC (runs every 15 min for open trades):
  For each open trade:
    1. Fetch current price
    2. Calculate unrealizedPnl = (currentPrice - entryPrice) * shares
    3. Update currentPrice and unrealizedPnl in MongoDB
    4. Check SL: if currentPrice <= stopLoss
       → Send SL hit alert
       → Update status to CLOSED, exitReason to STOPLOSS
    5. Check SL warning: if currentPrice within 2% of stopLoss
       → Send SL warning (max once per hour)
    6. Check T1: if currentPrice >= target1 AND !target1Hit
       → Send T1 hit alert
       → Set target1Hit = true
       → Set slTrailed = true, slTrailedTo = entryPrice
    7. Check T2: if currentPrice >= target2 AND target1Hit
       → Send T2 hit alert
       → Update status to CLOSED, exitReason to TARGET2
    8. Check earnings: if daysToEarnings <= 5
       → Send earnings reminder (once)

TRADE CLOSING (Telegram command /close SYMBOL PRICE SHARES):
  Parse: /close ICICIBANK 1376 11
  Action:
    1. Find open trade for symbol
    2. If shares = half total → partial exit (T1)
       → Set target1Hit = true
       → Update slTrailedTo = entryPrice
       → Calculate partial P&L
    3. If shares = remaining → full exit (T2 or manual)
       → Set status = CLOSED
       → Calculate total P&L
       → Update win rate in performance collection
    4. Send confirmation with P&L summary
```

---

## SECTION 11 — FLOW 10: PERFORMANCE ENGINE

### File: server/src/services/performanceEngine.js

```
PERFORMANCE METRICS (calculated after every trade closes):

FUNCTION updatePerformance(closedTrade):
  Update performance document:
  {
    totalTrades: number,
    winningTrades: number,
    losingTrades: number,
    winRate: number (winningTrades/totalTrades * 100),
    avgWinAmount: number,
    avgLossAmount: number,
    avgRR: number (avgWin/avgLoss),
    expectancy: number (winRate * avgWin - lossRate * avgLoss),
    totalPnl: number,
    totalPnlPct: number,
    maxDrawdown: number,
    maxDrawdownPct: number,
    bestTrade: { symbol, pnl, date },
    worstTrade: { symbol, pnl, date },
    avgHoldDays: number,
    capitalCurrent: number,
    capitalGrowthPct: number,
    monthlyPnl: [{ month, pnl, trades, winRate }],
    signalAccuracy: {
      bySetupType: {},
      byConfidence: {},
      bySimonsSignal: {},
      bySector: {}
    },
    apiCostTotal: number,
    apiCostMTD: number,
    updatedAt: Date
  }

SIGNAL DECAY MONITORING (Simons principle):
  Monthly review:
    For each gate combination → calculate win rate
    If win rate drops below 48% for 2 consecutive months:
      → Send alert: "Gate X may be losing effectiveness"
      → Flag for review
    
    For each Simons signal → calculate win rate improvement
    If signal not improving win rate → flag for removal

PAPER TRADE TRACKING:
  Same as live trade tracking but:
    isPaperTrade: true
    No real P&L (simulated)
    Used to calculate pre-live win rate
    Dashboard shows paper vs live comparison after going live

GO-LIVE DECISION HELPER:
  After 3 weeks paper trading:
    If paperWinRate >= 50% AND expectancy > 0:
      → Send alert: "Paper trading win rate: {rate}%. System ready for live trading."
    Else:
      → Send alert: "Win rate below 50%. Review signals before going live."
```

---

## SECTION 12 — FLOW 11: SCHEDULER (COMPLETE SCHEDULE)

### File: server/src/scheduler/index.js

```
All cron jobs defined here using node-cron

─────────────────────────────────────────────────────────────
JOB 1: MAIN MARKET SCANNER
Schedule: Every 15 minutes, 9:00 AM – 3:30 PM, Monday-Friday
─────────────────────────────────────────────────────────────
cron: '*/15 9-15 * * 1-5' (with minute check for 3:30 PM cutoff)

Steps:
  1. Check if within market hours (9:15 AM – 3:30 PM IST)
  2. getMarketHealth() → if BEAR, skip everything
  3. runStockDiscovery() → 350 → 15 candidates
  4. calculateSimonsSignals() for each candidate
  5. evaluateAllGates() for each candidate
  6. callClaudeAPI() for candidates passing 5+ gates
  7. saveSignals() with deduplication
  8. sendNotifications() for new BUY signals
  9. monitorOpenTrades()
  10. Log scan summary (stocks scanned, signals generated, cost)

─────────────────────────────────────────────────────────────
JOB 2: MORNING BRIEF
Schedule: 8:30 AM, Monday-Friday
─────────────────────────────────────────────────────────────
cron: '30 8 * * 1-5'

Steps:
  1. Fetch SGX Nifty indication
  2. Fetch US markets last close (S&P 500, NASDAQ, Dow)
  3. Get latest India VIX
  4. Get FII/DII data from yesterday
  5. Run sector rotation update
  6. Generate watchlist summary
  7. Fetch open positions P&L
  8. Check today's events (RBI, budget, F&O expiry)
  9. sendMorningBrief()

─────────────────────────────────────────────────────────────
JOB 3: PRE-MARKET STOCK DISCOVERY
Schedule: 9:00 AM, Monday-Friday
─────────────────────────────────────────────────────────────
cron: '0 9 * * 1-5'

Run full stock discovery scan before market opens.
Present 2-5 candidates on dashboard by 9:15 AM.

─────────────────────────────────────────────────────────────
JOB 4: EARNINGS CALENDAR REFRESH
Schedule: 8:00 AM daily
─────────────────────────────────────────────────────────────
cron: '0 8 * * *'

Fetch upcoming earnings dates for all watchlist stocks.
Update earningsCalendar collection.
Flag stocks with earnings in next 15 days.

─────────────────────────────────────────────────────────────
JOB 5: FII/DII DATA FETCH
Schedule: 6:00 PM, Monday-Friday
─────────────────────────────────────────────────────────────
cron: '0 18 * * 1-5'

Fetch FII/DII data from NSE (published after market close).
Update fiiData collection.
Calculate fiiTrend (buying/selling/neutral).
Update composite scores for next morning scan.

─────────────────────────────────────────────────────────────
JOB 6: EVENING SUMMARY
Schedule: 4:00 PM, Monday-Friday
─────────────────────────────────────────────────────────────
cron: '0 16 * * 1-5'

Compile day's results and send evening summary.

─────────────────────────────────────────────────────────────
JOB 7: S/R LEVEL RECALCULATION
Schedule: 8:00 AM daily
─────────────────────────────────────────────────────────────
cron: '5 8 * * *'

Recalculate swing high/low S/R and Fibonacci levels.
Fresh calculation from last 90 days of data.
Store in MongoDB for use during scan.

─────────────────────────────────────────────────────────────
JOB 8: SECTOR ROTATION UPDATE
Schedule: Every Monday 8:30 AM
─────────────────────────────────────────────────────────────
cron: '30 8 * * 1'

Rank all 12 sector indices by 4-week performance.
Update sectorRanking in Config collection.
Used by sector rotation Simons signal all week.

─────────────────────────────────────────────────────────────
JOB 9: SIGNAL EXPIRY CLEANUP
Schedule: 9:00 AM daily
─────────────────────────────────────────────────────────────
cron: '0 9 * * *'

Mark expired signals as inactive.
Signal.updateMany({ signalValidTill: { $lt: now }, isActive: true }, { isActive: false })

─────────────────────────────────────────────────────────────
JOB 10: WEEKLY PERFORMANCE REPORT
Schedule: Sunday 8:00 AM
─────────────────────────────────────────────────────────────
cron: '0 8 * * 0'

Compile full week performance.
Send detailed email report.
Send Telegram summary.
Check for signal decay.
```

---

## SECTION 13 — IMPLEMENTATION COMMAND FOR CLAUDE CODE

Paste this into Claude Code in VS Code after opening your tradezen/ project:

```
I have a trading platform called TradeZen already scaffolded (all 10 steps complete).
Read the attached process flow document carefully.

Now implement the following in order:

PRIORITY 1 — Core engine (implement first):
1. server/src/services/marketHealthService.js — complete implementation
2. server/src/services/gateChecker.js — all 8 gates exactly as specified
3. server/src/services/simonsSignals.js — all 10 Simons signals
4. server/src/services/claudeEngine.js — prompt builder + API call + JSON parser
5. server/src/services/newsFetcher.js — 3 sources + sentiment scoring

PRIORITY 2 — Discovery and tracking:
6. server/src/services/stockDiscovery.js — all 8 stages
7. server/src/services/signalManager.js — save + deduplicate
8. server/src/services/tradeTracker.js — logging + monitoring
9. server/src/services/notifier.js — all 10 notification types
10. server/src/services/performanceEngine.js — metrics calculation

PRIORITY 3 — Scheduler:
11. server/src/scheduler/index.js — all 10 cron jobs

CODING RULES (non-negotiable):
- Every function must have JSDoc comment
- Every async function wrapped in try/catch
- All errors logged via Winston
- No magic numbers — use constants
- Test each service individually before wiring to scheduler
- Follow the exact data structures specified in this document

Build one service at a time. After each service is complete:
  1. Write a test function at the bottom
  2. Run it and confirm output matches expected
  3. Only then move to next service

Start with marketHealthService.js now.
```

---

## SECTION 14 — QUICK REFERENCE: ALL CONSTANTS

### File: server/src/config/constants.js

```javascript
// TradeZen — All system constants

// Capital & Risk
DEFAULT_CAPITAL = 1000000          // ₹10 lakh
MAX_RISK_PCT = 1                   // 1% per trade
MAX_OPEN_TRADES = 3
MAX_CAPITAL_DEPLOYED_PCT = 60      // 60% max

// Gate thresholds
RSI_MIN = 40
RSI_MAX = 65
RSI_MEAN_REVERSION = 38
VOLUME_RATIO_MIN = 1.5
VOLUME_ANOMALY_THRESHOLD = 2.5    // 3-day cumulative
EARNINGS_SAFE_DAYS = 15
MIN_RR_RATIO = 2.0
MIN_GATES_FOR_CLAUDE = 5

// Simons signal thresholds
MOMENTUM_6M_MIN = 5               // % minimum
RS_MIN = 0.9                      // vs Nifty
RS_LEADER = 1.2
PROXIMITY_52W_HIGH = 5            // % from 52W high
PEAD_BEAT_PCT = 15                // % earnings beat
VIX_SAFE = 15
VIX_CAUTION = 20
VIX_DANGER = 25
PC_RATIO_FEAR = 1.3
PC_RATIO_GREED = 0.8
FII_CONSECUTIVE_DAYS = 3

// ATR filter
ATR_PCT_MIN = 1.5
ATR_PCT_MAX = 6.0

// Market cap
MIN_MARKET_CAP_CR = 2000

// Score thresholds
SCORE_HIGH_CONFIDENCE = 70
SCORE_MEDIUM_CONFIDENCE = 50

// Deduplication
SIGNAL_DEDUP_HOURS = 4

// SL warning
SL_WARNING_PCT = 2                // Warn when within 2% of SL

// Scheduler
SCAN_INTERVAL_MIN = 15
MARKET_OPEN_HOUR = 9
MARKET_OPEN_MIN = 15
MARKET_CLOSE_HOUR = 15
MARKET_CLOSE_MIN = 30

// NSE stock universe
NIFTY50_SYMBOLS = [50 symbols...]
NIFTY_NEXT50_SYMBOLS = [50 symbols...]
NIFTY_MIDCAP150_SYMBOLS = [150 symbols...]
NIFTY_SMALLCAP100_SYMBOLS = [100 symbols...]

// Sector mapping
SECTOR_MAP = {
  ICICIBANK: 'Banking',
  TATAMOTORS: 'Auto',
  INFY: 'IT',
  SUNPHARMA: 'Pharma',
  // ... all 350 stocks mapped to sectors
}

// NSE sector indices
SECTOR_INDICES = {
  Banking: '^NSEBANK',
  IT: '^CNXIT',
  Auto: '^CRSLDX',
  Pharma: '^CNXPHARMA',
  FMCG: '^CNXFMCG',
  Metal: '^CNXMETAL',
  Realty: '^CNXREALTY',
  Energy: '^CNXENERGY',
  Infra: '^CNXINFRA',
  PSUBank: '^CNXPSUBANK',
  Media: '^CNXMEDIA',
  ConsumerDurables: '^CNXCONSUM'
}
```

---

*TradeZen Process Flow v2.0 — Simons-Inspired NSE Swing Trading System*
*Total flows: 11 | Total services: 11 | Total cron jobs: 10*
*Estimated implementation time with Claude Code: 6-8 hours*
