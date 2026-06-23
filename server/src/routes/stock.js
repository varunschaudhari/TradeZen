/**
 * @file stock.js
 * @description REST route — full on-demand stock detail for the dedicated stock page.
 *   GET /api/stock/:symbol — Python analysis + fundamentals (P/E, market cap, sector)
 *                            merged with the latest persisted Signal for that symbol.
 * @author SwingTrader AI Team
 */

import express from 'express';
import { fetchStockDetail } from '../services/pythonBridge.js';
import Signal from '../models/Signal.js';
import { logger } from '../config/logger.js';

const router = express.Router();

// GET /api/stock/:symbol
router.get('/:symbol', async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    if (!/^[A-Z]{1,20}$/.test(symbol)) {
      return res.status(400).json({ success: false, error: 'Invalid symbol format', code: 400 });
    }

    // Run live analysis and pull the latest signal in parallel. The signal is
    // optional context — a stock with no signal still has a full detail view.
    const [detail, latestSignal] = await Promise.all([
      fetchStockDetail(symbol),
      Signal.findOne({ symbol }).sort({ createdAt: -1 }).lean().catch(() => null),
    ]);

    res.json({
      success: true,
      data: { ...detail, signal: latestSignal ?? null },
      message: `Detail for ${symbol}`,
    });
  } catch (err) {
    logger.error('GET /api/stock/:symbol failed', { error: err.message });
    next(err);
  }
});

export default router;
