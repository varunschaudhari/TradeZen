/**
 * @file gateChecker.js
 * @description Flow 3 — 8-gate safety system + Simons-style composite score.
 *              Gates run sequentially; hard-block gates (1,2,3,6,8) cancel a BUY
 *              regardless of score. Strong filters (4,5) reduce the gate count and
 *              attach tags (MEAN_REVERSION, OVERSOLD, OVERBOUGHT, VOLUME_ANOMALY…)
 *              but never individually hard-block. Gate 7 (Claude confidence) is
 *              evaluated separately after the Claude call.
 * @author TradeZen Team
 * @created 2026-06-13
 * @lastModified 2026-06-20
 *
 * Field binding note: the process-flow doc uses idealized field names
 * (weeklyPrice, daysToEarnings, rs…). The Python /analyze service actually returns
 * weeklyTrend, earningsTimestamp, indicators.{rsi14,volRatio,bbPctB}, and
 * suggested{Entry,StopLoss,Target1,Target2}. This file binds to the REAL shapes and
 * treats not-yet-available signals (rs, FII, promoter, PEAD, sector, P/C) as absent
 * (no effect) until simonsSignals.js supplies them.
 */

import {
  BB_MEAN_REVERSION,
  BB_OVERBOUGHT,
  BULLISH_CANDLE_PATTERNS,
  COMPOSITE_BASE_SCORE,
  COMPOSITE_POINTS,
  CONFIDENCE_LEVELS,
  EARNINGS_BUFFER_DAYS,
  EARNINGS_WARNING_DAYS,
  GATES_REQUIRED_FOR_CLAUDE,
  NEGATIVE_NEWS_KEYWORDS,
  PC_RATIO_FEAR,
  PROXIMITY_52W_HIGH_PCT,
  RISK_REWARD_MIN,
  RS_GATE2_MIN,
  RS_STRONG_LEADER,
  RSI_MAX,
  RSI_MEAN_REVERSION,
  RSI_MIN,
  SCORE_HIGH_CONFIDENCE,
  SCORE_MEDIUM_CONFIDENCE,
  SENTIMENT_STRONG_POSITIVE,
  SENTIMENTS,
  VOLUME_RATIO_MIN,
  WEEKLY_TRENDS,
} from '../config/constants.js';
import { logger } from '../config/logger.js';

const HARD_BLOCK_GATES = new Set([1, 2, 3, 6, 8]);

// ── Gate 1: Nifty 50 above 20 EMA — HARD BLOCK ─────────────────────────────────
function checkGate1(marketData) {
  const nifty = marketData?.nifty50;
  const price = nifty?.price;
  const ema20 = nifty?.ema20;
  if (price == null || ema20 == null) {
    return { passed: false, reason: 'Nifty 50 data unavailable — defaulting to BLOCK' };
  }
  if (price <= ema20) {
    return { passed: false, reason: `Nifty ₹${price} below 20 EMA ₹${ema20} — bear market` };
  }
  return { passed: true, reason: `Nifty ₹${price} above 20 EMA ₹${ema20} — bull market confirmed` };
}

// ── Gate 2: Weekly trend bullish (+ relative strength) — HARD BLOCK ─────────────
function checkGate2(stockData) {
  const trend = stockData?.weeklyTrend;
  if (!trend) {
    return { passed: false, reason: 'Weekly trend data unavailable — defaulting to BLOCK' };
  }
  if (trend === WEEKLY_TRENDS.BEARISH) {
    return { passed: false, reason: 'Weekly trend BEARISH — stock below weekly 50 EMA' };
  }
  const rs = stockData?.relativeStrength ?? stockData?.rs ?? null;
  if (rs != null && rs <= RS_GATE2_MIN) {
    return {
      passed: false,
      reason: `Relative strength ${rs} ≤ ${RS_GATE2_MIN} — laggard vs Nifty`,
    };
  }
  const rsNote = rs != null ? `, RS ${rs}` : '';
  return { passed: true, reason: `Weekly trend ${trend}${rsNote} — acceptable for BUY` };
}

