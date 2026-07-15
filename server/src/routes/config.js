/**
 * @file config.js
 * @description REST routes for app configuration (singleton Config document)
 *   GET  /api/config       — read current config (capital, risk %, notifications, etc.)
 *   PATCH /api/config      — update specific config fields (partial update via $set)
 * @author SwingTrader AI Team
 */

import express from 'express';
import Joi from 'joi';
import Config from '../models/Config.js';
import { validateBody } from '../middleware/validateRequest.js';

const router = express.Router();

const updateSchema = Joi.object({
  capital: Joi.number().min(10000).optional(),
  riskPercentage: Joi.number().min(0.1).max(5).optional(),
  // Ceilings mirror the Config Mongoose schema's own bounds (models/Config.js) — Joi was
  // previously stricter than the schema for no reason, silently rejecting values the
  // system itself allows.
  maxOpenTrades: Joi.number().integer().min(1).max(20).optional(),
  maxCapitalDeployedPct: Joi.number().min(10).max(100).optional(),
  telegramChatId: Joi.string().allow('').optional(),
  emailRecipient: Joi.string().email({ tlds: { allow: false } }).allow('').optional(),
  paperTradeMode: Joi.boolean().optional(),
  scannerEnabled: Joi.boolean().optional(),
  autoPaperTrade: Joi.boolean().optional(),
}).min(1);

// GET /api/config
router.get('/', async (req, res, next) => {
  try {
    const config = await Config.findOne({ userId: req.userId }).lean();
    if (!config) {
      return res.status(404).json({ success: false, error: 'Config not found — contact an admin', code: 404 });
    }
    res.json({ success: true, data: config, message: 'Config retrieved' });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/config
router.patch('/', validateBody(updateSchema), async (req, res, next) => {
  try {
    const config = await Config.findOneAndUpdate(
      { userId: req.userId },
      { $set: req.body },
      { new: true, lean: true }
    );
    if (!config) {
      return res.status(404).json({ success: false, error: 'Config not found — contact an admin', code: 404 });
    }
    res.json({ success: true, data: config, message: 'Config updated' });
  } catch (err) {
    next(err);
  }
});

export default router;
