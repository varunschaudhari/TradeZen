/**
 * @file simonsSignals.js
 * @description Flow 5 — Simons signal calculators. Signals 1–5 and 10 are derived
 *              purely from price/volume/indicator data; signals 6–9 (PEAD, sector,
 *              FII, P/C) live in simonsExternal.js and accept injected data. The
 *              aggregator calculateSimonsSignals() runs all ten and returns the
 *              enrichment fields consumed by gateChecker.calculateCompositeScore
 *              (the canonical scorer) plus a per-signal breakdown for the Claude prompt.
 * @author TradeZen Team
 * @created 2026-06-20
 * @lastModified 2026-06-20
 */

import {
  ATR_PCT_MEAN_REVERSION_MIN,
  BB_MEAN_REVERSION,
  BULLISH_CANDLE_PATTERNS,
  GAP_MIN_PCT,
  GAP_PROXIMITY_PCT,
  LOOKBACK_1M,
  LOOKBACK_3M,
  LOOKBACK_6M,
  LOOKBACK_RS_LONG,
  LOOKBACK_RS_SHORT,
  MOMENTUM_6M_GOOD,
  MOMENTUM_6M_MIN,
  MOMENTUM_6M_STRONG,
  PROXIMITY_52W_MOMENTUM_PCT,
  RS_INLINE,
  RS_LAGGARD,
  RS_LEADER,
  RS_STRONG_LEADER,
  RSI_52W_MOMENTUM_MAX,
  RSI_52W_MOMENTUM_MIN,
  RSI_MEAN_REVERSION,
  SIMONS_POINTS,
  VOLUME_ANOMALY_ELEVATED,
  VOLUME_ANOMALY_MODERATE,
  VOLUME_ANOMALY_THRESHOLD,
} from '../config/constants.js';
import { logger } from '../config/logger.js';
import { fetchOhlcv } from './pythonBridge.js';
import {
  detectPEAD,
  detectSectorMomentum,
  evaluateFIIFlow,
  evaluatePutCallRatio,
} from './simonsExternal.js';

const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

/**
 * Percentage return over `lookback` bars (oldest→newest closes).
 *
 * @param {number[]} closes - Daily closing prices
 * @param {number} lookback - Number of bars to look back
 * @returns {number|null} Percent return, or null when history is insufficient
 */
function periodReturn(closes, lookback) {
  if (!Array.isArray(closes) || closes.length <= lookback) return null;
  const past = closes[closes.length - 1 - lookback];
  const last = closes[closes.length - 1];
  if (!past) return null;
  return ((last - past) / past) * 100;
}

/**
 * SIGNAL 1 — Mean reversion detector (oversold within an intact uptrend).
 *
 * @param {object} indicators - { rsi14, bbPctB, ema200, atr14 }
 * @param {number} price - Current price (for ATR%)
 * @returns {{ active: boolean, strength: string, score: number, tag: string|null }}
 */
export function detectMeanReversion(indicators, price) {
  const { rsi14, bbPctB, ema200, atr14 } = indicators ?? {};
  if (rsi14 == null || bbPctB == null || ema200 == null || price == null) {
    return { active: false, strength: 'NONE', score: 0, tag: null };
  }
  const core = rsi14 < RSI_MEAN_REVERSION && bbPctB < BB_MEAN_REVERSION && price > ema200;
  if (!core) return { active: false, strength: 'NONE', score: 0, tag: null };
  const atrPct = atr14 != null && price > 0 ? (atr14 / price) * 100 : 0;
  if (atrPct > ATR_PCT_MEAN_REVERSION_MIN) {
    return {
      active: true,
      strength: 'STRONG',
      score: SIMONS_POINTS.MEAN_REVERSION_STRONG,
      tag: 'MEAN_REVERSION',
    };
  }
  return {
    active: true,
    strength: 'MODERATE',
    score: SIMONS_POINTS.MEAN_REVERSION_MODERATE,
    tag: 'MEAN_REVERSION',
  };
}

/**
 * SIGNAL 2 — Momentum score (6/3/1-month), scored on the 6-month figure.
 *
 * @param {number[]} closes - Daily closing prices (oldest→newest)
 * @returns {{ momentum6m: number|null, momentum3m: number|null, momentum1m: number|null, score: number }}
 */
