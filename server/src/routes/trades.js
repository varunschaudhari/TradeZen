/**
 * @file trades.js
 * @description REST routes for trade lifecycle management
 *   GET   /api/trades            — all trades (last 50), optional ?status=OPEN|CLOSED|EXPIRED
 *   GET   /api/trades/open       — open positions with live unrealized P&L
 *   POST  /api/trades            — log a new trade entry
 *   PATCH /api/trades/:id        — update price, SL, or notes on an open trade
 *   PATCH /api/trades/:id/target1 — mark Target 1 as hit, trail SL to entry
 *   PATCH /api/trades/:id/close  — close trade, compute realized P&L
 * @author SwingTrader AI Team
 */

import express from 'express';
import mongoose from 'mongoose';
import Joi from 'joi';
import Trade from '../models/Trade.js';
import Stock from '../models/Stock.js';
import Config from '../models/Config.js';
import { validateBody } from '../middleware/validateRequest.js';
import { netAfterCosts } from '../services/tradingCosts.js';
import { computeCloseFields } from '../services/tradeTracker.js';
import { sendTarget1Hit, sendTarget2Hit } from '../services/notifier.js';
import { getLivePositions, refreshOpenPositions } from '../services/positionTracker.js';
import { emitToUser, SOCKET_EVENTS } from '../socket/socketHandlers.js';
import {
  TRADE_STATUSES,
  EXIT_REASONS,
  MAX_OPEN_TRADES,
  MAX_CAPITAL_DEPLOYED_PCT,
  DAILY_LOSS_PAUSE_PCT,
  DEFAULT_RISK_PCT,
  DEFAULT_CAPITAL,
} from '../config/constants.js';
import { logger } from '../config/logger.js';

const router = express.Router();

// ── Joi schemas ────────────────────────────────────────────────────────────────
const newTradeSchema = Joi.object({
  symbol: Joi.string().uppercase().min(1).max(20).required(),
  signalId: Joi.string().optional(),
  entryPrice: Joi.number().positive().required(),
  stopLoss: Joi.number().positive().required(),
  target1: Joi.number().positive().required(),
  target2: Joi.number().positive().optional(),
  shares: Joi.number().integer().positive().required(),
  capitalDeployed: Joi.number().positive().required(),
  entryDate: Joi.date().optional(),
  notes: Joi.string().max(500).allow('').optional(),
});

const updateTradeSchema = Joi.object({
  currentPrice: Joi.number().positive().optional(),
  stopLoss: Joi.number().positive().optional(),
  slTrailed: Joi.boolean().optional(),
  notes: Joi.string().max(500).allow('').optional(),
}).min(1);

