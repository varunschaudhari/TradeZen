/**
 * @file backtestEngine.js
 * @description Walk-forward backtester. For each historical day it reconstructs the
 *              as-of-day stock state from per-bar indicator series (Python), runs the
 *              EXACT live scorers (calculateSimonsSignals + runAllGates), and for every
 *              Claude-eligible bar (gates ≥ 5, no hard block) simulates a trade on the
 *              suggested SL/targets. Aggregates win rate / expectancy and — the key
 *              output — win rate by composite-score bucket, so the BUY threshold can be
 *              calibrated against history.
 *
 * Honest limitations (documented so results aren't over-trusted):
 *  - BUY proxy = "Claude-eligible" (we can't run Claude over thousands of bars); the
 *    score buckets show what each threshold would have yielded.
 *  - Gate 8 (news) and Gate 3 (earnings) can't be replayed historically → assumed pass.
 *  - FII/sector/P-C weren't recorded historically → those composite signals are absent
 *    (so backtest scores reflect price-derived signals only — the honest historical view).
 *  - Weekly trend is approximated from the daily EMA50.
 *
 * @author TradeZen Team
 * @created 2026-06-21
 */

import {
  BACKTEST_ENTRY_EMA20_BAND,
  BACKTEST_HOLD_BUFFER,
  BACKTEST_HOLD_DAYS,
  BACKTEST_HOLD_MAX_DAYS,
  BACKTEST_HOLD_MIN_DAYS,
  BACKTEST_PERIOD,
  BACKTEST_SL_ATR_MULT,
  BACKTEST_WARMUP_BARS,
  BB_OVERBOUGHT,
  PROXIMITY_52W_HIGH_PCT,
  RSI_MAX,
  RSI_MIN,
  SIMONS_POINTS,
} from '../config/constants.js';
import { logger } from '../config/logger.js';
import { fetchIndicatorSeries, fetchNiftySeries } from './pythonBridge.js';
import { calculateSimonsSignals } from './simonsSignals.js';
import { runAllGates } from './gateChecker.js';

const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

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
 * Suggested entry/SL/targets as-of bar t — mirrors Python _compute_trade_levels.
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
  const recentLows = series.low
    .slice(Math.max(0, t - 19), t + 1)
    .filter((l) => l != null && l < entry);
  let sl = recentLows.length
    ? Math.max(...recentLows)
    : atr != null
      ? entry - atr * BACKTEST_SL_ATR_MULT
      : entry * 0.97;
  if (sl >= entry) sl = entry * 0.97;

  // Floor the stop distance so targets aren't trivially close (the v1 inflation bug):
  // a swing low just under entry made risk tiny → entry+2R/3R got hit automatically.
  const minRisk = Math.max(atr != null ? atr : 0, entry * 0.03);
  let risk = entry - sl;
  if (risk < minRisk) {
    risk = minRisk;
    sl = entry - risk;
  }
  return {
    entry: round2(entry),
    sl: round2(sl),
    t1: round2(entry + 2 * risk),
    t2: round2(entry + 3 * risk),
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
 * the stop to entry for the remainder (mirrors the live trade plan). On a bar that
 * straddles both stop and target, assume the STOP fills first (worst case). R is measured
 * in planned-risk units against the actual entry fill (captures entry slippage).
 *
 * @param {object} series - Indicator series (needs open/high/low/close)
 * @param {number} signalIdx - Bar the signal fired on (entry is signalIdx + 1)
 * @param {object} levels - { sl, t1, t2, risk }
 * @param {number} holdDays - max bars to hold before a time exit (from holdWindowDays)
 * @returns {{ entry:number, exitIdx:number, reason:string, rMultiple:number, holdBars:number }|null}
 */
function simulateTrade(series, signalIdx, levels, holdDays) {
  const entryIdx = signalIdx + 1;
  const n = series.close.length;
  if (entryIdx >= n) return null;
  const entry = series.open[entryIdx];
  if (entry == null) return null;
  const { sl, t1, t2, risk } = levels;
  const last = Math.min(entryIdx + holdDays, n - 1);
  const R = (price) => round2((price - entry) / risk);
  const held = (exitIdx) => exitIdx - entryIdx + 1;

  let firstHalfR = null; // null until T1 books the first half
  let stop = sl;
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
        reason: firstHalfR == null ? 'SL' : 'TRAIL',
        rMultiple: round2(r),
        holdBars: held(k),
      };
    }
    if (firstHalfR == null && hi != null && hi >= t1) {
      firstHalfR = R(t1); // book half at T1, trail stop to entry for the rest
      stop = entry;
      continue;
    }
    if (firstHalfR != null && hi != null && hi >= t2) {
      return {
        entry,
        exitIdx: k,
        reason: 'T2',
        rMultiple: round2((firstHalfR + R(t2)) / 2),
        holdBars: held(k),
      };
    }
  }
  const exitR = R(series.close[last]);
  const r = firstHalfR == null ? exitR : (firstHalfR + exitR) / 2;
  return { entry, exitIdx: last, reason: 'TIME', rMultiple: round2(r), holdBars: held(last) };
}

