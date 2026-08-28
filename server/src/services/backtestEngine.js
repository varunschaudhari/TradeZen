/**
 * @file backtestEngine.js
 * @description Walk-forward backtester. For each historical day it reconstructs the
 *              as-of-day stock state from per-bar indicator series (Python), runs the
 *              EXACT live scorers (calculateSimonsSignals + runAllGates) AND the exact
 *              live verdict engine (decideVerdict), and for every Claude-eligible bar
 *              (gates ≥ 5, no hard block) simulates a trade using the EXACT live exit
 *              rule (book half at T1, then ATR-trail replaces the hard T2 close —
 *              mirrors evaluateTrade/processTrade in tradeTracker.js bar-for-bar).
 *              Aggregates win rate / expectancy overall, restricted to what the live
 *              strategy actually BUYs (score confidence HIGH), and by composite-score
 *              bucket so the BUY threshold itself can be calibrated against history.
 *
 * Honest limitations (documented so results aren't over-trusted):
 *  - Levels (entry/SL/T1/T2) are a JS-side heuristic (EMA20 pullback entry, swing-low or
 *    ATR stop, fixed 2R/3R targets) — NOT a replay of the Python S/R+Fibonacci engine,
 *    which isn't cheap enough to run per-bar over years of history. decideVerdict() is
 *    replayed exactly; the LEVELS it scores are an approximation of the live ones.
 *  - marketMode is approximated from Nifty-vs-its-own-20EMA (gate 1's own signal) since
 *    historical VIX/A-D-ratio regime data isn't recorded — BEAR-via-VIX can't replay.
 *  - Gate 8 (news) and Gate 3 (earnings) can't be replayed historically → assumed pass.
 *  - FII/sector/P-C weren't recorded historically → those composite signals are absent
 *    (so backtest scores reflect price-derived signals only — the honest historical view).
 *  - Weekly trend is approximated from the daily EMA50.
 *  - The ATR trail's high-water mark uses the bar's HIGH (optimistic vs. live's per-quote
 *    tracking) — backtest works in daily OHLC, not intraday ticks.
 *
 * @author TradeZen Team
 * @created 2026-06-21
 * @lastModified 2026-07-13
 */

import {
  ATR_TRAIL_ENABLED,
  ATR_TRAIL_MULT,
  ATR_TRAIL_REPLACES_T2,
  BACKTEST_CONCURRENCY,
  BACKTEST_COST_STATUTORY_PCT,
  BACKTEST_ENTRY_EMA20_BAND,
  BACKTEST_FALLBACK_SL_PCT,
  BACKTEST_HOLD_BUFFER,
  BACKTEST_HOLD_DAYS,
  BACKTEST_HOLD_MAX_DAYS,
  BACKTEST_HOLD_MIN_DAYS,
  BACKTEST_PERIOD,
  BACKTEST_SL_ATR_MULT,
  BACKTEST_SLIPPAGE_ATR_MULT,
  BACKTEST_SLIPPAGE_MAX_PCT,
  BACKTEST_SLIPPAGE_MIN_PCT,
  BACKTEST_SR_CLUSTER_PCT,
  BACKTEST_SR_LOOKBACK_BARS,
  BACKTEST_SR_MAX_LEVELS,
  BACKTEST_SR_SWING_ORDER,
  BACKTEST_TARGET1_RR,
  BACKTEST_TARGET2_RR,
  BACKTEST_WARMUP_BARS,
  BB_OVERBOUGHT,
  PROXIMITY_52W_HIGH_PCT,
  RSI_MAX,
  RSI_MIN,
  SIMONS_POINTS,
  VERDICTS,
} from '../config/constants.js';
import { logger } from '../config/logger.js';
import { fetchIndicatorSeries, fetchNiftySeries } from './pythonBridge.js';
import { calculateSimonsSignals } from './simonsSignals.js';
import { runAllGates } from './gateChecker.js';
import { decideVerdict } from './verdictEngine.js';
import MarketRegimeHistory from '../models/MarketRegimeHistory.js';

const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

/**
 * Run async `fn` over `items` with a bounded number of concurrent workers — mirrors
 * stockDiscovery.js's own helper of the same shape. yfinance/Python fetches are the
 * bottleneck per symbol, so this is what turns a sequential 30-symbol run (minutes) into
 * a parallel one, without opening unbounded concurrent requests at the Python service.
 * Failed tasks resolve to null and are filtered out — one bad symbol never kills the run.
 *
 * @param {any[]} items - Work items
 * @param {number} limit - Max concurrent workers
 * @param {(item:any)=>Promise<any>} fn - Async task
 * @returns {Promise<any[]>} Successful results (nulls removed), NOT necessarily in input order
 */