// ── Gate 3: No earnings within 15 days — HARD BLOCK ────────────────────────────
function checkGate3(stockData) {
  const ts = stockData?.earningsTimestamp;
  if (!ts) return { passed: true, reason: 'No upcoming earnings date — no earnings risk' };

  const daysToEarnings = Math.floor((ts * 1000 - Date.now()) / 86_400_000);
  if (daysToEarnings >= 0 && daysToEarnings <= EARNINGS_BUFFER_DAYS) {
    return {
      passed: false,
      reason: `Earnings in ${daysToEarnings} day(s) — within ${EARNINGS_BUFFER_DAYS}-day buffer`,
    };
  }
  // 15–20 days: pass but flag a warning for the Claude prompt
  if (daysToEarnings > EARNINGS_BUFFER_DAYS && daysToEarnings <= EARNINGS_WARNING_DAYS) {
    return {
      passed: true,
      warning: true,
      reason: `Earnings in ${daysToEarnings} days — caution window, flagged for Claude`,
    };
  }
  const label = daysToEarnings > 0 ? `${daysToEarnings} days away` : 'already reported';
  return { passed: true, reason: `Next earnings ${label} — safe to trade` };
}

// ── Gate 4: RSI sweet spot (+ mean-reversion / oversold / overbought) — STRONG ──
function checkGate4(stockData) {
  const ind = stockData?.indicators ?? {};
  const rsi = ind.rsi14;
  if (rsi == null) return { passed: false, reason: 'RSI data unavailable' };

  if (rsi >= RSI_MIN && rsi <= RSI_MAX) {
    return { passed: true, reason: `RSI ${rsi.toFixed(1)} in sweet spot [${RSI_MIN}–${RSI_MAX}]` };
  }
  if (rsi > RSI_MAX) {
    return {
      passed: false,
      tag: 'OVERBOUGHT',
      reason: `RSI ${rsi.toFixed(1)} > ${RSI_MAX} — overbought`,
    };
  }
  // rsi < RSI_MIN — check the mean-reversion exception (still up long-term, near lower band)
  const price = stockData?.currentPrice ?? stockData?.price;
  const ema200 = ind.ema200;
  const ema50 = ind.ema50;
  const bbB = ind.bbPctB;
  const macd = ind.macd;
  const macdSignal = ind.macdSignal;

  const meanReversion =
    rsi < RSI_MEAN_REVERSION &&
    bbB != null &&
    bbB < BB_MEAN_REVERSION &&
    price != null &&
    ema200 != null &&
    price > ema200;
  if (meanReversion) {
    return {
      passed: true,
      tag: 'MEAN_REVERSION',
      reason: `RSI ${rsi.toFixed(1)} oversold but above EMA200 — mean-reversion setup`,
    };
  }

  // NEW: RSI bounce detection — RSI 25-40 with momentum confirmation
  // Catches early oversold bounces IF price is recovering and momentum is positive
  const rsiInBounceZone = rsi >= 25 && rsi < RSI_MIN;
  const priceRecovering = price != null && ema50 != null && price > ema50;
  const momentumPositive = macd != null && macdSignal != null && macd > macdSignal;

  if (rsiInBounceZone && priceRecovering && momentumPositive) {
    return {
      passed: true,
      tag: 'RSI_BOUNCE',
      reason: `RSI ${rsi.toFixed(1)} oversold bounce with MACD confirmation — price above EMA50`,
    };
  }

  return {
    passed: false,
    tag: 'OVERSOLD',
    reason: `RSI ${rsi.toFixed(1)} < ${RSI_MIN} — oversold, no momentum confirmation`,
  };
}