/**
 * Backtest one symbol across one or more hold-modes in a SINGLE data pass.
 * The signal (gates + composite) is mode-independent, so it's computed once per bar and
 * only the exit simulation re-runs per mode. Each mode keeps its own no-overlap cursor,
 * so the three modes produce independent (and fairly comparable) trade streams.
 *
 * @param {string} symbol
 * @param {{ dates: string[], closes: number[] }} niftySeries
 * @param {object} opts - { period, modes: string[] }
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
    const market = {
      nifty50: {
        price: niftyAligned[t],
        ema20: niftyEma20[t],
        aboveEma20: niftyAligned[t] > niftyEma20[t],
      },
      vix: null,
      adRatio: null,
      fiiTrend: 'NEUTRAL',
      pcRatio: null,
    };
    const gate = runAllGates(stockData, market, { sentiment: 'NEUTRAL', headlines: [] });
    if (!gate.shouldCallClaude || levels.entry <= levels.sl) continue;

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
        ...sim,
      });
      openUntil[mode] = sim.exitIdx + 1;
    }
  }
  return out;
}

/**
 * Aggregate trade outcomes overall and bucketed by composite score (for threshold calibration).
 * @param {object[]} trades
 * @returns {object}
 */
function aggregate(trades) {
  const summarize = (list) => {
    if (!list.length) return { trades: 0, winRate: 0, avgR: 0, expectancy: 0, avgHold: 0 };
    const wins = list.filter((t) => t.rMultiple > 0).length;
    const sumR = list.reduce((s, t) => s + t.rMultiple, 0);
    const sumHold = list.reduce((s, t) => s + (t.holdBars ?? 0), 0);
    return {
      trades: list.length,
      winRate: round2((wins / list.length) * 100),
      avgR: round2(sumR / list.length),
      expectancy: round2(sumR / list.length),
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
  return {
    overall: summarize(trades),
    byScoreBucket: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, summarize(v)])),
    byExitReason: byReason,
  };
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
 * @param {object} [opts] - { period, holdMode='adaptive', minSample }
 * @returns {Promise<{ symbols:number, period:string, holdMode:string, trades:number, base:object, signals:object[] }>}
 */
export const runSignalEdge = async (symbols, opts = {}) => {
  const period = opts.period ?? BACKTEST_PERIOD;
  const holdMode = opts.holdMode ?? 'adaptive';
  const niftySeries = await fetchNiftySeries(period);
  if (!niftySeries.dates.length) logger.warn('SignalEdge: no Nifty series — RS/Gate1 degraded');

  const all = [];
  for (const symbol of symbols) {
    try {
      const res = await backtestSymbol(symbol, niftySeries, { period, modes: [holdMode] });
      all.push(...res[holdMode]);
    } catch (err) {
      logger.error(`SignalEdge failed for ${symbol}`, { error: err.message });
    }
  }

  const edge = aggregateSignalEdge(all, opts.minSample);
  logger.info('Signal-edge complete', { symbols: symbols.length, holdMode, trades: all.length });
  return { symbols: symbols.length, period, holdMode, trades: all.length, ...edge };
};

/**
 * Run a walk-forward backtest over the given symbols, comparing one or more hold-modes
 * in a single data pass (yfinance fetch is the bottleneck, so we fetch each symbol once).
 *
 * @param {string[]} symbols - NSE symbols to backtest
 * @param {object} [opts] - { period, modes: ('fixed'|'linear'|'adaptive')[] }
 * @returns {Promise<{ symbols: number, period: string, modes: string[], results: Record<string, object> }>}
 */
export const runBacktest = async (symbols, opts = {}) => {
  const period = opts.period ?? BACKTEST_PERIOD;
  const modes = opts.modes ?? (opts.holdMode ? [opts.holdMode] : ['fixed']);
  const niftySeries = await fetchNiftySeries(period);
  if (!niftySeries.dates.length) logger.warn('Backtest: no Nifty series — RS/Gate1 degraded');

  const perMode = Object.fromEntries(modes.map((m) => [m, []]));
  for (const symbol of symbols) {
    try {
      const res = await backtestSymbol(symbol, niftySeries, { period, modes });
      for (const m of modes) perMode[m].push(...res[m]);
    } catch (err) {
      logger.error(`Backtest failed for ${symbol}`, { error: err.message });
    }
  }

  const results = {};
  for (const m of modes) {
    results[m] = { trades: perMode[m].length, ...aggregate(perMode[m]), sample: perMode[m].slice(0, 5) };
  }
  logger.info('Backtest complete', {
    symbols: symbols.length,
    modes,
    overall: Object.fromEntries(modes.map((m) => [m, results[m].overall])),
  });
  return { symbols: symbols.length, period, modes, results };
};