async function mapWithConcurrency(items, limit, fn) {
  const results = [];
  let cursor = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      try {
        results[idx] = await fn(items[idx]);
      } catch (err) {
        logger.error('Backtest task failed', { error: err.message });
        results[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return results.filter(Boolean);
}

/**
 * EMA over a (possibly null-gapped) array; nulls carry the previous EMA.
 * @param {Array<number|null>} values
 * @param {number} period
 * @returns {Array<number|null>}
 */
function ema(values, period) {
  const alpha = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  let prev = null;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v == null) {
      out[i] = prev;
      continue;
    }
    prev = prev == null ? v : alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

/**
 * Align an index series to a stock's bar dates (carry-forward on missing dates).
 * @param {string[]} stockDates
 * @param {string[]} idxDates
 * @param {number[]} idxCloses
 * @returns {Array<number|null>}
 */
function alignByDate(stockDates, idxDates, idxCloses) {
  const map = new Map(idxDates.map((d, i) => [d, idxCloses[i]]));
  let last = null;
  return stockDates.map((d) => {
    const v = map.get(d);
    if (v != null) last = v;
    return last;
  });
}

/**
 * Merge nearby swing-low prices into clusters, same greedy pass as python-service's
 * _cluster_levels: sort ascending, and merge each price into the first existing cluster
 * whose running mean it falls within BACKTEST_SR_CLUSTER_PCT of (else start a new one).
 * Strength = touch count (how many swing lows merged into that cluster).
 * @param {number[]} prices - raw swing-low prices (unsorted)
 * @returns {Array<{ price: number, touches: number }>}
 */
function clusterSwingLows(prices) {
  if (!prices.length) return [];
  const sorted = [...prices].sort((a, b) => a - b);
  const clusters = [];
  for (const price of sorted) {
    let merged = false;
    for (const cluster of clusters) {
      const rep = cluster.reduce((s, p) => s + p, 0) / cluster.length;
      if (rep > 0 && Math.abs(price - rep) / rep < BACKTEST_SR_CLUSTER_PCT) {
        cluster.push(price);
        merged = true;
        break;
      }
    }
    if (!merged) clusters.push([price]);
  }
  return clusters.map((c) => ({
    price: c.reduce((s, p) => s + p, 0) / c.length,
    touches: c.length,
  }));
}

/**
 * Real swing-low support levels as-of bar t — a JS port of python-service
 * find_support_resistance()'s support side (scipy argrelextrema local minima +
 * proximity clustering), restricted to the trailing BACKTEST_SR_LOOKBACK_BARS window
 * (mirrors OHLCV_PERIOD_DAILY='6mo') and using only bars ≤ t: a low at index i needs
 * BACKTEST_SR_SWING_ORDER STRICTLY lower bars confirmed on each side (ties don't
 * count — matches np.less), so the most recent SWING_ORDER bars can never be
 * confirmed as swing lows yet, exactly like live evaluating "as of today."
 *
 * @param {Array<number|null>} lows - full low series
 * @param {number} t - bar index (inclusive)
 * @param {number} currentPrice - series.close[t] — live's sort/filter reference price
 * @returns {Array<{ price: number, touches: number }>} top BACKTEST_SR_MAX_LEVELS
 *   supports below currentPrice, sorted (-touches, proximity to currentPrice) — same
 *   order find_support_resistance returns
 */
function swingLowSupports(lows, t, currentPrice) {
  const start = Math.max(0, t - BACKTEST_SR_LOOKBACK_BARS + 1);
  const order = BACKTEST_SR_SWING_ORDER;
  const swingLowPrices = [];
  for (let i = start + order; i <= t - order; i += 1) {
    const v = lows[i];
    if (v == null) continue;
    let isMin = true;
    for (let k = i - order; k <= i + order; k += 1) {
      if (k === i) continue;
      const other = lows[k];
      if (other == null || other <= v) { isMin = false; break; }
    }
    if (isMin) swingLowPrices.push(v);
  }
  return clusterSwingLows(swingLowPrices)
    .filter((c) => c.price < currentPrice)
    .sort((a, b) => (b.touches - a.touches) || (Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice)))
    .slice(0, BACKTEST_SR_MAX_LEVELS);
}

/**
 * Suggested entry/SL/targets as-of bar t — mirrors Python _compute_trade_levels AND
 * _select_stop_loss exactly: EMA20-pullback entry, then a stop chosen by (1) the
 * nearest real swing-low support below entry, (2) an ATR-based stop, (3) a flat %
 * fallback — in that priority order, same as live.
 * @param {object} series - Indicator series
 * @param {number} t - Bar index
 * @returns {{ entry: number, sl: number, t1: number, t2: number }}
 */
function computeLevels(series, t) {
  const price = series.close[t];
  const e20 = series.ema20[t];
  const atr = series.atr14[t];
  const entry =
    e20 != null && Math.abs(e20 - price) / price < BACKTEST_ENTRY_EMA20_BAND ? e20 : price;

  const supportsBelowEntry = swingLowSupports(series.low, t, price)
    .map((c) => c.price)
    .filter((p) => p < entry);

  let sl = supportsBelowEntry.length
    ? Math.max(...supportsBelowEntry)
    : atr != null
      ? entry - atr * BACKTEST_SL_ATR_MULT
      : entry * (1 - BACKTEST_FALLBACK_SL_PCT);
  if (sl >= entry) sl = entry * (1 - BACKTEST_FALLBACK_SL_PCT);

  // Floor the stop distance so targets aren't trivially close (the v1 inflation bug):
  // a swing low just under entry made risk tiny → entry+2R/3R got hit automatically.
  // Live has no equivalent floor — this stays a deliberate backtest-only safety net,
  // though now secondary: real clustered swing-low detection (vs. the old "lowest low
  // in 20 bars" heuristic) makes degenerate tiny-risk stops much rarer on its own.
  const minRisk = Math.max(atr != null ? atr : 0, entry * BACKTEST_FALLBACK_SL_PCT);
  let risk = entry - sl;
  if (risk < minRisk) {
    risk = minRisk;
    sl = entry - risk;
  }
  return {
    entry: round2(entry),
    sl: round2(sl),
    t1: round2(entry + BACKTEST_TARGET1_RR * risk),
    t2: round2(entry + BACKTEST_TARGET2_RR * risk),
    risk,
    atr: atr ?? null,
  };
}

/**
 * Hold window (bars) for a trade. 'fixed' returns the flat baseline; 'linear' and
 * 'adaptive' size the time-stop to the stock's velocity — how many days the move to T2
 * should take given the stock's daily ATR.
 *   linear   : days = (targetMove% ÷ atr%) × BUFFER   — assumes a clean directional trend
 *   adaptive : days = (targetMove% ÷ atr%)²           — diffusion/random-walk (longer, more honest)
 * Falls back to the fixed baseline when ATR is missing/zero, then clamps to [MIN, MAX].
 *
 * @param {object} levels - { entry, t2, atr }
 * @param {'fixed'|'linear'|'adaptive'} mode
 * @returns {number} bars to hold before a time exit
 */
function holdWindowDays(levels, mode) {
  // Explicit fixed horizon: 'fixed' → BACKTEST_HOLD_DAYS; 'fixed:N' → exactly N bars
  // (used for the short/medium/long horizon comparison — N is NOT clamped to [MIN,MAX]).
  if (mode.startsWith('fixed')) {
    const n = mode.includes(':') ? parseInt(mode.split(':')[1], 10) : NaN;
    return Number.isFinite(n) ? n : BACKTEST_HOLD_DAYS;
  }
  const { entry, t2, atr } = levels;
  if (!(atr > 0) || !(entry > 0) || t2 == null) return BACKTEST_HOLD_DAYS;
  const targetPct = ((t2 - entry) / entry) * 100;
  const atrPct = (atr / entry) * 100;
  if (!(atrPct > 0)) return BACKTEST_HOLD_DAYS;
  const ratio = targetPct / atrPct;
  const raw = mode === 'linear' ? ratio * BACKTEST_HOLD_BUFFER : ratio * ratio;
  return Math.round(Math.min(BACKTEST_HOLD_MAX_DAYS, Math.max(BACKTEST_HOLD_MIN_DAYS, raw)));
}

/**
 * Reconstruct the enriched stock state as-of bar t (indicators + Simons enrichment).
 * @param {string} symbol
 * @param {object} series
 * @param {number} t
 * @param {Array<number|null>} niftyAligned
 * @returns {{ stockData: object, levels: object, simons: object }}
 */
function buildStockAsOf(symbol, series, t, niftyAligned) {
  const ind = {
    ema20: series.ema20[t],
    ema50: series.ema50[t],
    ema200: series.ema200[t],
    rsi14: series.rsi14[t],
    atr14: series.atr14[t],
    bbPctB: series.bbPctB[t],
    volRatio: series.volRatio[t],
    macd: series.macd[t],
    macdSignal: series.macdSignal[t],
    candlePattern: 'NONE',
  };
  const price = series.close[t];
  const high52w = Math.max(
    ...series.high.slice(Math.max(0, t - 251), t + 1).filter((x) => x != null)
  );
  const levels = computeLevels(series, t);
  const weeklyTrend =
    ind.ema50 == null
      ? 'SIDEWAYS'
      : price > ind.ema50
        ? 'BULLISH'
        : price < ind.ema50
          ? 'BEARISH'
          : 'SIDEWAYS';

  const simons = calculateSimonsSignals({
    indicators: ind,
    currentPrice: price,
    high52w,
    closes: series.close.slice(0, t + 1),
    highs: series.high.slice(0, t + 1),
    lows: series.low.slice(0, t + 1),
    volumes: series.volume.slice(0, t + 1),
    niftyCloses: niftyAligned.slice(0, t + 1),
    external: {},
    skipGaps: true,
  });

  const stockData = {
    symbol,
    currentPrice: price,
    high52w,
    weeklyTrend,
    earningsTimestamp: null,
    indicators: ind,
    suggestedEntry: levels.entry,
    suggestedStopLoss: levels.sl,
    suggestedTarget1: levels.t1,
    suggestedTarget2: levels.t2,
    ...simons.enrichment,
  };
  return { stockData, levels, simons };
}

/**
 * Derive the set of human-readable signal flags present on a trade — drawn from the
 * Simons signal outputs, RSI/Bollinger bands, and gate tags. These are what the
 * per-signal edge report groups by. Only price-derived signals are listed (external
 * signals — FII/sector/P-C/PEAD/news/candle — are absent in backtest, so omitted).
 *
 * @param {object} simons - calculateSimonsSignals() output
 * @param {object} gate - runAllGates() output (for gate-only tags)
 * @param {object} ind - indicators { rsi14, bbPctB }
 * @param {number|null} proximityPct - distance below 52-week high, %
 * @returns {string[]}
 */
function extractSignalFlags(simons, gate, ind, proximityPct) {
  const f = new Set();
  const s = simons.signals ?? {};

  if (s.relativeStrength?.category && s.relativeStrength.category !== 'UNKNOWN') {
    f.add(`RS_${s.relativeStrength.category}`); // RS_STRONG_LEADER | RS_LEADER | RS_IN_LINE | RS_LAGGARD
  }
  const mom = s.momentum?.momentum6m;
  if (mom != null) {
    if (s.momentum.score >= SIMONS_POINTS.MOMENTUM_STRONG) f.add('MOM6M_STRONG');
    f.add(mom > 0 ? 'MOM6M_POSITIVE' : 'MOM6M_NEGATIVE');
  }
  if (s.meanReversion?.active) f.add('MEAN_REVERSION');
  if (s.volumeAnomaly?.anomaly) f.add('VOLUME_ANOMALY');
  if (s.fiftyTwoWeekHigh?.is52WMomentum) f.add('FIFTYTWO_W_MOMENTUM');
  if (proximityPct != null && proximityPct < PROXIMITY_52W_HIGH_PCT) f.add('NEAR_52W_HIGH');

  const rsi = ind?.rsi14;
  if (rsi != null) {
    if (rsi > RSI_MAX) f.add('RSI_OVERBOUGHT');
    else if (rsi < RSI_MIN) f.add('RSI_OVERSOLD');
    else f.add('RSI_SWEET_SPOT');
  }
  if (ind?.bbPctB != null && ind.bbPctB > BB_OVERBOUGHT) f.add('BB_OVERBOUGHT');

  for (const tag of gate?.tags ?? []) {
    if (tag === 'VOLUME_UNCONFIRMED') f.add('VOLUME_UNCONFIRMED');
  }
  return [...f];
}

/**
 * Realistically simulate a long: enter at the NEXT bar's open, book half at T1 and trail
 * the stop to entry for the remainder. Then — mirroring tradeTracker.js's live exit EXACTLY
 * — once T1 is booked and ATR data is available, the ATR trailing stop REPLACES the hard
 * T2 close (ATR_TRAIL_REPLACES_T2): the remaining half rides until price pulls back to
 * highWaterMark − ATR_TRAIL_MULT×ATR (never loosens, never below entry), not merely
 * because it touched T2. Trades without ATR data (or when the constant is off) keep the
 * legacy hard-T2-close behavior. On a bar that straddles both stop and target, assume the
 * STOP fills first (worst case). R is measured in planned-risk units against the actual
 * entry fill (captures entry slippage).
 *
 * @param {object} series - Indicator series (needs open/high/low/close)
 * @param {number} signalIdx - Bar the signal fired on (entry is signalIdx + 1)
 * @param {object} levels - { sl, t1, t2, risk, atr }
 * @param {number} holdDays - max bars to hold before a time exit (from holdWindowDays)
 * @returns {{ entry:number, exitIdx:number, exitPrice:number, reason:string, rMultiple:number, holdBars:number }|null}
 */
/**
 * Round-trip transaction cost in R (risk units). Statutory NSE delivery costs (per side)
 * plus ATR-scaled slippage (volatility as liquidity proxy → mid/small-caps cost more).
 * Dividing the %-of-notional cost by planned risk converts it to R.
 * @param {number} entry - actual entry fill
 * @param {number|null} atr - ATR at entry
 * @param {number} risk - planned risk per share (entry − stop)
 * @returns {number} positive cost in R, to subtract from gross R
 */
function tradeCostInR(entry, atr, risk) {
  if (!(entry > 0) || !(risk > 0)) return 0;
  const atrPct = atr > 0 ? (atr / entry) * 100 : 2; // ~2% fallback when ATR missing
  const slipPerSide = Math.min(
    BACKTEST_SLIPPAGE_MAX_PCT,
    Math.max(BACKTEST_SLIPPAGE_MIN_PCT, BACKTEST_SLIPPAGE_ATR_MULT * atrPct)
  );
  const roundTripPct = 2 * (BACKTEST_COST_STATUTORY_PCT + slipPerSide); // buy + sell
  return ((roundTripPct / 100) * entry) / risk;
}

function simulateTrade(series, signalIdx, levels, holdDays) {
  const entryIdx = signalIdx + 1;
  const n = series.close.length;
  if (entryIdx >= n) return null;
  const entry = series.open[entryIdx];
  if (entry == null) return null;
  const { sl, t1, t2, risk, atr } = levels;
  const last = Math.min(entryIdx + holdDays, n - 1);
  const R = (price) => round2((price - entry) / risk);
  const held = (exitIdx) => exitIdx - entryIdx + 1;
  const costInR = round2(tradeCostInR(entry, atr, risk)); // constant per trade (fill/risk/ATR)
  const atrTrailActive = ATR_TRAIL_ENABLED && atr > 0;

  let firstHalfR = null; // null until T1 books the first half
  let stop = sl;
  let trailRiding = false; // true once T1 is booked AND ATR data lets the trail take over
  let highWaterMark = entry;

  for (let k = entryIdx; k <= last; k += 1) {
    const lo = series.low[k];
    const hi = series.high[k];

    if (lo != null && lo <= stop) {
      // Worst-case: stop fills before any target on this bar.
      const stopR = R(stop);
      const r = firstHalfR == null ? stopR : (firstHalfR + stopR) / 2;
      return {
        entry,
        exitIdx: k,
        exitPrice: stop,
        reason: firstHalfR == null ? 'SL' : 'TRAIL',
        rMultiple: round2(r),
        costInR,
        holdBars: held(k),
      };
    }

    // Hard T2 close ONLY when not riding the ATR trail (legacy path / no ATR data) —
    // mirrors evaluateTrade's t2Hit: trade.target1Hit && !(trailRiding && ATR_TRAIL_REPLACES_T2).
    if (firstHalfR != null && !(trailRiding && ATR_TRAIL_REPLACES_T2) && hi != null && hi >= t2) {
      return {
        entry,
        exitIdx: k,
        exitPrice: t2,
        reason: 'T2',
        rMultiple: round2((firstHalfR + R(t2)) / 2),
        costInR,
        holdBars: held(k),
      };
    }

    if (firstHalfR == null && hi != null && hi >= t1) {
      firstHalfR = R(t1); // book half at T1, trail stop to entry for the rest
      stop = entry;
      highWaterMark = Math.max(highWaterMark, hi);
      trailRiding = atrTrailActive;
      continue; // trail doesn't ratchet on the same bar T1 was hit (matches processTrade's if/else)
    }

    // Ratchet the ATR trail upward post-T1 (never below entry, never loosens) — same
    // formula as evaluateTrade's trailAdvanceTo: hwm − ATR_TRAIL_MULT × atr14.
    if (firstHalfR != null && trailRiding && hi != null) {
      highWaterMark = Math.max(highWaterMark, hi);
      const proposed = round2(Math.max(entry, highWaterMark - ATR_TRAIL_MULT * atr));
      if (proposed > stop) stop = proposed;
    }
  }
  // The freshest fetched bar can have a null close (data provider hasn't settled the
  // current/most-recent trading day's price yet, though volume already came through) —
  // walk back to the last bar with a real close rather than let `(null - entry) / risk`
  // coerce to a nonsense ~-entry/risk "R multiple" via JS's null->0 arithmetic coercion.
  let timeExitIdx = last;
  while (timeExitIdx >= entryIdx && series.close[timeExitIdx] == null) timeExitIdx -= 1;
  if (timeExitIdx < entryIdx) return null; // no valid close anywhere in the holding window
  const exitPrice = series.close[timeExitIdx];
  const exitR = R(exitPrice);
  const r = firstHalfR == null ? exitR : (firstHalfR + exitR) / 2;
  return { entry, exitIdx: timeExitIdx, exitPrice, reason: 'TIME', rMultiple: round2(r), costInR, holdBars: held(timeExitIdx) };
}

/**
 * Load the real captured daily regime archive (MarketRegimeHistory) as a date → snapshot
 * map, so backtestSymbol can replay the ACTUAL classified mode (MIXED/CAUTION included,
 * not just BULL/BEAR) for any day this has been running, falling back to the
 * Nifty-vs-its-own-20EMA approximation for days before the archive existed. Collection
 * grows by one row/day, so fetching it whole is cheap — no date filter needed.
 *
 * @returns {Promise<Map<string, { marketMode:string, vix:number|null, adRatio:number|null }>>}
 */
async function fetchRegimeMap() {
  try {
    const rows = await MarketRegimeHistory.find({}).select('date marketMode vix adRatio').lean();
    return new Map(rows.map((r) => [r.date, { marketMode: r.marketMode, vix: r.vix ?? null, adRatio: r.adRatio ?? null }]));
  } catch (err) {
    logger.warn('Backtest: regime history unavailable — falling back to EMA approximation for all days', {
      error: err.message,
    });
    return new Map();
  }
}

/**
 * Backtest one symbol across one or more hold-modes in a SINGLE data pass.
 * The signal (gates + composite) is mode-independent, so it's computed once per bar and
 * only the exit simulation re-runs per mode. Each mode keeps its own no-overlap cursor,
 * so the three modes produce independent (and fairly comparable) trade streams.
 *
 * @param {string} symbol
 * @param {{ dates: string[], closes: number[] }} niftySeries
 * @param {object} opts - { period, modes: string[], regimeMap?: Map<string,object> }
 * @returns {Promise<Record<string, object[]>>} mode → trades[]
 */
async function backtestSymbol(symbol, niftySeries, opts) {
  const modes = opts.modes ?? ['fixed'];
  const out = Object.fromEntries(modes.map((m) => [m, []]));
  const data = await fetchIndicatorSeries(symbol, opts.period);
  if (!data?.series?.date?.length) {
    logger.warn(`Backtest: no data for ${symbol}`);
    return out;
  }
  const series = data.series;
  const niftyAligned = alignByDate(series.date, niftySeries.dates, niftySeries.closes);
  const niftyEma20 = ema(niftyAligned, 20);
  const n = series.date.length;
  const openUntil = Object.fromEntries(modes.map((m) => [m, 0])); // per-mode no-overlap cursor

  for (let t = BACKTEST_WARMUP_BARS; t < n - 1; t += 1) {
    if (series.ema200[t] == null) continue;
    const freeModes = modes.filter((m) => t >= openUntil[m]);
    if (!freeModes.length) continue; // every mode is mid-trade here

    const { stockData, levels, simons } = buildStockAsOf(symbol, series, t, niftyAligned);
    // Real captured regime (MIXED/CAUTION included) when this day is in the archive
    // (MarketRegimeHistory, collected going forward from 2026-08-21) — falls back to the
    // Nifty-vs-its-own-20EMA BULL/BEAR approximation for any day before that archive
    // existed, which is all every backtest could do until now.
    const realRegime = opts.regimeMap?.get(series.date[t]) ?? null;
    const market = {
      nifty50: {
        price: niftyAligned[t],
        ema20: niftyEma20[t],
        aboveEma20: niftyAligned[t] > niftyEma20[t],
      },
      marketMode: realRegime?.marketMode ?? (niftyAligned[t] > niftyEma20[t] ? 'BULL' : 'BEAR'),
      vix: realRegime?.vix ?? null,
      adRatio: realRegime?.adRatio ?? null,
      fiiTrend: 'NEUTRAL',
      pcRatio: null,
    };
    const gate = runAllGates(stockData, market, { sentiment: 'NEUTRAL', headlines: [] });
    if (!gate.shouldCallClaude || levels.entry <= levels.sl) continue;

    // The EXACT live verdict engine — same function, same thresholds, as the live scan.
    const verdictResult = decideVerdict(stockData, market, gate);

    // Signal flags are entry-time facts → mode-independent; compute once, share across modes.
    const proximityPct = stockData.high52w
      ? ((stockData.high52w - series.close[t]) / stockData.high52w) * 100
      : null;
    const signalFlags = extractSignalFlags(simons, gate, stockData.indicators, proximityPct);

    for (const mode of freeModes) {
      const holdDays = holdWindowDays(levels, mode);
      const sim = simulateTrade(series, t, levels, holdDays);
      if (!sim) continue;
      out[mode].push({
        symbol,
        date: series.date[t],
        compositeScore: gate.compositeScore,
        gatesPassed: gate.gatesPassed,
        tags: gate.tags,
        signalFlags,
        plannedHold: holdDays,
        verdict: verdictResult.verdict,
        confidence: verdictResult.confidence,
        downgradedFrom: verdictResult.downgradedFrom ?? null,
        ...sim,
      });
      openUntil[mode] = sim.exitIdx + 1;
    }
  }
  return out;
}

/**
 * Aggregate trade outcomes overall, bucketed by composite score (for threshold
 * calibration), and restricted to what the CURRENT live strategy actually BUYs
 * (`liveStrategy` — verdict === 'BUY' from the exact same decideVerdict() the scan
 * pipeline uses). `overall`/`byScoreBucket` deliberately span every Claude-eligible bar
 * (gates ≥ 5) regardless of score, so every possible threshold can be compared in one
 * pass; `liveStrategy` is the one number that answers "what would today's actual
 * pipeline have done" — the two are expected to differ, and that gap IS the score-
 * reachability picture (see byVerdict for the raw BUY/WAIT/SKIP split).
 *
 * @param {object[]} trades
 * @returns {object}
 */
function aggregate(trades) {
  const summarize = (list) => {
    if (!list.length) {
      return { trades: 0, winRate: 0, avgR: 0, avgRNet: 0, avgCost: 0, expectancy: 0, avgHold: 0 };
    }
    const wins = list.filter((t) => t.rMultiple > 0).length;
    const sumR = list.reduce((s, t) => s + t.rMultiple, 0);
    const sumCost = list.reduce((s, t) => s + (t.costInR ?? 0), 0);
    const sumHold = list.reduce((s, t) => s + (t.holdBars ?? 0), 0);
    return {
      trades: list.length,
      winRate: round2((wins / list.length) * 100),
      avgR: round2(sumR / list.length), // gross
      avgRNet: round2((sumR - sumCost) / list.length), // net of transaction costs
      avgCost: round2(sumCost / list.length),
      expectancy: round2((sumR - sumCost) / list.length),
      avgHold: round2(sumHold / list.length),
    };
  };
  const buckets = {
    '<50': trades.filter((t) => t.compositeScore < 50),
    '50-59': trades.filter((t) => t.compositeScore >= 50 && t.compositeScore < 60),
    '60-69': trades.filter((t) => t.compositeScore >= 60 && t.compositeScore < 70),
    '70+': trades.filter((t) => t.compositeScore >= 70),
  };
  const byReason = {};
  for (const reason of ['T2', 'TRAIL', 'SL', 'TIME']) {
    byReason[reason] = trades.filter((t) => t.reason === reason).length;
  }
  const byVerdict = {};
  for (const v of Object.values(VERDICTS)) {
    byVerdict[v] = trades.filter((t) => t.verdict === v).length;
  }
  return {
    overall: summarize(trades),
    liveStrategy: summarize(trades.filter((t) => t.verdict === VERDICTS.BUY)),
    byScoreBucket: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, summarize(v)])),
    byExitReason: byReason,
    byVerdict,
  };
}

