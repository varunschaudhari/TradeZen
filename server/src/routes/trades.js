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
import { validateBody } from '../middleware/validateRequest.js';
import { sendTarget1Hit, sendTarget2Hit } from '../services/notifier.js';
import { emitEvent, SOCKET_EVENTS } from '../socket/socketHandlers.js';
import { TRADE_STATUSES, EXIT_REASONS } from '../config/constants.js';
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
    const filter = {};
    const validStatuses = new Set(Object.values(TRADE_STATUSES));
    if (req.query.status && validStatuses.has(req.query.status)) {
      filter.status = req.query.status;
    }
    const trades = await Trade.find(filter).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ success: true, data: trades, message: `${trades.length} trades retrieved` });
  } catch (err) {
    next(err);
  }
});

// GET /api/trades/open — must be before /:id
router.get('/open', async (_req, res, next) => {
  try {
    const trades = await Trade.find({ status: TRADE_STATUSES.OPEN }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: trades, message: `${trades.length} open positions` });
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
      status: TRADE_STATUSES.OPEN,
      unrealizedPnl: 0,
      unrealizedPnlPct: 0,
      riskReward: Math.round(riskReward * 100) / 100,
    });

    logger.info('New trade logged', { symbol: trade.symbol, entryPrice, shares, capitalDeployed });
    res.status(201).json({ success: true, data: trade.toObject(), message: 'Trade logged' });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/trades/:id — update price or SL on open trade
router.patch('/:id', validateBody(updateTradeSchema), async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid trade ID', code: 400 });
    }

    const trade = await Trade.findById(req.params.id);
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

    const trade = await Trade.findById(req.params.id);
    if (!trade) return res.status(404).json({ success: false, error: 'Trade not found', code: 404 });
    if (trade.status !== TRADE_STATUSES.OPEN) {
      return res.status(400).json({ success: false, error: 'Trade is not open', code: 400 });
    }
    if (trade.target1Hit) {
      return res.status(400).json({ success: false, error: 'Target 1 already marked', code: 400 });
    }

    trade.target1Hit = true;
    trade.target1HitDate = new Date();
    // Recommend trailing SL to entry — store as suggestion in notes if not already slTrailed
    if (!trade.slTrailed) {
      trade.slTrailed = true;
      trade.stopLoss = trade.entryPrice; // trail to break-even
    }
    await trade.save();

    emitEvent(SOCKET_EVENTS.TRADE_TARGET1, trade.toObject());
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

    const trade = await Trade.findById(req.params.id);
    if (!trade) return res.status(404).json({ success: false, error: 'Trade not found', code: 404 });
    if (trade.status !== TRADE_STATUSES.OPEN) {
      return res.status(400).json({ success: false, error: 'Trade is not open', code: 400 });
    }

    const { exitPrice, exitReason, notes } = req.body;
    const realizedPnl = (exitPrice - trade.entryPrice) * trade.shares;
    const realizedPnlPct = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;

    trade.status = TRADE_STATUSES.CLOSED;
    trade.exitPrice = exitPrice;
    trade.exitDate = new Date();
    trade.exitReason = exitReason;
    trade.realizedPnl = Math.round(realizedPnl * 100) / 100;
    trade.realizedPnlPct = Math.round(realizedPnlPct * 100) / 100;
    if (notes) trade.notes = notes;

    await trade.save();

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