const closeTradeSchema = Joi.object({
  exitPrice: Joi.number().positive().required(),
  exitReason: Joi.string().valid(...Object.values(EXIT_REASONS)).required(),
  notes: Joi.string().max(500).allow('').optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function validId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function computeUnrealized(trade, currentPrice) {
  const pnl = (currentPrice - trade.entryPrice) * trade.shares;
  const pct = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
  return { unrealizedPnl: Math.round(pnl * 100) / 100, unrealizedPnlPct: Math.round(pct * 100) / 100 };
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /api/trades
router.get('/', async (req, res, next) => {
  try {
    const filter = { userId: req.userId };
    const validStatuses = new Set(Object.values(TRADE_STATUSES));
    if (req.query.status && validStatuses.has(req.query.status)) {
      filter.status = req.query.status;
    }
    const trades = await Trade.find(filter).sort({ createdAt: -1 }).limit(50).lean();
    // Closed trades that predate the cost fields get netted on the fly (not persisted)
    // so every consumer sees gross AND net — the number that survives real charges.
    for (const t of trades) {
      if (
        t.status === TRADE_STATUSES.CLOSED &&
        t.netPnl == null &&
        t.realizedPnl != null &&
        t.exitPrice != null
      ) {
        const { netPnl, costs } = netAfterCosts(
          t.realizedPnl, t.entryPrice, t.exitPrice, t.shares, 'DELIVERY'
        );
        t.netPnl = netPnl;
        t.estCosts = costs.total;
      }
    }
    res.json({ success: true, data: trades, message: `${trades.length} trades retrieved` });
  } catch (err) {
    next(err);
  }
});

// GET /api/trades/sector-concentration — capital distribution by sector for open trades
router.get('/sector-concentration', async (req, res, next) => {
  try {
    const openTrades = await Trade.find({ userId: req.userId, status: TRADE_STATUSES.OPEN }).lean();
    if (!openTrades.length) {
      return res.json({ success: true, data: { sectors: [], totalDeployed: 0, hasWarning: false, warningThreshold: 40 } });
    }

    const symbols = [...new Set(openTrades.map((t) => t.symbol))];
    const stocks  = await Stock.find({ symbol: { $in: symbols } }, { symbol: 1, sector: 1 }).lean();
    const sectorMap = Object.fromEntries(stocks.map((s) => [s.symbol, s.sector ?? 'Unknown']));

    const sectorTotals = {};
    let totalDeployed = 0;
    for (const trade of openTrades) {
      const sector = sectorMap[trade.symbol] ?? 'Unknown';
      sectorTotals[sector] = (sectorTotals[sector] ?? 0) + (trade.capitalDeployed ?? 0);
      totalDeployed += trade.capitalDeployed ?? 0;
    }

    const sectors = Object.entries(sectorTotals)
      .map(([sector, deployed]) => ({
        sector,
        deployed: Math.round(deployed),
        pct: totalDeployed > 0 ? Math.round((deployed / totalDeployed) * 1000) / 10 : 0,
        symbols: openTrades.filter((t) => (sectorMap[t.symbol] ?? 'Unknown') === sector).map((t) => t.symbol),
      }))
      .sort((a, b) => b.deployed - a.deployed);

    const THRESHOLD = 40;
    res.json({
      success: true,
      data: { sectors, totalDeployed: Math.round(totalDeployed), hasWarning: sectors.some((s) => s.pct >= THRESHOLD), warningThreshold: THRESHOLD },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/trades/accuracy — closed trade win/loss breakdown per symbol
// Returns { [symbol]: { wins, losses, total, winRate } }
router.get('/accuracy', async (req, res, next) => {
  try {
    const results = await Trade.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(req.userId), status: TRADE_STATUSES.CLOSED } },
      {
        $group: {
          _id: '$symbol',
          wins:   { $sum: { $cond: [{ $in: ['$exitReason', [EXIT_REASONS.TARGET1, EXIT_REASONS.TARGET2]] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $eq: ['$exitReason', EXIT_REASONS.STOPLOSS] }, 1, 0] } },
          total:  { $sum: 1 },
        },
      },
    ]);

    const bySymbol = {};
    for (const r of results) {
      bySymbol[r._id] = {
        wins:    r.wins,
        losses:  r.losses,
        total:   r.total,
        winRate: r.total > 0 ? Math.round((r.wins / r.total) * 100) : null,
      };
    }
    res.json({ success: true, data: bySymbol });
  } catch (err) {
    next(err);
  }
});

// GET /api/trades/risk-summary — real-time capital protection state
router.get('/risk-summary', async (req, res, next) => {
  try {
    const config = await Config.findOne({ userId: req.userId }).lean();
    const capital           = config?.capital           ?? DEFAULT_CAPITAL;
    const riskPct           = config?.riskPercentage    ?? DEFAULT_RISK_PCT;
    const maxOpenTrades           = config?.maxOpenTrades           ?? MAX_OPEN_TRADES;
    const maxCapitalDeployedPct   = config?.maxCapitalDeployedPct   ?? MAX_CAPITAL_DEPLOYED_PCT;

    // Open positions
    const openTrades = await Trade.find({ userId: req.userId, status: TRADE_STATUSES.OPEN }).lean();
    const openCount          = openTrades.length;
    const totalCapitalDeployed = openTrades.reduce((s, t) => s + (t.capitalDeployed ?? 0), 0);
    const capitalDeployedPct   = capital > 0 ? (totalCapitalDeployed / capital) * 100 : 0;

    // Today's closed trades (UTC midnight boundary)
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayTrades = await Trade.find({
      userId: req.userId,
      status: TRADE_STATUSES.CLOSED,
      exitDate: { $gte: todayStart },
    }).lean();

    const dailyRealizedPnl = todayTrades.reduce((s, t) => s + (t.realizedPnl ?? 0), 0);
    const dailyLossPct     = dailyRealizedPnl < 0 && capital > 0
      ? Math.abs(dailyRealizedPnl / capital) * 100
      : 0;
    const isDailyLossPaused = dailyRealizedPnl <= -(capital * (DAILY_LOSS_PAUSE_PCT / 100));

    res.json({
      success: true,
      data: {
        // ── Position limits ──────────────────────────────────────
        openCount,
        maxOpenTrades,
        slotsLeft:      Math.max(0, maxOpenTrades - openCount),
        slotsUsedPct:   Math.round((openCount / maxOpenTrades) * 1000) / 10,

        // ── Capital limits ───────────────────────────────────────
        capital,
        totalCapitalDeployed:  Math.round(totalCapitalDeployed),
        capitalDeployedPct:    Math.round(capitalDeployedPct * 10) / 10,
        maxCapitalDeployedPct,
        capitalAvailable:      Math.round(capital - totalCapitalDeployed),

        // ── Daily loss ───────────────────────────────────────────
        dailyRealizedPnl:      Math.round(dailyRealizedPnl),
        dailyLossPct:          Math.round(dailyLossPct * 10) / 10,
        isDailyLossPaused,
        dailyLossThreshold:    DAILY_LOSS_PAUSE_PCT,
        dailyWins:             todayTrades.filter((t) => (t.realizedPnl ?? 0) > 0).length,
        dailyLosses:           todayTrades.filter((t) => (t.realizedPnl ?? 0) < 0).length,

        // ── Risk config ──────────────────────────────────────────
        riskPct,
        perTradeMaxLoss: Math.round(capital * (riskPct / 100)),

        // ── Open positions breakdown ─────────────────────────────
        openPositions: openTrades.map((t) => ({
          _id:             t._id,
          symbol:          t.symbol,
          capitalDeployed: t.capitalDeployed,
          capitalPct:      capital > 0
            ? Math.round((t.capitalDeployed / capital) * 1000) / 10
            : 0,
          unrealizedPnl:   t.unrealizedPnl ?? 0,
          currentPrice:    t.currentPrice,
          stopLoss:        t.stopLoss,
          entryPrice:      t.entryPrice,
          target1Hit:      t.target1Hit,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/trades/open — must be before /:id
router.get('/open', async (req, res, next) => {
  try {
    const trades = await Trade.find({ userId: req.userId, status: TRADE_STATUSES.OPEN }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: trades, message: `${trades.length} open positions` });
  } catch (err) {
    next(err);
  }
});

// GET /api/trades/live — open positions with FRESH-quote P&L, SL distance, and a
// suggested action + trailing stop per position. Read-only (never closes trades).
router.get('/live', async (req, res, next) => {
  try {
    const { positions, summary } = await getLivePositions(req.userId);
    res.json({ success: true, data: { positions, summary }, message: `${positions.length} live positions` });
  } catch (err) {
    next(err);
  }
});

// POST /api/trades/refresh — force the mutating monitor (auto-close on SL/T2, trail on
// T1, fire alerts) using fresh light quotes. Returns the monitor summary.
router.post('/refresh', async (req, res, next) => {
  try {
    const summary = await refreshOpenPositions(req.userId);
    res.json({ success: true, data: summary, message: `Monitored ${summary.checked} position(s)` });
  } catch (err) {
    next(err);
  }
});

// POST /api/trades
router.post('/', validateBody(newTradeSchema), async (req, res, next) => {
  try {
    const { entryPrice, stopLoss, target1, shares, capitalDeployed } = req.body;
    const riskPerShare = entryPrice - stopLoss;
    const riskReward = riskPerShare > 0 ? (target1 - entryPrice) / riskPerShare : 0;

    const trade = await Trade.create({
      ...req.body,
      userId: req.userId,
      status: TRADE_STATUSES.OPEN,
      unrealizedPnl: 0,
      unrealizedPnlPct: 0,
      riskReward: Math.round(riskReward * 100) / 100,
    });

    logger.info('New trade logged', { userId: req.userId, symbol: trade.symbol, entryPrice, shares, capitalDeployed });
    res.status(201).json({ success: true, data: trade.toObject(), message: 'Trade logged' });
  } catch (err) {
    next(err);
  }
});

// GET /api/trades/export — CSV download of all trades (must be before /:id)
router.get('/export', async (req, res, next) => {
  try {
    const trades = await Trade.find({ userId: req.userId }).sort({ createdAt: -1 }).lean();
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
    const header = ['Date','Symbol','Status','Entry Price','Stop Loss','Target 1','Target 2','Shares','Capital Deployed (₹)','Current Price','Exit Price','Exit Reason','Realized P&L (₹)','Realized P&L (%)','Notes'];
    const rows = trades.map((t) => {
      const realizedPct = t.capitalDeployed && t.realizedPnl != null
        ? ((t.realizedPnl / t.capitalDeployed) * 100).toFixed(2)
        : '';
      return [
        t.entryDate
          ? new Date(t.entryDate).toISOString().slice(0, 10)
          : new Date(t.createdAt).toISOString().slice(0, 10),
        t.symbol,
        t.status,
        t.entryPrice ?? '',
        t.stopLoss ?? '',
        t.target1 ?? '',
        t.target2 ?? '',
        t.shares ?? '',
        t.capitalDeployed ?? '',
        t.currentPrice ?? '',
        t.exitPrice ?? '',
        t.exitReason ?? '',
        t.realizedPnl ?? '',
        realizedPct,
        t.notes ?? '',
      ].map(esc).join(',');
    });
    const csv = '﻿' + [header.map(esc).join(','), ...rows].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="trades.csv"');
    res.send(csv);
  } catch (err) { next(err); }
});

// PATCH /api/trades/:id — update price or SL on open trade
router.patch('/:id', validateBody(updateTradeSchema), async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid trade ID', code: 400 });
    }

    const trade = await Trade.findOne({ _id: req.params.id, userId: req.userId });
    if (!trade) return res.status(404).json({ success: false, error: 'Trade not found', code: 404 });
    if (trade.status !== TRADE_STATUSES.OPEN) {
      return res.status(400).json({ success: false, error: 'Can only update open trades', code: 400 });
    }

    const updates = { ...req.body };

    if (updates.currentPrice) {
      const { unrealizedPnl, unrealizedPnlPct } = computeUnrealized(trade, updates.currentPrice);
      updates.unrealizedPnl = unrealizedPnl;
      updates.unrealizedPnlPct = unrealizedPnlPct;
    }

    Object.assign(trade, updates);
    await trade.save();

    res.json({ success: true, data: trade.toObject(), message: 'Trade updated' });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/trades/:id/target1 — mark T1 hit, suggest trailing SL to entry
router.patch('/:id/target1', async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid trade ID', code: 400 });
    }

    const trade = await Trade.findOne({ _id: req.params.id, userId: req.userId });
    if (!trade) return res.status(404).json({ success: false, error: 'Trade not found', code: 404 });
    if (trade.status !== TRADE_STATUSES.OPEN) {
      return res.status(400).json({ success: false, error: 'Trade is not open', code: 400 });
    }
    if (trade.target1Hit) {
      return res.status(400).json({ success: false, error: 'Target 1 already marked', code: 400 });
    }

    trade.target1Hit = true;
    trade.target1HitDate = new Date();
    trade.target1ExitPrice = trade.currentPrice ?? trade.target1; // best available fill price
    if (!trade.slTrailed) {
      trade.slTrailed = true;
      trade.slTrailedTo = trade.entryPrice; // break-even — consistent with monitor path
      trade.stopLoss = trade.entryPrice;
    }
    await trade.save();

    emitToUser(req.userId, SOCKET_EVENTS.TRADE_TARGET1, trade.toObject());
    sendTarget1Hit(trade.toObject()).catch(() => {});

    res.json({ success: true, data: trade.toObject(), message: 'Target 1 marked — SL trailed to entry' });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/trades/:id/close — close trade, compute realized P&L
router.patch('/:id/close', validateBody(closeTradeSchema), async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid trade ID', code: 400 });
    }

    const trade = await Trade.findOne({ _id: req.params.id, userId: req.userId });
    if (!trade) return res.status(404).json({ success: false, error: 'Trade not found', code: 404 });
    if (trade.status !== TRADE_STATUSES.OPEN) {
      return res.status(400).json({ success: false, error: 'Trade is not open', code: 400 });
    }

    const { exitPrice, exitReason, notes } = req.body;
    // T1-aware and cost-aware: blends the banked T1 leg (if hit) with the final exit
    // leg instead of pricing the whole position off only the last price — see
    // computeCloseFields' own doc for why (this is the same fix tradeTracker's
    // auto-close path already uses; this manual route was a separate, stale copy).
    Object.assign(trade, computeCloseFields(trade, exitPrice, exitReason));
    if (notes) trade.notes = notes;

    await trade.save();

    // Notify only this user's own connected clients — closed-trade P&L is private
    emitToUser(req.userId, SOCKET_EVENTS.TRADE_CLOSED, {
      _id: String(trade._id),
      symbol: trade.symbol,
      exitReason,
      exitPrice,
      realizedPnl: trade.realizedPnl,
    });

    if (exitReason === EXIT_REASONS.TARGET2) {
      sendTarget2Hit(trade.toObject()).catch(() => {});
    }

    logger.info('Trade closed', {
      symbol: trade.symbol,
      exitReason,
      realizedPnl: trade.realizedPnl,
      realizedPnlPct: trade.realizedPnlPct,
    });

    res.json({ success: true, data: trade.toObject(), message: `Trade closed (${exitReason})` });
  } catch (err) {
    next(err);
  }
});

export default router;