/**
 * Split trades into N contiguous CALENDAR-time windows (not equal trade-count) spanning
 * the full date range, so each half genuinely represents a different stretch of history —
 * a busy sub-period can't dominate just because it produced more trades. This is the
 * backtest's answer to goLiveGate's "one hot fortnight is not evidence": aggregating a
 * score bucket over the WHOLE window can hide a threshold that only worked because of one
 * lucky stretch — splitting it exposes that instead of pooling it away.
 *
 * @param {object[]} trades - trades carrying a `date` (YYYY-MM-DD string)
 * @param {number} [n=2] - number of equal-length calendar windows
 * @returns {Array<{ label: string, from: string, to: string, trades: object[] }>}
 */
function splitByPeriod(trades, n = 2) {
  const dated = trades.filter((t) => t.date);
  if (!dated.length) return [];
  const sorted = [...dated].sort((a, b) => new Date(a.date) - new Date(b.date));
  const firstMs = new Date(sorted[0].date).getTime();
  const lastMs = new Date(sorted[sorted.length - 1].date).getTime();
  const span = Math.max(1, lastMs - firstMs);

  const windows = Array.from({ length: n }, (_, i) => ({
    label: `Period ${i + 1}`,
    fromMs: firstMs + (span * i) / n,
    toMs: firstMs + (span * (i + 1)) / n,
    trades: [],
  }));
  for (const t of sorted) {
    const ms = new Date(t.date).getTime();
    // Last window is inclusive on both ends; earlier windows exclude their right edge
    // so a trade lands in exactly one window.
    const idx = Math.min(n - 1, Math.floor(((ms - firstMs) / span) * n));
    windows[idx].trades.push(t);
  }
  return windows.map((w) => ({
    label: w.label,
    from: new Date(w.fromMs).toISOString().slice(0, 10),
    to: new Date(w.toMs).toISOString().slice(0, 10),
    trades: w.trades,
  }));
}

