/**
 * @file performance.js
 * @description REST routes for performance statistics
 *   GET /api/performance                  — aggregate summary (win rate, P&L, drawdown, cost)
 *   GET /api/performance/history          — paginated monthly P&L + capital growth data
 *   GET /api/performance/decision-quality — calibration report (is confidence/score meaningful?)
 * @author SwingTrader AI Team
 */

import express from 'express';
import Trade from '../models/Trade.js';
import Signal from '../models/Signal.js';
import Config from '../models/Config.js';
import { TRADE_STATUSES } from '../config/constants.js';
import { getDecisionQualityReport } from '../services/decisionQuality.js';
import { fetchOhlcv } from '../services/pythonBridge.js';

const router = express.Router();

// GET /api/performance/decision-quality — calibration / decision-quality report.
// Resolves stored signals against forward prices (slow — fetches OHLCV per symbol).
router.get('/decision-quality', async (_req, res, next) => {
  try {
    const report = await getDecisionQualityReport();
    res.json({ success: true, data: report, message: 'Decision-quality / calibration report' });
  } catch (err) {
    next(err);
  }
});

// GET /api/performance — must be before /history to avoid route shadowing
router.get('/', async (_req, res, next) => {
  try {
    const [closedTrades, openTrades, config, signalStats] = await Promise.all([
      Trade.find({ status: TRADE_STATUSES.CLOSED }).lean(),
      Trade.find({ status: TRADE_STATUSES.OPEN }).lean(),
      Config.findOne().lean(),
      Signal.aggregate([
        { $group: { _id: null, totalCost: { $sum: '$claudeCostInr' }, count: { $sum: 1 } } },
      ]),
    ]);

    const totalTrades = closedTrades.length;
    const wins = closedTrades.filter((t) => (t.realizedPnl ?? 0) > 0);
    const losses = closedTrades.filter((t) => (t.realizedPnl ?? 0) <= 0);
    const winRate = totalTrades > 0 ? wins.length / totalTrades : 0;
    const totalPnl = closedTrades.reduce((s, t) => s + (t.realizedPnl ?? 0), 0);
    const totalCapitalUsed = closedTrades.reduce((s, t) => s + (t.capitalDeployed ?? 0), 0);
    const totalPnlPct = totalCapitalUsed > 0 ? (totalPnl / totalCapitalUsed) * 100 : 0;
    const avgRR =
      totalTrades > 0
        ? closedTrades.reduce((s, t) => s + (t.riskReward ?? 0), 0) / totalTrades
        : 0;

    // Max drawdown: worst single-trade loss as pct of its deployed capital
    let maxDrawdown = 0;
    for (const t of losses) {
      if (t.capitalDeployed > 0) {
        const dd = ((t.realizedPnl ?? 0) / t.capitalDeployed) * 100;
        if (dd < maxDrawdown) maxDrawdown = dd;
      }
    }

    const totalDeployed = openTrades.reduce((s, t) => s + (t.capitalDeployed ?? 0), 0);
    const unrealizedPnl = openTrades.reduce((s, t) => s + (t.unrealizedPnl ?? 0), 0);
    const claudeApiCostTotal = signalStats[0]?.totalCost ?? 0;

    res.json({
      success: true,
      data: {
        totalTrades,
        winningTrades: wins.length,
        losingTrades: losses.length,
        winRate: Math.round(winRate * 10000) / 100, // percentage, 2dp
        totalPnl: Math.round(totalPnl * 100) / 100,
        totalPnlPct: Math.round(totalPnlPct * 100) / 100,
        avgRR: Math.round(avgRR * 100) / 100,
        maxDrawdown: Math.round(maxDrawdown * 100) / 100,
        openPositions: openTrades.length,
        totalDeployed: Math.round(totalDeployed * 100) / 100,
        unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
        capital: config?.capital ?? 0,
        claudeApiCostTotal: Math.round(claudeApiCostTotal * 10000) / 10000,
      },
      message: 'Performance summary',
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/performance/history?period=monthly&limit=12
router.get('/history', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? '12', 10), 36);

    // Monthly P&L grouped by exit date
    const monthly = await Trade.aggregate([
      { $match: { status: TRADE_STATUSES.CLOSED, exitDate: { $exists: true }, realizedPnl: { $exists: true } } },
      {
        $group: {
          _id: { year: { $year: '$exitDate' }, month: { $month: '$exitDate' } },
          pnl: { $sum: '$realizedPnl' },
          trades: { $sum: 1 },
          wins: { $sum: { $cond: [{ $gt: ['$realizedPnl', 0] }, 1, 0] } },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
      { $limit: limit },
    ]);

    const config = await Config.findOne().lean();
    const initialCapital = config?.capital ?? 1_000_000;

    // Capital growth: cumulative P&L added to initial capital
    let running = initialCapital;
    const capitalGrowth = monthly.map((m) => {
      running += m.pnl;
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return {
        label: `${monthNames[m._id.month - 1]} ${m._id.year}`,
        capital: Math.round(running * 100) / 100,
        pnl: Math.round(m.pnl * 100) / 100,
        trades: m.trades,
        wins: m.wins,
      };
    });

    res.json({
      success: true,
      data: { monthly: capitalGrowth, initialCapital },
      message: `${capitalGrowth.length} months of history`,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/performance/benchmark — portfolio capital growth vs Nifty 50, aligned monthly
router.get('/benchmark', async (_req, res, next) => {
  try {
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const [monthly, config, ohlcvResult] = await Promise.all([
      Trade.aggregate([
        { $match: { status: TRADE_STATUSES.CLOSED, exitDate: { $exists: true }, realizedPnl: { $exists: true } } },
        { $group: {
          _id: { year: { $year: '$exitDate' }, month: { $month: '$exitDate' } },
          pnl: { $sum: '$realizedPnl' },
        }},
        { $sort: { '_id.year': 1, '_id.month': 1 } },
        { $limit: 36 },
      ]),
      Config.findOne().lean(),
      fetchOhlcv('^NSEI', '3y', '1d').catch(() => null),
    ]);

    const initialCapital = config?.capital ?? 1_000_000;

    // Build nifty monthly close map: "2026-6" → { first, last }
    const niftyMap = {};
    for (const candle of (ohlcvResult?.data ?? [])) {
      const d = new Date((candle.time ?? 0) * 1000);
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
      if (!niftyMap[key]) niftyMap[key] = { first: candle.close, last: candle.close };
      else niftyMap[key].last = candle.close;
    }

    // Find earliest nifty data point that aligns with portfolio start
    let niftyBase = null;
    let portfolioCapital = initialCapital;

    const months = monthly.map((m) => {
      portfolioCapital += m.pnl;
      const label = `${MONTH_NAMES[m._id.month - 1]} ${m._id.year}`;
      const key = `${m._id.year}-${m._id.month}`;
      const nifty = niftyMap[key];
      if (niftyBase === null && nifty) niftyBase = nifty.first;
      const niftyCapital = niftyBase && nifty
        ? Math.round(initialCapital * (nifty.last / niftyBase) * 100) / 100
        : null;
      return { label, portfolioCapital: Math.round(portfolioCapital * 100) / 100, niftyCapital };
    });

    res.json({ success: true, data: { months, initialCapital }, message: 'Benchmark comparison' });
  } catch (err) {
    next(err);
  }
});

export default router;
