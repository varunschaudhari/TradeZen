/**
 * @file performanceEngine.js
 * @description Flow 10 — performance metrics: win rate, avg R:R, expectancy, drawdown,
 *              monthly P&L, and per-setup/confidence/Simons/sector signal accuracy, plus
 *              Simons-style signal-decay detection.
 *              Pure calculators (computeTradeMetrics, computeSignalAccuracy,
 *              detectSignalDecay) are unit-tested; updatePerformance /
 *              getPerformanceSummary are thin DB glue over those cores.
 *              Go-live readiness lives in goLiveGate.js — the evidence-based gate
 *              (sample size, span, profit factor, drawdown), not this file (a lighter
 *              win-rate/weeks check used to live here too; removed 2026-07-28 since it
 *              gave a contradictory, more lenient "ready" verdict than the real gate).
 * @author TradeZen Team
 * @created 2026-06-20
 * @lastModified 2026-06-20
 */

import Trade from '../models/Trade.js';
import Signal from '../models/Signal.js';
import Performance from '../models/Performance.js';
import Config from '../models/Config.js';
import {
  DEFAULT_CAPITAL,
  SIGNAL_DECAY_MIN_SAMPLES,
  SIGNAL_DECAY_WINRATE,
} from '../config/constants.js';
import { logger } from '../config/logger.js';

const round2 = (n) => Math.round(n * 100) / 100;
const MS_PER_DAY = 86_400_000;
const isWin = (t) => (t.realizedPnl ?? 0) > 0;
const isLoss = (t) => (t.realizedPnl ?? 0) < 0;

/**
 * Max peak-to-trough drawdown over the equity curve of cumulative realized P&L.
 *
 * @param {object[]} trades - Closed trades (sorted internally by exitDate)
 * @param {number} capitalStart - Starting capital
 * @returns {{ maxDrawdown: number, maxDrawdownPct: number }}
 */
function equityDrawdown(trades, capitalStart) {
  const sorted = [...trades].sort((a, b) => new Date(a.exitDate) - new Date(b.exitDate));
  let running = capitalStart;
  let peak = capitalStart;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  for (const t of sorted) {
    running += t.realizedPnl ?? 0;
    peak = Math.max(peak, running);
    const dd = peak - running;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownPct = peak > 0 ? (dd / peak) * 100 : 0;
    }
  }
  return { maxDrawdown: round2(maxDrawdown), maxDrawdownPct: round2(maxDrawdownPct) };
}

/**
 * Group realized P&L by calendar month (YYYY-MM) with per-month win rate.
 *
 * @param {object[]} trades - Closed trades
 * @returns {Array<{ month: string, pnl: number, trades: number, winRate: number }>}
 */