/**
 * Flag score buckets whose expectancy sign FLIPS between the first and second calendar
 * period — the signature of a threshold that was calibrated against one lucky/unlucky
 * stretch rather than a durable edge. Buckets with too few trades in either period to
 * mean anything are reported as insufficient rather than unstable (a sign flip on n=2
 * isn't evidence of instability, it's just noise).
 *
 * @param {object[]} periodAggregates - [{ label, byScoreBucket }, ...] from aggregate()
 * @param {number} [minSample=5] - minimum trades in EACH period for the flip to count
 * @returns {Array<{ bucket: string, status: 'FLIPPED'|'INSUFFICIENT', periods: object[] }>}
 */
function stabilityFlags(periodAggregates, minSample = 5) {
  if (periodAggregates.length < 2) return [];
  const bucketKeys = Object.keys(periodAggregates[0]?.byScoreBucket ?? {});
  const flags = [];
  for (const key of bucketKeys) {
    const perPeriod = periodAggregates.map((p) => ({
      label: p.label,
      trades: p.byScoreBucket[key]?.trades ?? 0,
      expectancy: p.byScoreBucket[key]?.expectancy ?? 0,
    }));
    const enough = perPeriod.every((p) => p.trades >= minSample);
    if (!enough) {
      if (perPeriod.some((p) => p.trades > 0)) {
        flags.push({ bucket: key, status: 'INSUFFICIENT', periods: perPeriod });
      }
      continue;
    }
    const signs = perPeriod.map((p) => Math.sign(p.expectancy));
    const flipped = signs.some((s) => s !== 0) && new Set(signs.filter((s) => s !== 0)).size > 1;
    if (flipped) flags.push({ bucket: key, status: 'FLIPPED', periods: perPeriod });
  }
  return flags;
}