export function calculateMomentumScore(closes) {
  const momentum6m = periodReturn(closes, LOOKBACK_6M);
  const momentum3m = periodReturn(closes, LOOKBACK_3M);
  const momentum1m = periodReturn(closes, LOOKBACK_1M);
  let score = 0;
  if (momentum6m != null) {
    if (momentum6m > MOMENTUM_6M_STRONG) score = SIMONS_POINTS.MOMENTUM_STRONG;
    else if (momentum6m > MOMENTUM_6M_GOOD) score = SIMONS_POINTS.MOMENTUM_GOOD;
    else if (momentum6m > MOMENTUM_6M_MIN) score = SIMONS_POINTS.MOMENTUM_OK;
    else if (momentum6m < 0) score = SIMONS_POINTS.MOMENTUM_NEG;
  }
  return {
    momentum6m: round2(momentum6m),
    momentum3m: round2(momentum3m),
    momentum1m: round2(momentum1m),
    score,
  };
}

/**
 * SIGNAL 3 — Relative strength vs Nifty (stock return ÷ Nifty return).
 *
 * @param {number[]} stockCloses - Stock daily closes
 * @param {number[]} niftyCloses - Nifty 50 daily closes
 * @returns {{ rs20d: number|null, rs60d: number|null, category: string, score: number }}
 */
export function calculateRelativeStrength(stockCloses, niftyCloses) {
  const ratio = (lookback) => {
    const sr = periodReturn(stockCloses, lookback);
    const nr = periodReturn(niftyCloses, lookback);
    return sr != null && nr != null && nr !== 0 ? sr / nr : null;
  };
  const rs20d = ratio(LOOKBACK_RS_SHORT);
  const rs60d = ratio(LOOKBACK_RS_LONG);
  let category = 'UNKNOWN';
  let score = 0;
  if (rs20d != null) {
    if (rs20d >= RS_STRONG_LEADER)
      [category, score] = ['STRONG_LEADER', SIMONS_POINTS.RS_STRONG_LEADER];
    else if (rs20d >= RS_INLINE) [category, score] = ['LEADER', SIMONS_POINTS.RS_LEADER];
    else if (rs20d >= RS_LAGGARD) [category, score] = ['IN_LINE', 0];
    else [category, score] = ['LAGGARD', SIMONS_POINTS.RS_LAGGARD];
  }
  return { rs20d: round2(rs20d), rs60d: round2(rs60d), category, score };
}

/**
 * SIGNAL 4 — Volume anomaly (3-day cumulative vs 3× the 20-day average).
 *
 * @param {number[]} volumes - Daily volumes (oldest→newest)
 * @param {boolean} isBullishCandle - Whether the latest candle is bullish
 * @returns {{ anomalyRatio: number|null, classification: string, score: number, anomaly: boolean, institutionalAccumulation: boolean, tag: string|null }}
 */
export function detectVolumeAnomaly(volumes, isBullishCandle = false) {
  if (!Array.isArray(volumes) || volumes.length < 20) {
    return {
      anomalyRatio: null,
      classification: 'UNKNOWN',
      score: 0,
      anomaly: false,
      institutionalAccumulation: false,
      tag: null,
    };
  }
  const last20 = volumes.slice(-20);
  const avg20 = last20.reduce((s, v) => s + v, 0) / 20;
  const cum3 = volumes.slice(-3).reduce((s, v) => s + v, 0);
  const ratio = avg20 > 0 ? cum3 / (avg20 * 3) : 0;
  let classification = 'NORMAL';
  let score = 0;
  if (ratio > VOLUME_ANOMALY_THRESHOLD)
    [classification, score] = ['HIGH_ANOMALY', SIMONS_POINTS.VOL_HIGH];
  else if (ratio > VOLUME_ANOMALY_MODERATE)
    [classification, score] = ['MODERATE_ANOMALY', SIMONS_POINTS.VOL_MODERATE];
  else if (ratio > VOLUME_ANOMALY_ELEVATED)
    [classification, score] = ['ELEVATED', SIMONS_POINTS.VOL_ELEVATED];
  const anomaly = ratio > VOLUME_ANOMALY_THRESHOLD;
  return {
    anomalyRatio: round2(ratio),
    classification,
    score,
    anomaly,
    institutionalAccumulation: anomaly && isBullishCandle,
    tag: anomaly ? 'VOLUME_ANOMALY' : null,
  };
}

