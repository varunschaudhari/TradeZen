/**
 * @file decisionQuality.js
 * @description Continuous-improvement feedback loop: a calibration / decision-quality report.
 *   Answers "are our decisions actually good, and is our confidence meaningful?" by two paths:
 *
 *   1. TRADE-BASED (leverages performanceEngine) — realized metrics + win-rate-by-confidence
 *      from logged closed trades. The truth source once a forward paper-trade record exists.
 *   2. SIGNAL CALIBRATION (self-resolution) — resolves every stored signal against ACTUAL
 *      forward price action (did it hit target1 before stopLoss within the horizon?), then
 *      buckets the hit rate by confidence and composite score. This works immediately on the
 *      existing signal history, before any trades are logged.
 *
 *   The headline output is a CALIBRATION VERDICT: is HIGH confidence really better than
 *   MEDIUM/LOW, and does a higher composite score really mean a higher hit rate? If not,
 *   the confidence/score is noise and that's the first thing to fix.
 *
 * @author TradeZen Team
 * @created 2026-06-27
 */

import Signal from '../models/Signal.js';
import Trade from '../models/Trade.js';
import Config from '../models/Config.js';
import { fetchIndicatorSeries, fetchNiftySeries } from './pythonBridge.js';
import {
  computeTradeMetrics,
  computeSignalAccuracy,
  detectSignalDecay,
} from './performanceEngine.js';
import { DEFAULT_CAPITAL } from '../config/constants.js';
import { logger } from '../config/logger.js';

const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
const RESOLVE_HORIZON_DAYS = 30; // trading-day window to resolve a signal's directional call
const MIN_BUCKET = 10; // below this, a bucket's rate is flagged low-confidence

/** Align an index series to a stock's bar dates (carry-forward on gaps). */
function alignByDate(stockDates, idxDates, idxCloses) {
  const map = new Map((idxDates ?? []).map((d, i) => [String(d).slice(0, 10), idxCloses[i]]));
  let last = null;
  return (stockDates ?? []).map((d) => {
    const v = map.get(String(d).slice(0, 10));
    if (v != null) last = v;
    return last;
  });
}

/**
 * Resolve a signal's outcome against forward prices, MARKET-ADJUSTED (excess over Nifty).
 * A signal only WINS if the stock OUTPERFORMED Nifty by the target margin — so it measures
 * decision edge, not the bull-market drift that touches any +2–3% target within a month.
 *
 *   tgtRet  = (target1 − entry)/entry   (excess outperformance required to win)
 *   stopRet = (stopLoss − entry)/entry  (excess underperformance that loses)
 *   exRet_k = (close_k/entry − 1) − (nifty_k/nifty_entry − 1)
 *
 * WIN if exRet reaches tgtRet first; LOSS if it falls to stopRet first; else OPEN.
 *
 * @param {object} signal - Signal with { createdAt, entryZone, target1, stopLoss }
 * @param {object} series - { date:[], close:[] } from fetchIndicatorSeries
 * @param {Array<number|null>} niftyAligned - Nifty close aligned to series.date
 * @param {number} [horizon=RESOLVE_HORIZON_DAYS]
 * @returns {'WIN'|'LOSS'|'OPEN'}
 */
export function resolveOutcome(signal, series, niftyAligned, horizon = RESOLVE_HORIZON_DAYS) {
  const { date, close } = series ?? {};
  const t1 = signal.target1;
  const sl = signal.stopLoss;
  if (!Array.isArray(date) || !date.length || t1 == null || sl == null) return 'OPEN';
  const created = new Date(signal.createdAt).getTime();
  const start = date.findIndex((d) => new Date(d).getTime() > created);
  if (start < 0) return 'OPEN'; // signal newer than the latest bar → not yet resolvable
  const entry = signal.entryZone?.high ?? signal.entryZone?.low ?? close[start];
  if (!(entry > 0)) return 'OPEN';
  const tgtRet = (t1 - entry) / entry;
  const stopRet = (sl - entry) / entry;
  if (!(tgtRet > 0 && stopRet < 0)) return 'OPEN'; // degenerate levels — can't resolve cleanly
  const nEntry = niftyAligned?.[start];
  const end = Math.min(start + horizon, date.length - 1);
  for (let k = start; k <= end; k += 1) {
    const c = close[k];
    if (c == null) continue;
    const nK = niftyAligned?.[k];
    const niftyRet = nEntry != null && nK != null && nEntry > 0 ? nK / nEntry - 1 : 0;
    const exRet = c / entry - 1 - niftyRet;
    if (exRet <= stopRet) return 'LOSS';
    if (exRet >= tgtRet) return 'WIN';
  }
  return 'OPEN';
}

/** Composite-score band (mirrors the live confidence thresholds). */
function scoreBand(s) {
  const sc = s.compositeScore ?? 0;
  return sc >= 60 ? '60+' : sc >= 50 ? '50-59' : sc >= 40 ? '40-49' : '<40';
}

/**
 * Bucket resolved signals by a classifier → { n, win, loss, open, hitRate, resolvedPct } (pure).
 * hitRate is win / (win + loss) — i.e. of the signals that actually resolved.
 *
 * @param {Array<{signal:object, outcome:string}>} resolved
 * @param {(s:object)=>string|null} keyFn
 * @returns {Object<string, object>}
 */