/**
 * Cumulative equity curve (in R, net of transaction costs) over a trade list, sorted by
 * date — the thing a static win-rate/expectancy table can't show: whether the edge
 * builds up steadily or comes from one or two outsized trades, and how deep the
 * worst peak-to-trough drawdown ran. Same peak-tracking approach as goLiveGate's
 * capital drawdown, just in R units instead of ₹ since backtest has no fixed capital.
 *
 * @param {object[]} trades - trades carrying { date, rMultiple, costInR }
 * @returns {{ points: Array<{ date:string, cumR:number, cumRNet:number }>, maxDrawdownR: number }}
 */
function computeEquityCurve(trades) {
  const dated = trades.filter((t) => t.date).sort((a, b) => new Date(a.date) - new Date(b.date));
  let cumR = 0;
  let cumRNet = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  const points = dated.map((t) => {
    cumR += t.rMultiple ?? 0;
    cumRNet += (t.rMultiple ?? 0) - (t.costInR ?? 0);
    peak = Math.max(peak, cumRNet);
    maxDrawdownR = Math.max(maxDrawdownR, peak - cumRNet);
    return { date: t.date, cumR: round2(cumR), cumRNet: round2(cumRNet) };
  });
  return { points, maxDrawdownR: round2(maxDrawdownR) };
}