/**
 * SIGNAL 5 — 52-week-high momentum (breakout proximity, not overbought).
 *
 * @param {number} price - Current price
 * @param {number} high52w - 52-week high
 * @param {number} rsi - RSI 14
 * @param {number} ema20 - EMA 20
 * @returns {{ proximity52wHigh: number|null, is52WMomentum: boolean, score: number, tag: string|null }}
 */
export function check52WHighMomentum(price, high52w, rsi, ema20) {
  if (!high52w || !price) {
    return { proximity52wHigh: null, is52WMomentum: false, score: 0, tag: null };
  }
  const proximity = ((high52w - price) / high52w) * 100;
  const is52WMomentum =
    proximity < PROXIMITY_52W_MOMENTUM_PCT &&
    rsi != null &&
    rsi >= RSI_52W_MOMENTUM_MIN &&
    rsi <= RSI_52W_MOMENTUM_MAX &&
    (ema20 == null || price > ema20);
  return {
    proximity52wHigh: round2(proximity),
    is52WMomentum,
    score: is52WMomentum ? SIMONS_POINTS.FIFTYTWO_W : 0,
    tag: is52WMomentum ? 'FIFTYTWO_WEEK_MOMENTUM' : null,
  };
}

/**
 * Detect raw price gaps that exceed GAP_MIN_PCT (helper for findUnfilledGaps).
 *
 * @param {number[]} highs - Daily highs (oldest→newest)
 * @param {number[]} lows - Daily lows (oldest→newest)
 * @returns {Array<{ type: string, low: number, high: number, sizePct: number, index: number }>}
 */
function detectRawGaps(highs, lows) {
  const gaps = [];
  for (let i = 1; i < highs.length; i += 1) {
    let gap = null;
    if (lows[i] > highs[i - 1]) gap = { type: 'UP', low: highs[i - 1], high: lows[i], index: i };
    else if (highs[i] < lows[i - 1])
      gap = { type: 'DOWN', low: highs[i], high: lows[i - 1], index: i };
    if (!gap) continue;
    const mid = (gap.high + gap.low) / 2;
    const sizePct = mid > 0 ? ((gap.high - gap.low) / mid) * 100 : 0;
    if (sizePct > GAP_MIN_PCT) gaps.push({ ...gap, sizePct: round2(sizePct) });
  }
  return gaps;
}

/**
 * SIGNAL 10 — Unfilled gap analysis near the current price.
 *
 * Up gaps still above price act as resistance/targets; down gaps below price act as
 * support/stop zones. "Unfilled" = price has not traded back through the gap zone.
 *
 * @param {number[]} highs - Daily highs (oldest→newest)
 * @param {number[]} lows - Daily lows (oldest→newest)
 * @param {number} currentPrice - Latest price
 * @returns {{ upGaps: object[], downGaps: object[], nearestGap: object|null }}
 */
export function findUnfilledGaps(highs, lows, currentPrice) {
  if (!Array.isArray(highs) || !Array.isArray(lows) || !currentPrice) {
    return { upGaps: [], downGaps: [], nearestGap: null };
  }
  const upGaps = [];
  const downGaps = [];
  for (const gap of detectRawGaps(highs, lows)) {
    const laterLows = lows.slice(gap.index + 1);
    const laterHighs = highs.slice(gap.index + 1);
    const filled =
      gap.type === 'UP'
        ? laterLows.some((low) => low <= gap.low)
        : laterHighs.some((high) => high >= gap.high);
    if (filled) continue;
    const distPct = (Math.abs(currentPrice - (gap.high + gap.low) / 2) / currentPrice) * 100;
    if (distPct > GAP_PROXIMITY_PCT) continue;
    const entry = { ...gap, distancePct: round2(distPct) };
    if (gap.low >= currentPrice) upGaps.push(entry);
    else if (gap.high <= currentPrice) downGaps.push(entry);
  }
  const all = [...upGaps, ...downGaps].sort((a, b) => a.distancePct - b.distancePct);
  return { upGaps, downGaps, nearestGap: all[0] ?? null };
}