// ── Gate 5: Volume confirmation (+ Simons volume anomaly) — STRONG FILTER ───────
function checkGate5(stockData) {
  const vol = stockData?.indicators?.volRatio;
  const dayChangePct = stockData?.dayChangePct;
  // Volume anomaly is computed by simonsSignals.js (needs 3-day history); honor it if present.
  const volumeAnomaly = stockData?.volumeAnomaly === true;
  if (vol == null) {
    return { passed: false, volumeAnomaly, reason: 'Volume ratio data unavailable' };
  }
  if (vol >= VOLUME_RATIO_MIN) {
    return {
      passed: true,
      volumeAnomaly,
      reason: `Volume ${vol.toFixed(2)}× ≥ ${VOLUME_RATIO_MIN}× — participation confirmed`,
    };
  }
  if (volumeAnomaly) {
    return {
      passed: true,
      volumeAnomaly,
      reason: `Volume ${vol.toFixed(2)}× but 3-day anomaly detected`,
    };
  }

  // NEW: Accumulation pattern detection — elevated volume + price rising
  // Captures smart money entering even if not at 1.5× yet (catches early accumulation)
  const accumulationThreshold = 1.2; // Lower than VOLUME_RATIO_MIN
  const priceRising = dayChangePct != null && dayChangePct > 0;
  const volumeElevated = vol >= accumulationThreshold;

  if (volumeElevated && priceRising) {
    return {
      passed: true,
      tag: 'ACCUMULATION',
      reason: `Volume ${vol.toFixed(2)}× elevated + price rising — accumulation pattern detected`,
    };
  }

  return {
    passed: false,
    volumeAnomaly,
    tag: 'VOLUME_UNCONFIRMED',
    reason: `Volume ${vol.toFixed(2)}× < ${VOLUME_RATIO_MIN}× — weak participation`,
  };
}

// ── Gate 6: Risk:Reward ≥ 2:1 (uses Target 2) — HARD BLOCK ──────────────────────
function checkGate6(stockData) {
  const entry = stockData?.suggestedEntry;
  const sl = stockData?.suggestedStopLoss;
  const t1 = stockData?.suggestedTarget1;
  const t2 = stockData?.suggestedTarget2;
  if (!entry || !sl || !t2 || entry <= 0) {
    return { passed: false, reason: 'Entry / SL / target data missing — cannot compute R:R' };
  }
  const risk = entry - sl;
  if (risk <= 0) {
    return { passed: false, reason: `Stop loss ₹${sl} ≥ entry ₹${entry} — invalid setup` };
  }
  const rrT1 = t1 ? Number(((t1 - entry) / risk).toFixed(2)) : null;
  const rrT2 = Number(((t2 - entry) / risk).toFixed(2));
  if (rrT2 < RISK_REWARD_MIN) {
    return {
      passed: false,
      rrT1,
      rrT2,
      reason: `R:R ${rrT2}:1 below ${RISK_REWARD_MIN}:1 minimum`,
    };
  }
  return {
    passed: true,
    rrT1,
    rrT2,
    reason: `R:R ${rrT2}:1 (T1 ${rrT1}:1) meets ${RISK_REWARD_MIN}:1`,
  };
}

// ── Gate 7: Score confidence HIGH — DETERMINISTIC INTELLIGENCE LAYER (post-gates) ──────
// Was "Claude confidence"; now the composite score's own confidence band (verdictEngine).
// The old gate claimed BULL-accepts-MEDIUM, but the enforced rule was always BUY⇒HIGH
// (parseClaudeResponse downgraded every non-HIGH BUY) — this makes record and rule agree.
export const checkGate7 = (verdictResult, marketData) => {
  const confidence = verdictResult?.confidence;

  // BEAR mode: no BUY signals allowed
  if (marketData?.marketMode === 'BEAR') {
    return {
      passed: false,
      reason: 'Market in BEAR mode — BUY signals paused, only WAIT/SKIP allowed',
    };
  }

  if (confidence !== CONFIDENCE_LEVELS.HIGH) {
    return {
      passed: false,
      reason: `Score confidence ${confidence ?? 'UNKNOWN'} — HIGH required for BUY`,
    };
  }
  return { passed: true, reason: 'Composite score confidence HIGH — intelligence layer passed' };
};