/**
 * Per-signal edge: for each signal flag, compare trades WHERE it fired against the rest.
 * `rLift` (avgR with − avgR without) is the marginal edge — positive means the signal
 * adds expectancy, negative means it's dilutive (dragging the composite down).
 *
 * @param {object[]} trades - trades carrying { rMultiple, signalFlags }
 * @param {number} [minSample=30] - flags below this trade count are flagged low-confidence
 * @returns {{ base: object, signals: object[] }}
 */
function aggregateSignalEdge(trades, minSample = 30) {
  const wr = (arr) => (arr.length ? round2((arr.filter((t) => t.rMultiple > 0).length / arr.length) * 100) : 0);
  const ar = (arr) => (arr.length ? round2(arr.reduce((s, t) => s + t.rMultiple, 0) / arr.length) : 0);
  const base = { n: trades.length, winRate: wr(trades), avgR: ar(trades) };

  const flags = new Set();
  for (const t of trades) for (const fl of t.signalFlags ?? []) flags.add(fl);

  const signals = [];
  for (const fl of flags) {
    const withF = trades.filter((t) => (t.signalFlags ?? []).includes(fl));
    const without = trades.filter((t) => !(t.signalFlags ?? []).includes(fl));
    if (!withF.length || !without.length) continue;
    signals.push({
      signal: fl,
      n: withF.length,
      winRate: wr(withF),
      avgR: ar(withF),
      avgRWithout: ar(without),
      rLift: round2(ar(withF) - ar(without)),
      winLift: round2(wr(withF) - wr(without)),
      enough: withF.length >= minSample,
    });
  }
  signals.sort((a, b) => b.rLift - a.rLift);
  return { base, signals };
}

