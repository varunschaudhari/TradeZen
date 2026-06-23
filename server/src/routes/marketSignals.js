/**
 * @file marketSignals.js
 * @description Market-regime signal routes.
 *   GET   /api/market-signals — current FII flow, P/C ratio, sector ranking
 *   PATCH /api/market-signals — manually set them (operator override / daily input)
 * @author TradeZen Team
 * @created 2026-06-21
 */

import express from 'express';
import { getMarketSignals, setMarketSignals } from '../services/marketSignals.js';

const router = express.Router();

// GET /api/market-signals
router.get('/', async (_req, res, next) => {
  try {
    const signals = await getMarketSignals();
    res.json({ success: true, data: signals, message: 'Current market signals' });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/market-signals  body: { fiiTrend?, fiiNetBuy3d?, pcRatio?, topSectors?, bottomSectors? }
router.patch('/', async (req, res, next) => {
  try {
    const updated = await setMarketSignals(req.body ?? {}, 'manual');
    res.json({ success: true, data: updated, message: 'Market signals updated' });
  } catch (err) {
    if (/Invalid fiiTrend/.test(err.message)) {
      return res.status(400).json({ success: false, error: err.message, code: 400 });
    }
    next(err);
  }
});

export default router;