// ── Gate 8: News sentiment + auto-negative keywords — HARD BLOCK ────────────────
function checkGate8(newsData) {
  const sentiment = newsData?.sentiment;
  const headlines = Array.isArray(newsData?.headlines) ? newsData.headlines : [];

  const hit = findNegativeKeyword(headlines);
  if (hit) {
    return {
      passed: false,
      reason: `Auto-negative news keyword "${hit.keyword}": ${hit.headline}`,
    };
  }
  if (!sentiment || sentiment === SENTIMENTS.NEGATIVE) {
    return {
      passed: false,
      reason: `News sentiment ${sentiment ?? 'UNAVAILABLE'} — adverse environment`,
    };
  }
  return { passed: true, reason: `News sentiment ${sentiment} — no adverse news detected` };
}

/**
 * Scan headlines for any auto-negative keyword (case-insensitive).
 *
 * @param {string[]} headlines - News headlines for the stock
 * @returns {{ keyword: string, headline: string }|null} First match, or null
 */
function findNegativeKeyword(headlines) {
  for (const headline of headlines) {
    const lower = String(headline).toLowerCase();
    const keyword = NEGATIVE_NEWS_KEYWORDS.find((kw) => lower.includes(kw));
    if (keyword) return { keyword, headline };
  }
  return null;
}

/**
 * Calculate the Simons-style composite score (base + signal adjustments).
 *
 * Each rule fires only when its underlying data is present, so signals not yet
 * wired (FII flow, promoter holding, PEAD, sector rotation, P/C ratio) simply do
 * not contribute until simonsSignals.js supplies them.
 *
 * @param {object} stockData  - StockAnalysis (+ any enrichment fields)
 * @param {object} marketData - Market snapshot (+ fiiTrend, pcRatio, niftyDownStreak)
 * @param {object} newsData   - { sentiment, score|sentimentScore, headlines }
 * @param {object} [extras]   - { volumeAnomaly, topSector, bottomSector } from gates/signals
 * @returns {{ score: number, breakdown: Array<{label:string,points:number}>, scoreConfidence: string }}
 */