/**
 * Run a backtest for ONE hold mode and return the per-signal edge breakdown.
 * Entries (and thus which signals fired) are mode-independent, but the R outcome
 * depends on exits, so we fix the hold mode to the live-like default ('adaptive').
 *
 * @param {string[]} symbols
 * @param {object} [opts] - { period, holdMode='adaptive', minSample, onProgress?(completed, total, symbol) }
 * @returns {Promise<{ symbols:number, period:string, holdMode:string, trades:number, base:object, signals:object[] }>}
 */
export const runSignalEdge = async (symbols, opts = {}) => {
  const period = opts.period ?? BACKTEST_PERIOD;
  const holdMode = opts.holdMode ?? 'adaptive';
  const [niftySeries, regimeMap] = await Promise.all([fetchNiftySeries(period), fetchRegimeMap()]);
  if (!niftySeries.dates.length) logger.warn('SignalEdge: no Nifty series — RS/Gate1 degraded');

  let completed = 0;
  const perSymbol = await mapWithConcurrency(symbols, BACKTEST_CONCURRENCY, async (symbol) => {
    try {
      const res = await backtestSymbol(symbol, niftySeries, { period, modes: [holdMode], regimeMap });
      return res[holdMode];
    } catch (err) {
      logger.error(`SignalEdge failed for ${symbol}`, { error: err.message });
      return [];
    } finally {
      completed += 1;
      opts.onProgress?.(completed, symbols.length, symbol);
    }
  });
  const all = perSymbol.flat();

  const edge = aggregateSignalEdge(all, opts.minSample);
  logger.info('Signal-edge complete', { symbols: symbols.length, holdMode, trades: all.length });
  return { symbols: symbols.length, period, holdMode, trades: all.length, ...edge };
};

/**
 * Collect the raw simulated trades (with signalFlags + rMultiple + costInR) for a symbol
 * set under one hold mode. Used by the champion/challenger harness, which re-scores the
 * SAME trades under different weightings — so the backtest runs once and any number of
 * weight configs can be compared post-hoc.
 *
 * @param {string[]} symbols
 * @param {object} [opts] - { period, holdMode }
 * @returns {Promise<object[]>}
 */
export const collectBacktestTrades = async (symbols, opts = {}) => {
  const period = opts.period ?? BACKTEST_PERIOD;
  const mode = opts.holdMode ?? 'adaptive';
  const [niftySeries, regimeMap] = await Promise.all([fetchNiftySeries(period), fetchRegimeMap()]);
  const perSymbol = await mapWithConcurrency(symbols, BACKTEST_CONCURRENCY, async (symbol) => {
    try {
      const res = await backtestSymbol(symbol, niftySeries, { period, modes: [mode], regimeMap });
      return res[mode];
    } catch (err) {
      logger.error(`collectBacktestTrades failed for ${symbol}`, { error: err.message });
      return [];
    }
  });
  return perSymbol.flat();
};

/**
 * Run a walk-forward backtest over the given symbols, comparing one or more hold-modes
 * in a single data pass (yfinance fetch is the bottleneck, so we fetch each symbol once).
 *
 * @param {string[]} symbols - NSE symbols to backtest
 * @param {object} [opts] - { period, modes: ('fixed'|'linear'|'adaptive')[], onProgress?(completed, total, symbol) }
 * @returns {Promise<{ symbols: number, period: string, modes: string[], results: Record<string, object> }>}
 */
export const runBacktest = async (symbols, opts = {}) => {
  const period = opts.period ?? BACKTEST_PERIOD;
  const modes = opts.modes ?? (opts.holdMode ? [opts.holdMode] : ['fixed']);
  const [niftySeries, regimeMap] = await Promise.all([fetchNiftySeries(period), fetchRegimeMap()]);
  if (!niftySeries.dates.length) logger.warn('Backtest: no Nifty series — RS/Gate1 degraded');

  const perMode = Object.fromEntries(modes.map((m) => [m, []]));
  let completed = 0;
  await mapWithConcurrency(symbols, BACKTEST_CONCURRENCY, async (symbol) => {
    try {
      const res = await backtestSymbol(symbol, niftySeries, { period, modes, regimeMap });
      for (const m of modes) perMode[m].push(...res[m]);
      return true;
    } catch (err) {
      logger.error(`Backtest failed for ${symbol}`, { error: err.message });
      return true; // still "handled" — don't let mapWithConcurrency's Boolean filter matter here
    } finally {
      completed += 1;
      opts.onProgress?.(completed, symbols.length, symbol);
    }
  });

  const results = {};
  for (const m of modes) {
    const periods = splitByPeriod(perMode[m], 2).map((p) => ({
      label: p.label,
      from: p.from,
      to: p.to,
      trades: p.trades.length,
      ...aggregate(p.trades),
    }));
    results[m] = {
      trades: perMode[m].length,
      ...aggregate(perMode[m]),
      sample: perMode[m].slice(0, 5),
      periods,
      stability: stabilityFlags(periods),
      equityCurve: computeEquityCurve(perMode[m]),
    };
  }
  logger.info('Backtest complete', {
    symbols: symbols.length,
    modes,
    overall: Object.fromEntries(modes.map((m) => [m, results[m].overall])),
    unstableBuckets: Object.fromEntries(
      modes.map((m) => [m, results[m].stability.filter((s) => s.status === 'FLIPPED').map((s) => s.bucket)])
    ),
  });
  return { symbols: symbols.length, period, modes, results };
};

