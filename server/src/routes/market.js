/**
 * @file market.js
 * @description REST route — proxies live market data from Python service
 *   GET /api/market — current Nifty 50, VIX, A/D ratio, and market mode
 * @author SwingTrader AI Team
 */

import express from 'express';
import { fetchMarketData } from '../services/pythonBridge.js';
import Config from '../models/Config.js';
import { logger } from '../config/logger.js';

const router = express.Router();

// GET /api/market
router.get('/', async (_req, res, next) => {
  try {
    const [marketData, config] = await Promise.all([
      fetchMarketData(),
      Config.findOne().lean().catch(() => null),
    ]);
    res.json({
      success: true,
      data: { ...marketData, marketMode: config?.marketMode ?? marketData?.marketMode },
      message: 'Market data retrieved',
    });
  } catch (err) {
    logger.error('GET /api/market failed', { error: err.message });
    next(err);
  }
});

export default router;
