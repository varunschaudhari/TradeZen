/**
 * @file watchlist.js
 * @description REST routes for the stock watchlist stored in Config
 *   GET    /api/watchlist          — current watchlist
 *   POST   /api/watchlist          — add a stock (symbol + optional sector)
 *   PATCH  /api/watchlist/:symbol  — update notes on a watchlist item
 *   DELETE /api/watchlist/:symbol  — remove a stock
 * @author SwingTrader AI Team
 */

import express from 'express';
import Joi from 'joi';
import Config from '../models/Config.js';
import { validateBody } from '../middleware/validateRequest.js';
import { logger } from '../config/logger.js';

const router = express.Router();

const addSchema = Joi.object({
  symbol: Joi.string().uppercase().alphanum().min(1).max(20).required(),
  sector: Joi.string().max(50).allow('').optional(),
});

const noteSchema = Joi.object({
  notes: Joi.string().max(300).allow('').required(),
});

// GET /api/watchlist
router.get('/', async (_req, res, next) => {
  try {
    const config = await Config.findOne().lean();
    const watchlist = config?.watchlist ?? [];
    res.json({ success: true, data: watchlist, message: `${watchlist.length} stocks in watchlist` });
  } catch (err) {
    next(err);
  }
});

// POST /api/watchlist
router.post('/', validateBody(addSchema), async (req, res, next) => {
  try {
    const { symbol, sector } = req.body;

    // Prevent duplicates
    const existing = await Config.findOne({ 'watchlist.symbol': symbol }).lean();
    if (existing) {
      return res.status(409).json({
        success: false,
        error: `${symbol} is already in the watchlist`,
        code: 409,
      });
    }

    const config = await Config.findOneAndUpdate(
      {},
      { $push: { watchlist: { symbol, sector: sector || '' } } },
      { upsert: true, new: true }
    ).lean();

    const added = config.watchlist.find((w) => w.symbol === symbol);
    logger.info('Watchlist: added', { symbol, sector });
    res.status(201).json({ success: true, data: added, message: `${symbol} added to watchlist` });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/watchlist/:symbol — update notes on a watchlist item
router.patch('/:symbol', validateBody(noteSchema), async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const { notes } = req.body;

    const result = await Config.findOneAndUpdate(
      { 'watchlist.symbol': symbol },
      { $set: { 'watchlist.$.notes': notes } },
      { new: true }
    ).lean();

    if (!result) {
      return res.status(404).json({ success: false, error: `${symbol} not found in watchlist`, code: 404 });
    }

    const updated = result.watchlist.find((w) => w.symbol === symbol);
    logger.info('Watchlist: notes updated', { symbol });
    res.json({ success: true, data: updated, message: `Notes updated for ${symbol}` });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/watchlist/:symbol
router.delete('/:symbol', async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();

    const result = await Config.updateOne(
      {},
      { $pull: { watchlist: { symbol } } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({
        success: false,
        error: `${symbol} not found in watchlist`,
        code: 404,
      });
    }

    logger.info('Watchlist: removed', { symbol });
    res.json({ success: true, data: null, message: `${symbol} removed from watchlist` });
  } catch (err) {
    next(err);
  }
});

export default router;