/**
 * Single-setup backtest for analysis reports
 * Replays explicit entry/SL/T1/T2 levels on past 2y of data
 * @param {string} symbol
 * @param {number} entry
 * @param {number} stopLoss
 * @param {number} target1
 * @param {number} target2
 * @returns {Promise<Object>} backtest stats
 */
export const backtestSetup = async (symbol, entry, stopLoss, target1, target2) => {
  try {
    const period = '2y';
    const data = await fetchIndicatorSeries(symbol, period);
    if (!data?.series?.date?.length) {
      logger.warn(`Backtest setup: no data for ${symbol}`);
      return null;
    }

    const series = data.series;
    const risk = entry - stopLoss;
    if (risk <= 0) {
      logger.warn(`Invalid entry/SL for backtest: ${symbol}`, { entry, stopLoss });
      return null;
    }

    // Realism model — shared with the research engine (simulateTrade): an entry triggers
    // when price trades through the entry level on bar i, the fill is the NEXT bar's open
    // (no intrabar look-ahead), then half is booked at T1 + the stop trails to entry, then
    // (when ATR data is available) the ATR trail REPLACES the hard T2 close exactly like
    // live trading — the remaining half rides until the trail or a stop is hit, not merely
    // because price touched T2. The stop fills first on a bar that straddles both target
    // and stop (worst case). R is measured against the ACTUAL fill, so entry gaps/slippage
    // are captured.
    const trades = [];
    const MAX_HOLD = 15; // bars — the time-stop the report references
    const n = series.close.length;
    let seq = 0;
    let i = 0;

    while (i < n - 1) {
      const lo = series.low[i];
      const hi = series.high[i];
      if (lo != null && hi != null && lo <= entry && hi >= entry) {
        // Per-entry ATR (varies with i) drives the trailing stop for this specific trade.
        const levels = { entry, sl: stopLoss, t1: target1, t2: target2, risk, atr: series.atr14[i] ?? null };
        const sim = simulateTrade(series, i, levels, MAX_HOLD);
        if (!sim) break; // no next bar to fill the entry on
        // Map the engine's reasons onto the report's {T1,T2,SL,TIMEOUT} taxonomy. TRAIL now
        // means "T1 booked, then the ATR-trailed remainder closed" — no longer always at
        // breakeven, so it's still classified as a T1-reaching trade but priced at the
        // REAL trail-stop fill (sim.exitPrice), not assumed to be target1's price.
        const exitType =
          sim.reason === 'SL'
            ? 'SL'
            : sim.reason === 'T2'
              ? 'T2'
              : sim.reason === 'TRAIL'
                ? 'T1'
                : 'TIMEOUT';
        seq += 1;
        trades.push({
          sequenceNo: seq,
          entryDate: series.date[i + 1] ?? series.date[i],
          entryPrice: round2(sim.entry),
          exitDate: series.date[sim.exitIdx],
          exitPrice: round2(sim.exitPrice),
          exitType,
          realizedR: sim.rMultiple,
          holdingDays: sim.holdBars,
          barsSincEntry: sim.holdBars,
        });
        i = sim.exitIdx + 1; // no overlapping trades — resume after this one closes
      } else {
        i += 1;
      }
    }

    // Calculate stats
    if (trades.length === 0) {
      return {
        symbol,
        entry,
        stopLoss,
        target1,
        target2,
        tradesSimulated: 0,
        winRate: 0,
        winRateT1: 0,
        winRateT2: 0,
        avgRealizedRR: 0,
        avgHoldingDays: 0,
        performanceAssessment: 'NO_TRADES',
      };
    }

    const winsT1 = trades.filter((t) => t.exitType === 'T1').length;
    const winsT2 = trades.filter((t) => t.exitType === 'T2').length;
    const losses = trades.filter((t) => t.exitType === 'SL').length;
    const totalWins = winsT1 + winsT2;
    const total = trades.length;

    const winRate = round2((totalWins / total) * 100);
    const winRateT1 = round2((winsT1 / total) * 100);
    const winRateT2 = round2((winsT2 / total) * 100);

    const avgR = round2(trades.reduce((s, t) => s + t.realizedR, 0) / total);
    const avgHold = round2(trades.reduce((s, t) => s + t.holdingDays, 0) / total);

    const largestWin = Math.max(...trades.map((t) => t.realizedR));
    const largestLoss = Math.min(...trades.map((t) => t.realizedR));

    let assessment = 'INSUFFICIENT_DATA';
    if (total >= 5) {
      if (winRate >= 60) assessment = 'EXCELLENT';
      else if (winRate >= 55) assessment = 'GOOD';
      else if (winRate >= 50) assessment = 'DECENT';
      else assessment = 'POOR';
    }

    const result = {
      symbol,
      entry,
      stopLoss,
      target1,
      target2,
      tradesSimulated: total,
      winsAtT1: winsT1,
      winsAtT2: winsT2,
      losses,
      winRate,
      winRateT1,
      winRateT2,
      avgRealizedRR: avgR,
      avgHoldingDays: avgHold,
      largestWin: round2(largestWin),
      largestLoss: round2(largestLoss),
      maxConsecutiveWins: calculateConsecutiveWins(trades),
      performanceAssessment: assessment,
      trades: trades.slice(-20), // keep last 20 trades for detail
    };

    return result;
  } catch (err) {
    logger.error('Backtest setup failed', { symbol, entry, stopLoss, error: err.message });
    return null;
  }
};

/**
 * Calculate max consecutive wins from trades
 */
function calculateConsecutiveWins(trades) {
  let maxWins = 0;
  let currentWins = 0;
  for (const trade of trades) {
    if (trade.exitType === 'SL') {
      maxWins = Math.max(maxWins, currentWins);
      currentWins = 0;
    } else {
      currentWins++;
    }
  }
  return Math.max(maxWins, currentWins);
}