function monthlyBreakdown(trades) {
  const map = new Map();
  for (const t of trades) {
    const d = new Date(t.exitDate);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const g = map.get(key) ?? { month: key, pnl: 0, trades: 0, wins: 0 };
    g.pnl += t.realizedPnl ?? 0;
    g.trades += 1;
    if (isWin(t)) g.wins += 1;
    map.set(key, g);
  }
  return [...map.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((g) => ({
      month: g.month,
      pnl: round2(g.pnl),
      trades: g.trades,
      winRate: round2((g.wins / g.trades) * 100),
    }));
}

/**
 * Identify the best and worst trade by realized P&L.
 *
 * @param {object[]} trades - Closed trades
 * @returns {{ bestTrade: object|null, worstTrade: object|null }}
 */
function bestWorst(trades) {
  if (!trades.length) return { bestTrade: null, worstTrade: null };
  const pick = (t) => ({ symbol: t.symbol, pnl: round2(t.realizedPnl ?? 0), date: t.exitDate });
  let best = trades[0];
  let worst = trades[0];
  for (const t of trades) {
    if ((t.realizedPnl ?? 0) > (best.realizedPnl ?? 0)) best = t;
    if ((t.realizedPnl ?? 0) < (worst.realizedPnl ?? 0)) worst = t;
  }
  return { bestTrade: pick(best), worstTrade: pick(worst) };
}

/**
 * Compute the full trade-performance metric set (pure).
 *
 * @param {object[]} closedTrades - Trades with realizedPnl, capitalDeployed, entry/exitDate
 * @param {object} [opts] - { capitalStart }
 * @returns {object} Metrics (winRate is a percentage; expectancy/P&L in INR)
 */
export const computeTradeMetrics = (closedTrades, opts = {}) => {
  const capitalStart = opts.capitalStart ?? DEFAULT_CAPITAL;
  const trades = (closedTrades ?? []).filter((t) => t.realizedPnl != null);
  const totalTrades = trades.length;
  if (!totalTrades) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      avgWinAmount: 0,
      avgLossAmount: 0,
      avgRR: 0,
      expectancy: 0,
      totalPnl: 0,
      totalPnlPct: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      bestTrade: null,
      worstTrade: null,
      avgHoldDays: 0,
      capitalCurrent: capitalStart,
      capitalGrowthPct: 0,
      monthlyPnl: [],
    };
  }

  const wins = trades.filter(isWin);
  const losses = trades.filter(isLoss);
  const totalPnl = trades.reduce((s, t) => s + t.realizedPnl, 0);
  const sumWin = wins.reduce((s, t) => s + t.realizedPnl, 0);
  const sumLoss = losses.reduce((s, t) => s + Math.abs(t.realizedPnl), 0);
  const avgWinAmount = wins.length ? sumWin / wins.length : 0;
  const avgLossAmount = losses.length ? sumLoss / losses.length : 0;
  const winFrac = wins.length / totalTrades;
  const lossFrac = losses.length / totalTrades;
  const holdDays = trades.reduce(
    (s, t) => s + Math.max(0, (new Date(t.exitDate) - new Date(t.entryDate)) / MS_PER_DAY),
    0
  );
  const { maxDrawdown, maxDrawdownPct } = equityDrawdown(trades, capitalStart);
  const { bestTrade, worstTrade } = bestWorst(trades);

  return {
    totalTrades,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: round2((wins.length / totalTrades) * 100),
    avgWinAmount: round2(avgWinAmount),
    avgLossAmount: round2(avgLossAmount),
    avgRR: avgLossAmount > 0 ? round2(avgWinAmount / avgLossAmount) : 0,
    expectancy: round2(winFrac * avgWinAmount - lossFrac * avgLossAmount),
    totalPnl: round2(totalPnl),
    totalPnlPct: capitalStart > 0 ? round2((totalPnl / capitalStart) * 100) : 0,
    maxDrawdown,
    maxDrawdownPct,
    bestTrade,
    worstTrade,
    avgHoldDays: round2(holdDays / totalTrades),
    capitalCurrent: round2(capitalStart + totalPnl),
    capitalGrowthPct: capitalStart > 0 ? round2((totalPnl / capitalStart) * 100) : 0,
    monthlyPnl: monthlyBreakdown(trades),
  };
};

/**
 * Win-rate accuracy grouped by setup type, confidence, Simons signal, and sector.
 * Each trade must carry a `signal` object (its source Signal); a trade contributes to
 * every Simons signal it carried.
 *
 * @param {object[]} trades - Closed trades, each with `signal` populated
 * @returns {{ bySetupType: object, byConfidence: object, bySimonsSignal: object, bySector: object }}
 */
export const computeSignalAccuracy = (trades) => {
  const buckets = { bySetupType: {}, byConfidence: {}, bySimonsSignal: {}, bySector: {} };
  const add = (bucket, key, t) => {
    if (!key) return;
    const g = (bucket[key] ??= { trades: 0, wins: 0, winRate: 0 });
    g.trades += 1;
    if (isWin(t)) g.wins += 1;
  };
  for (const t of trades ?? []) {
    const s = t.signal ?? {};
    add(buckets.bySetupType, s.setupType, t);
    add(buckets.byConfidence, s.confidence, t);
    add(buckets.bySector, s.sector ?? 'UNKNOWN', t);
    for (const sig of s.simonsSignals ?? []) add(buckets.bySimonsSignal, sig, t);
  }
  for (const bucket of Object.values(buckets)) {
    for (const g of Object.values(bucket)) g.winRate = round2((g.wins / g.trades) * 100);
  }
  return buckets;
};