/**
 * Fetch a symbol's 1-year daily OHLCV from the Python service as flat arrays.
 *
 * @param {string} symbol - Bare NSE symbol (e.g. 'RELIANCE')
 * @returns {Promise<{ closes: number[], highs: number[], lows: number[], volumes: number[] }|null>}
 */
export const fetchSymbolHistory = async (symbol) => {
  try {
    const res = await fetchOhlcv(symbol, '1y', '1d');
    const bars = res?.data ?? [];
    if (!bars.length) return null;
    return {
      closes: bars.map((b) => b.close),
      highs: bars.map((b) => b.high),
      lows: bars.map((b) => b.low),
      volumes: bars.map((b) => b.volume),
    };
  } catch (err) {
    logger.error('fetchSymbolHistory failed', { symbol, error: err.message });
    return null;
  }
};

/**
 * Run all 10 Simons signals and assemble the enrichment + breakdown payload.
 *
 * The returned `enrichment` object is meant to be merged into stockData/marketData so
 * gateChecker.calculateCompositeScore (the canonical scorer) can read it. `signals`
 * holds each detector's raw output and `scoreContribution` is the informational sum.
 *
 * @param {object} input - {
 *   indicators, currentPrice, high52w,
 *   closes, highs, lows, volumes, niftyCloses,
 *   external: { earningsHistory, sectorRanking, stockSector, fiiData, pcRatio }
 * }
 * @returns {{ signals: object, tags: string[], scoreContribution: number, enrichment: object }}
 */
export const calculateSimonsSignals = (input = {}) => {
  const {
    indicators = {},
    currentPrice,
    high52w,
    closes,
    highs,
    lows,
    volumes,
    niftyCloses,
  } = input;
  const ext = input.external ?? {};
  const isBullishCandle = BULLISH_CANDLE_PATTERNS.includes(indicators.candlePattern);

  const meanReversion = detectMeanReversion(indicators, currentPrice);
  const momentum = calculateMomentumScore(closes);
  const relativeStrength = calculateRelativeStrength(closes, niftyCloses);
  const volumeAnomaly = detectVolumeAnomaly(volumes, isBullishCandle);
  const fiftyTwoWeekHigh = check52WHighMomentum(
    currentPrice,
    high52w,
    indicators.rsi14,
    indicators.ema20
  );
  const gaps = findUnfilledGaps(highs, lows, currentPrice);
  const pead = detectPEAD(ext.earningsHistory);
  const sector = detectSectorMomentum(ext.sectorRanking, ext.stockSector);
  const fii = evaluateFIIFlow(ext.fiiData);
  const putCall = evaluatePutCallRatio(ext.pcRatio);

  const signals = {
    meanReversion,
    momentum,
    relativeStrength,
    volumeAnomaly,
    fiftyTwoWeekHigh,
    gaps,
    pead,
    sector,
    fii,
    putCall,
  };
  const scored = [
    meanReversion,
    momentum,
    relativeStrength,
    volumeAnomaly,
    fiftyTwoWeekHigh,
    pead,
    sector,
    fii,
    putCall,
  ];
  const scoreContribution = scored.reduce((sum, s) => sum + (s.score ?? 0), 0);
  const tags = [meanReversion, volumeAnomaly, fiftyTwoWeekHigh, pead, sector, fii, putCall]
    .map((s) => s.tag)
    .filter(Boolean);

  const enrichment = {
    relativeStrength: relativeStrength.rs20d,
    volumeAnomaly: volumeAnomaly.anomaly,
    peadSetup: pead.active,
    sectorTailwind: sector.tailwind === true,
    sectorHeadwind: sector.headwind === true,
    momentum6m: momentum.momentum6m,
    proximity52wHigh: fiftyTwoWeekHigh.proximity52wHigh,
    institutionalAccumulation: volumeAnomaly.institutionalAccumulation,
    nearestGap: gaps.nearestGap,
    fiiTrend: fii.trend,
    pcRatio: putCall.pcRatio,
    simonsSignals: tags,
  };

  return { signals, tags, scoreContribution, enrichment };
};