export function bucketBy(resolved, keyFn) {
  const out = {};
  for (const r of resolved) {
    const key = keyFn(r.signal);
    if (key == null) continue;
    const g = (out[key] ??= { n: 0, win: 0, loss: 0, open: 0 });
    g.n += 1;
    if (r.outcome === 'WIN') g.win += 1;
    else if (r.outcome === 'LOSS') g.loss += 1;
    else g.open += 1;
  }
  for (const g of Object.values(out)) {
    const decided = g.win + g.loss;
    g.hitRate = decided ? round2((g.win / decided) * 100) : null;
    g.resolvedPct = g.n ? round2((decided / g.n) * 100) : 0;
    g.enough = decided >= MIN_BUCKET;
  }
  return out;
}

/**
 * Calibration verdict — is HIGH confidence actually better than MEDIUM/LOW? (pure)
 *
 * @param {Object} byConfidence - bucketBy output keyed by confidence
 * @returns {{ calibrated: boolean|null, message: string }}
 */
export function calibrationVerdict(byConfidence) {
  const tiers = ['HIGH', 'MEDIUM', 'LOW']
    .map((c) => ({ c, g: byConfidence[c] }))
    .filter((x) => x.g && x.g.enough && x.g.hitRate != null);
  if (tiers.length < 2) {
    return { calibrated: null, message: 'Not enough resolved signals per confidence tier to judge calibration.' };
  }
  let monotonic = true;
  for (let i = 1; i < tiers.length; i += 1) {
    if (tiers[i].g.hitRate > tiers[i - 1].g.hitRate + 2) monotonic = false; // lower tier shouldn't beat higher
  }
  const desc = tiers.map((t) => `${t.c} ${t.g.hitRate}%`).join(' ≥ ? ');
  return monotonic
    ? { calibrated: true, message: `Confidence is calibrated: ${desc} — higher confidence → higher hit rate.` }
    : { calibrated: false, message: `Confidence is NOT calibrated: ${desc} — a lower tier outperforms a higher one, so the confidence label is currently noise.` };
}

/**
 * Build the full decision-quality / calibration report (async DB + price glue).
 *
 * @param {string} userId - Trade-based half is this user's own paper record; signal
 *   calibration (below) stays shared — it grades the analysis, not any one portfolio.
 * @param {object} [opts] - { horizon, period }
 * @returns {Promise<object>}
 */
export const getDecisionQualityReport = async (userId, opts = {}) => {
  const horizon = opts.horizon ?? RESOLVE_HORIZON_DAYS;
  const period = opts.period ?? '2y';

  // ── 1. Trade-based (performanceEngine) ──────────────────────────────────────
  const cfg = await Config.findOne({ userId })
    .lean()
    .catch(() => null);
  const capitalStart = cfg?.capital ?? DEFAULT_CAPITAL;
  const closed = await Trade.find({ userId, status: 'CLOSED' })
    .populate('signalId')
    .lean()
    .catch(() => []);
  const withSignal = closed.map((t) => ({ ...t, signal: t.signalId ?? null }));
  const tradeMetrics = computeTradeMetrics(withSignal, { capitalStart });
  const tradeAccuracy = computeSignalAccuracy(withSignal);
  const decay = detectSignalDecay(withSignal);

  // ── 2. Signal calibration (self-resolution against forward prices) ──────────
  const signals = await Signal.find({
    target1: { $ne: null },
    stopLoss: { $ne: null },
  })
    .lean()
    .catch(() => []);

  const bySym = new Map();
  for (const s of signals) {
    if (!bySym.has(s.symbol)) bySym.set(s.symbol, []);
    bySym.get(s.symbol).push(s);
  }

  const niftySeries = await fetchNiftySeries(period).catch(() => ({ dates: [], closes: [] }));
  const resolved = [];
  let priceErrors = 0;
  for (const [symbol, group] of bySym) {
    let series = null;
    try {
      const data = await fetchIndicatorSeries(symbol, period);
      series = data?.series ?? null;
    } catch (err) {
      logger.warn('decisionQuality: price fetch failed', { symbol, error: err.message });
    }
    if (!series) {
      priceErrors += group.length;
      continue;
    }
    const niftyAligned = alignByDate(series.date, niftySeries.dates, niftySeries.closes);
    for (const s of group) {
      resolved.push({ signal: s, outcome: resolveOutcome(s, series, niftyAligned, horizon) });
    }
  }

  const decided = resolved.filter((r) => r.outcome !== 'OPEN');
  const calibration = {
    byConfidence: bucketBy(resolved, (s) => s.confidence),
    byScore: bucketBy(resolved, scoreBand),
    byVerdict: bucketBy(resolved, (s) => s.verdict),
  };
  const verdict = calibrationVerdict(calibration.byConfidence);

  return {
    generatedAt: new Date().toISOString(),
    horizonDays: horizon,
    tradeBased: {
      closedTrades: tradeMetrics.totalTrades,
      winRate: tradeMetrics.winRate,
      expectancy: tradeMetrics.expectancy,
      byConfidence: tradeAccuracy.byConfidence,
      decayFlags: decay,
    },
    signalCalibration: {
      signalsConsidered: signals.length,
      resolved: decided.length,
      open: resolved.length - decided.length,
      priceUnavailable: priceErrors,
      marketAdjusted: niftySeries.dates.length > 0, // hit rates are excess-over-Nifty
      ...calibration,
    },
    verdict,
  };
};