export const calculateCompositeScore = (stockData, marketData, newsData, extras = {}) => {
  const ind = stockData?.indicators ?? {};
  const price = stockData?.currentPrice ?? stockData?.price ?? null;
  const rsi = ind.rsi14 ?? null;
  const rsiSweet = rsi != null && rsi >= RSI_MIN && rsi <= RSI_MAX;
  const rs = stockData?.relativeStrength ?? stockData?.rs ?? null;
  const pcRatio = marketData?.pcRatio ?? null;
  const fiiTrend = marketData?.fiiTrend ?? null;
  const sentimentScore = newsData?.score ?? newsData?.sentimentScore ?? null;
  const candle = ind.candlePattern ?? null;
  const bbB = ind.bbPctB ?? null;
  const proximity =
    price != null && stockData?.high52w
      ? ((stockData.high52w - price) / stockData.high52w) * 100
      : null;
  const momentum6m = stockData?.momentum6m ?? null;
  const P = COMPOSITE_POINTS;

  const rules = [
    // ── Measured price-signal edge (carry the score today) ──
    { on: rsiSweet, pts: P.RSI_SWEET_SPOT, label: `RSI ${rsi?.toFixed(0)} in sweet spot (${RSI_MIN}–${RSI_MAX})` },
    {
      on: rs != null && rs >= RS_STRONG_LEADER,
      pts: P.RS_STRONG_LEADER,
      label: `Relative strength ${rs} ≥ ${RS_STRONG_LEADER} (strong leader)`,
    },
    {
      on: momentum6m != null && momentum6m > 0,
      pts: P.MOMENTUM_6M_POSITIVE,
      label: `6-month momentum ${momentum6m?.toFixed(1)}% positive`,
    },
    {
      on: proximity != null && proximity < PROXIMITY_52W_HIGH_PCT && rsiSweet,
      pts: P.NEAR_52W_HIGH,
      label: 'Near 52W high with healthy RSI',
    },
    // ── External signals (contribute only once their data feeds are wired) ──
    { on: fiiTrend === 'BUYING', pts: P.FII_BUYING, label: 'FII net buyer 3+ days' },
    {
      on: stockData?.promoterChange === 'INCREASED',
      pts: P.PROMOTER_INCREASE,
      label: 'Promoter holding increased',
    },
    { on: stockData?.peadSetup === true, pts: P.PEAD, label: 'PEAD setup active' },
    { on: extras.topSector === true, pts: P.TOP_SECTOR, label: 'Top-2 sector this week' },
    {
      on: sentimentScore != null && sentimentScore > SENTIMENT_STRONG_POSITIVE,
      pts: P.STRONG_SENTIMENT,
      label: 'Strong positive news',
    },
    {
      on: pcRatio != null && pcRatio > PC_RATIO_FEAR,
      pts: P.PC_FEAR,
      label: `P/C ratio ${pcRatio} > ${PC_RATIO_FEAR}`,
    },
    {
      on: candle != null && BULLISH_CANDLE_PATTERNS.includes(candle),
      pts: P.BULLISH_CANDLE,
      label: `Bullish candle (${candle})`,
    },
    {
      on: stockData?.macdHistogramRising === true,
      pts: P.MACD_RISING,
      label: 'MACD histogram rising 3+ days',
    },
    // ── Penalties (measured-dilutive conditions) ──
    {
      on: rsi != null && rsi > RSI_MAX,
      pts: P.RSI_OVERBOUGHT,
      label: `RSI ${rsi?.toFixed(0)} overbought (>${RSI_MAX})`,
    },
    {
      on: bbB != null && bbB > BB_OVERBOUGHT,
      pts: P.BB_OVERBOUGHT,
      label: `Bollinger %B ${bbB} > ${BB_OVERBOUGHT}`,
    },
    { on: fiiTrend === 'SELLING', pts: P.FII_SELLING, label: 'FII net seller 3+ days' },
    {
      on: stockData?.promoterChange === 'DECREASED',
      pts: P.PROMOTER_DECREASE,
      label: 'Promoter holding decreased',
    },
    { on: extras.bottomSector === true, pts: P.BOTTOM_SECTOR, label: 'Bottom-3 sector this week' },
    {
      on: marketData?.niftyDownStreak === true,
      pts: P.NIFTY_DOWN_STREAK,
      label: 'Nifty down 2+ days',
    },
  ];

  const breakdown = rules.filter((r) => r.on).map((r) => ({ label: r.label, points: r.pts }));
  const score = breakdown.reduce((sum, b) => sum + b.points, COMPOSITE_BASE_SCORE);
  let scoreConfidence = CONFIDENCE_LEVELS.LOW;
  if (score >= SCORE_HIGH_CONFIDENCE) scoreConfidence = CONFIDENCE_LEVELS.HIGH;
  else if (score >= SCORE_MEDIUM_CONFIDENCE) scoreConfidence = CONFIDENCE_LEVELS.MEDIUM;
  return { score, breakdown, scoreConfidence };
};

/**
 * Run the pre-Claude gates (1–6 and 8), collect tags, and compute the composite score.
 *
 * Gate 7 (Claude confidence) is evaluated separately via checkGate7() after Claude.
 * Hard-block gates (1,2,3,6,8): any failure sets hardBlockFired. Strong filters (4,5)
 * reduce gatesPassed and attach tags but never hard-block.
 *
 * @param {object} stockData  - StockAnalysis from Python service
 * @param {object} marketData - Market snapshot from Python service
 * @param {object} newsData   - { sentiment, headlines, score } from newsFetcher
 * @returns {{
 *   gatesPassed: number, gateDetails: object, hardBlockFired: boolean,
 *   shouldCallClaude: boolean, tags: string[], compositeScore: number,
 *   scoreBreakdown: Array<object>, scoreConfidence: string, earningsWarning: boolean
 * }}
 */