/**
 * Flag setups / Simons signals whose win rate has decayed below the threshold
 * (with enough samples to be meaningful).
 *
 * @param {object[]} trades - Closed trades with `signal` populated
 * @param {object} [opts] - { threshold (0–1), minSamples }
 * @returns {Array<{ type: string, key: string, winRate: number, trades: number }>}
 */
export const detectSignalDecay = (trades, opts = {}) => {
  const threshold = (opts.threshold ?? SIGNAL_DECAY_WINRATE) * 100;
  const minSamples = opts.minSamples ?? SIGNAL_DECAY_MIN_SAMPLES;
  const acc = computeSignalAccuracy(trades);
  const flags = [];
  for (const [type, bucket] of [
    ['setupType', acc.bySetupType],
    ['simonsSignal', acc.bySimonsSignal],
  ]) {
    for (const [key, g] of Object.entries(bucket)) {
      if (g.trades >= minSamples && g.winRate < threshold) {
        flags.push({ type, key, winRate: g.winRate, trades: g.trades });
      }
    }
  }
  return flags;
};

// ── Async DB glue ────────────────────────────────────────────────────────────────
/**
 * Compute the full performance summary from all closed trades (for the API/dashboard).
 *
 * @param {string} userId
 * @param {object} [opts] - { capitalStart }
 * @returns {Promise<object>} Metrics + signalAccuracy + API cost totals
 */
export const getPerformanceSummary = async (userId, opts = {}) => {
  const cfg = await Config.findOne({ userId })
    .lean()
    .catch(() => null);
  const capitalStart = opts.capitalStart ?? cfg?.capital ?? DEFAULT_CAPITAL;
  const closed = await Trade.find({ userId, status: 'CLOSED' }).populate('signalId').lean();
  const withSignal = closed.map((t) => ({ ...t, signal: t.signalId ?? null }));

  const metrics = computeTradeMetrics(withSignal, { capitalStart });
  const signalAccuracy = computeSignalAccuracy(withSignal);
  // Claude spend is shared infrastructure cost — same total regardless of who's asking.
  const costAgg = await Signal.aggregate([
    { $group: { _id: null, total: { $sum: '$claudeCostInr' } } },
  ]).catch(() => []);
  return {
    ...metrics,
    signalAccuracy,
    apiCostTotal: round2(costAgg[0]?.total ?? 0),
  };
};

/**
 * Fetch closed trades (with signals) and return signal-decay flags (weekly review).
 *
 * @param {string} userId
 * @param {object} [opts] - Forwarded to detectSignalDecay ({ threshold, minSamples })
 * @returns {Promise<Array<{ type: string, key: string, winRate: number, trades: number }>>}
 */
export const reviewSignalDecay = async (userId, opts = {}) => {
  const closed = await Trade.find({ userId, status: 'CLOSED' }).populate('signalId').lean();
  const withSignal = closed.map((t) => ({ ...t, signal: t.signalId ?? null }));
  return detectSignalDecay(withSignal, opts);
};

/**
 * Recompute metrics and upsert today's daily Performance snapshot for one user
 * (post-trade-close).
 *
 * @param {string} userId
 * @returns {Promise<object>} The computed metrics
 */
export const updatePerformance = async (userId) => {
  const summary = await getPerformanceSummary(userId);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  try {
    await Performance.updateOne(
      { userId, date: today, period: 'daily' },
      {
        $set: {
          totalTrades: summary.totalTrades,
          winningTrades: summary.winningTrades,
          losingTrades: summary.losingTrades,
          winRate: summary.winRate,
          totalPnl: summary.totalPnl,
          totalPnlPct: summary.totalPnlPct,
          avgRiskReward: summary.avgRR,
          maxDrawdown: summary.maxDrawdown,
          capitalEnd: summary.capitalCurrent,
          claudeApiCostInr: summary.apiCostTotal,
        },
      },
      { upsert: true }
    );
  } catch (err) {
    logger.error('updatePerformance: snapshot upsert failed', { error: err.message });
  }
  logger.info('Performance updated', { winRate: summary.winRate, totalPnl: summary.totalPnl });
  return summary;
};
