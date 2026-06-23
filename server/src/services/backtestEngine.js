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
  BACKTEST_HOLD_DAYS,
  BACKTEST_PERIOD,
  BACKTEST_SL_ATR_MULT,
  BACKTEST_WARMUP_BARS,
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
  };
}

/**
 * Reconstruct the enriched stock state as-of bar t (indicators + Simons enrichment).
 * @param {string} symbol
 * @param {object} series
 * @param {number} t
 * @param {Array<number|null>} niftyAligned
 * @returns {{ stockData: object, levels: object }}
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
  return { stockData, levels };
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
 * @returns {{ entry:number, exitIdx:number, reason:string, rMultiple:number }|null}
 */
function simulateTrade(series, signalIdx, levels) {
  const entryIdx = signalIdx + 1;
  const n = series.close.length;
  if (entryIdx >= n) return null;
  const entry = series.open[entryIdx];
  if (entry == null) return null;
  const { sl, t1, t2, risk } = levels;
  const last = Math.min(entryIdx + BACKTEST_HOLD_DAYS, n - 1);
  const R = (price) => round2((price - entry) / risk);

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
      };
    }
    if (firstHalfR == null && hi != null && hi >= t1) {
      firstHalfR = R(t1); // book half at T1, trail stop to entry for the rest
      stop = entry;
      continue;
    }
    if (firstHalfR != null && hi != null && hi >= t2) {
      return { entry, exitIdx: k, reason: 'T2', rMultiple: round2((firstHalfR + R(t2)) / 2) };
    }
  }
  const exitR = R(series.close[last]);
  const r = firstHalfR == null ? exitR : (firstHalfR + exitR) / 2;
  return { entry, exitIdx: last, reason: 'TIME', rMultiple: round2(r) };
}

/**
 * Backtest one symbol: returns the list of simulated trades (Claude-eligible bars).
 * @param {string} symbol
 * @param {{ dates: string[], closes: number[] }} niftySeries
 * @param {object} opts - { period }
 * @returns {Promise<object[]>}
 */
async function backtestSymbol(symbol, niftySeries, opts) {
  const data = await fetchIndicatorSeries(symbol, opts.period);
  if (!data?.series?.date?.length) {
    logger.warn(`Backtest: no data for ${symbol}`);
    return [];
  }
  const series = data.series;
  const niftyAligned = alignByDate(series.date, niftySeries.dates, niftySeries.closes);
  const niftyEma20 = ema(niftyAligned, 20);
  const n = series.date.length;
  const trades = [];
  let openUntil = 0;

  for (let t = BACKTEST_WARMUP_BARS; t < n - 1; t += 1) {
    if (t < openUntil || series.ema200[t] == null) continue;
    const { stockData, levels } = buildStockAsOf(symbol, series, t, niftyAligned);
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

    const sim = simulateTrade(series, t, levels);
    if (!sim) continue;
    trades.push({
      symbol,
      date: series.date[t],
      compositeScore: gate.compositeScore,
      gatesPassed: gate.gatesPassed,
      tags: gate.tags,
      ...sim,
    });
    openUntil = sim.exitIdx + 1;
  }
  return trades;
}

/**
 * Aggregate trade outcomes overall and bucketed by composite score (for threshold calibration).
 * @param {object[]} trades
 * @returns {object}
 */
function aggregate(trades) {
  const summarize = (list) => {
    if (!list.length) return { trades: 0, winRate: 0, avgR: 0, expectancy: 0 };
    const wins = list.filter((t) => t.rMultiple > 0).length;
    const sumR = list.reduce((s, t) => s + t.rMultiple, 0);
    return {
      trades: list.length,
      winRate: round2((wins / list.length) * 100),
      avgR: round2(sumR / list.length),
      expectancy: round2(sumR / list.length),
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
 * Run a walk-forward backtest over the given symbols.
 *
 * @param {string[]} symbols - NSE symbols to backtest
 * @param {object} [opts] - { period }
 * @returns {Promise<{ symbols: number, trades: number, overall: object, byScoreBucket: object, sample: object[] }>}
 */
export const runBacktest = async (symbols, opts = {}) => {
  const period = opts.period ?? BACKTEST_PERIOD;
  const niftySeries = await fetchNiftySeries(period);
  if (!niftySeries.dates.length) logger.warn('Backtest: no Nifty series — RS/Gate1 degraded');

  const all = [];
  for (const symbol of symbols) {
    try {
      all.push(...(await backtestSymbol(symbol, niftySeries, { period })));
    } catch (err) {
      logger.error(`Backtest failed for ${symbol}`, { error: err.message });
    }
  }

  const agg = aggregate(all);
  logger.info('Backtest complete', {
    symbols: symbols.length,
    trades: all.length,
    overall: agg.overall,
  });
  return {
    symbols: symbols.length,
    trades: all.length,
    period,
    ...agg,
    sample: all.slice(0, 10),
  };
};