export const runAllGates = (stockData, marketData, newsData) => {
  const checks = [
    { n: 1, fn: () => checkGate1(marketData) },
    { n: 2, fn: () => checkGate2(stockData) },
    { n: 3, fn: () => checkGate3(stockData) },
    { n: 4, fn: () => checkGate4(stockData) },
    { n: 5, fn: () => checkGate5(stockData) },
    { n: 6, fn: () => checkGate6(stockData) },
    { n: 8, fn: () => checkGate8(newsData) },
  ];

  const gateDetails = {};
  const tags = [];
  let gatesPassed = 0;
  let hardBlockFired = false;
  let earningsWarning = false;
  let volumeAnomaly = false;
  let softGatesFailed = 0;

  for (const { n, fn } of checks) {
    let result;
    try {
      result = fn();
    } catch (err) {
      logger.error(`Gate ${n} threw unexpectedly`, { error: err.message });
      result = { passed: false, reason: `Gate ${n} evaluation error: ${err.message}` };
    }
    gateDetails[`gate${n}`] = { passed: result.passed, reason: result.reason };
    if (result.tag) tags.push(result.tag);
    if (result.warning) earningsWarning = true;
    if (result.volumeAnomaly) volumeAnomaly = true;
    if (result.passed) gatesPassed += 1;
    else if (HARD_BLOCK_GATES.has(n)) hardBlockFired = true;
    else if (!result.passed && (n === 4 || n === 5)) softGatesFailed += 1;
  }

  gateDetails.gate7 = { passed: false, reason: 'Pending verdict-engine confidence check' };

  const extras = {
    volumeAnomaly,
    topSector: stockData?.sectorTailwind === true,
    bottomSector: stockData?.sectorHeadwind === true,
  };
  const { score, breakdown, scoreConfidence } = calculateCompositeScore(
    stockData,
    marketData,
    newsData,
    extras
  );
  if (volumeAnomaly) tags.push('VOLUME_ANOMALY');

  const shouldCallClaude = !hardBlockFired && gatesPassed >= GATES_REQUIRED_FOR_CLAUDE;

  logger.info('Gate check complete', {
    symbol: stockData?.symbol,
    gatesPassed,
    hardBlockFired,
    compositeScore: score,
    tags,
    shouldCallClaude,
  });

  return {
    gatesPassed,
    gateDetails,
    hardBlockFired,
    softGatesFailed,
    shouldCallClaude,
    tags,
    compositeScore: score,
    scoreBreakdown: breakdown,
    scoreConfidence,
    earningsWarning,
  };
};

/**
 * Doc-named entry point (Section 4). Thin wrapper over runAllGates returning the
 * { gatesPassed, gateDetails, overallPass } shape plus composite-score extras.
 *
 * @param {object} stockData
 * @param {object} marketData
 * @param {object} newsData
 * @returns {{ gatesPassed:number, gateDetails:object, overallPass:boolean,
 *             compositeScore:number, scoreConfidence:string, tags:string[] }}
 */
export const evaluateAllGates = (stockData, marketData, newsData) => {
  const result = runAllGates(stockData, marketData, newsData);
  return {
    gatesPassed: result.gatesPassed,
    gateDetails: result.gateDetails,
    overallPass: !result.hardBlockFired && result.gatesPassed >= GATES_REQUIRED_FOR_CLAUDE,
    compositeScore: result.compositeScore,
    scoreConfidence: result.scoreConfidence,
    tags: result.tags,
  };
};
