/**
 * @file reportGenerator.js
 * @description Queries MongoDB to build structured data objects for the three
 *              scheduled reports (morning brief, evening summary, weekly report).
 *              All functions return a safe fallback object on any DB failure.
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-14
 */

import Signal from '../models/Signal.js';
import Trade from '../models/Trade.js';
import Config from '../models/Config.js';
import Performance from '../models/Performance.js';
import { logger } from '../config/logger.js';
import { VERDICTS, TRADE_STATUSES } from '../config/constants.js';

// ── Date helpers ─────────────────────────────────────────────────────────────
function startOfToday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function startOfWeek() {
  const d = startOfToday();
  // Monday of current ISO week
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function todayIST() {
  return new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ── Morning brief ─────────────────────────────────────────────────────────────
/**
 * Build pre-market summary data for 8:30 AM IST alert.
 *
 * Data collected:
 * - Config: watchlist size, capital, paper mode, market mode
 * - Open trades: count, total deployed capital, unrealized P&L
 * - Signals generated today (so far): count by verdict
 *
 * @returns {Promise<object>} Morning brief payload for notifier.sendMorningBrief()
 */
export const generateMorningBrief = async () => {
  try {
    const [config, openTrades, todaySignals] = await Promise.all([
      Config.findOne().lean(),
      Trade.find({ status: TRADE_STATUSES.OPEN }).lean(),
      Signal.find({ createdAt: { $gte: startOfToday() } }).lean(),
    ]);

    const totalDeployed = openTrades.reduce((s, t) => s + (t.capitalDeployed ?? 0), 0);
    const unrealizedPnl = openTrades.reduce((s, t) => s + (t.unrealizedPnl ?? 0), 0);
    const buySignalsToday = todaySignals.filter((s) => s.verdict === VERDICTS.BUY).length;
    const claudeCostToday = todaySignals.reduce((s, sig) => s + (sig.claudeCostInr ?? 0), 0);

    return {
      dateStr: todayIST(),
      marketMode: config?.marketMode ?? 'UNKNOWN',
      paperTradeMode: config?.paperTradeMode ?? true,
      capital: config?.capital ?? 0,
      watchlistCount: config?.watchlist?.length ?? 0,
      openTradesCount: openTrades.length,
      totalDeployed,
      unrealizedPnl,
      unrealizedPnlPct:
        totalDeployed > 0 ? (unrealizedPnl / totalDeployed) * 100 : 0,
      todaySignals: todaySignals.length,
      buySignalsToday,
      claudeCostToday: Math.round(claudeCostToday * 10_000) / 10_000,
      // nifty/vix populated by caller if they have live market data
      nifty: null,
      vix: null,
    };
  } catch (err) {
    logger.error('generateMorningBrief failed', { error: err.message });
    return {};
  }
};

// ── Evening summary ───────────────────────────────────────────────────────────
/**
 * Build end-of-day summary data for 4:00 PM IST alert.
 *
 * Data collected:
 * - Trades closed today: count, total realized P&L
 * - Open trades remaining: count
 * - All signals today: total count, BUY count
 * - Claude API cost today
 *
 * @returns {Promise<object>} Evening summary payload for notifier.sendEveningSummary()
 */
export const generateEveningSummary = async () => {
  try {
    const today = startOfToday();
    const [closedToday, openTrades, todaySignals] = await Promise.all([
      Trade.find({ status: TRADE_STATUSES.CLOSED, exitDate: { $gte: today } }).lean(),
      Trade.find({ status: TRADE_STATUSES.OPEN }).lean(),
      Signal.find({ createdAt: { $gte: today } }).lean(),
    ]);

    const dayPnl = closedToday.reduce((s, t) => s + (t.realizedPnl ?? 0), 0);
    const totalCapital = closedToday.reduce((s, t) => s + (t.capitalDeployed ?? 0), 0);
    const claudeCostInr = todaySignals.reduce((s, sig) => s + (sig.claudeCostInr ?? 0), 0);
    const wins = closedToday.filter((t) => (t.realizedPnl ?? 0) > 0).length;
    const losses = closedToday.filter((t) => (t.realizedPnl ?? 0) <= 0).length;

    return {
      dateStr: todayIST(),
      closedTrades: closedToday.length,
      dayPnl: Math.round(dayPnl * 100) / 100,
      dayPnlPct: totalCapital > 0 ? (dayPnl / totalCapital) * 100 : 0,
      wins,
      losses,
      winRate: closedToday.length > 0 ? wins / closedToday.length : null,
      openTradesCount: openTrades.length,
      signalsGenerated: todaySignals.length,
      buySignals: todaySignals.filter((s) => s.verdict === VERDICTS.BUY).length,
      claudeCostInr: Math.round(claudeCostInr * 10_000) / 10_000,
    };
  } catch (err) {
    logger.error('generateEveningSummary failed', { error: err.message });
    return {};
  }
};

// ── Weekly report ─────────────────────────────────────────────────────────────
/**
 * Build weekly performance report for Sunday 8:00 AM IST alert.
 *
 * Data collected:
 * - All trades closed this week: win rate, total P&L, best/worst trade
 * - All signals this week: count, Claude cost
 * - Performance document if available
 *
 * @returns {Promise<object>} Weekly report payload for notifier.sendWeeklyReport()
 */
export const generateWeeklyReport = async () => {
  try {
    const weekStart = startOfWeek();
    const [weekTrades, weekSignals, perfDoc] = await Promise.all([
      Trade.find({ status: TRADE_STATUSES.CLOSED, exitDate: { $gte: weekStart } }).lean(),
      Signal.find({ createdAt: { $gte: weekStart } }).lean(),
      Performance.findOne({ period: 'weekly', date: { $gte: weekStart } })
        .sort({ date: -1 })
        .lean(),
    ]);

    const totalPnl = weekTrades.reduce((s, t) => s + (t.realizedPnl ?? 0), 0);
    const wins = weekTrades.filter((t) => (t.realizedPnl ?? 0) > 0);
    const losses = weekTrades.filter((t) => (t.realizedPnl ?? 0) <= 0);
    const claudeCostInr = weekSignals.reduce((s, sig) => s + (sig.claudeCostInr ?? 0), 0);

    const avgRR =
      weekTrades.length > 0
        ? weekTrades.reduce((s, t) => s + (t.riskReward ?? 0), 0) / weekTrades.length
        : null;

    const sortedByPnl = [...weekTrades].sort((a, b) => (b.realizedPnl ?? 0) - (a.realizedPnl ?? 0));
    const bestTrade = sortedByPnl[0] ?? null;
    const worstTrade = sortedByPnl[sortedByPnl.length - 1] ?? null;

    // Max drawdown: deepest single-trade loss as percentage of its deployed capital
    let maxDrawdown = 0;
    for (const t of losses) {
      const dd = t.capitalDeployed > 0 ? ((t.realizedPnl ?? 0) / t.capitalDeployed) * 100 : 0;
      if (dd < maxDrawdown) maxDrawdown = dd;
    }

    return {
      weekStartStr: weekStart.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
      totalTrades: weekTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: weekTrades.length > 0 ? wins.length / weekTrades.length : null,
      totalPnl: Math.round(totalPnl * 100) / 100,
      avgRR: avgRR != null ? Math.round(avgRR * 100) / 100 : null,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      signalsGenerated: weekSignals.length,
      buySignals: weekSignals.filter((s) => s.verdict === VERDICTS.BUY).length,
      claudeCostInr: Math.round(claudeCostInr * 10_000) / 10_000,
      bestTrade: bestTrade
        ? { symbol: bestTrade.symbol, pnl: Math.round((bestTrade.realizedPnl ?? 0) * 100) / 100 }
        : null,
      worstTrade: worstTrade
        ? { symbol: worstTrade.symbol, pnl: Math.round((worstTrade.realizedPnl ?? 0) * 100) / 100 }
        : null,
      // Include Performance doc stats if the daily snapshot exists
      ...(perfDoc
        ? {
            capitalStart: perfDoc.capitalStart,
            capitalEnd: perfDoc.capitalEnd,
          }
        : {}),
    };
  } catch (err) {
    logger.error('generateWeeklyReport failed', { error: err.message });
    return {};
  }
};
