/**
 * @file ohlcv.js
 * @description REST route — proxies OHLCV candle data from Python service for charting
 *   GET /api/ohlcv/:symbol?period=60d&interval=15m
 * @author SwingTrader AI Team
 */

import express from 'express';
import { fetchOhlcv } from '../services/pythonBridge.js';
import { logger } from '../config/logger.js';

const router = express.Router();

const ALLOWED_PERIODS = new Set(['5d', '15d', '30d', '60d', '90d', '6mo', '1y']);
const ALLOWED_INTERVALS = new Set(['5m', '15m', '30m', '1h', '1d']);

// GET /api/ohlcv/:symbol
router.get('/:symbol', async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    if (!/^[A-Z]{1,20}$/.test(symbol)) {
      return res.status(400).json({ success: false, error: 'Invalid symbol format', code: 400 });
    }

    const period = ALLOWED_PERIODS.has(req.query.period) ? req.query.period : '60d';
    const interval = ALLOWED_INTERVALS.has(req.query.interval) ? req.query.interval : '15m';

    const result = await fetchOhlcv(symbol, period, interval);
    res.json({ success: true, data: result, message: `${result.data?.length ?? 0} candles for ${symbol}` });
  } catch (err) {
    logger.error('OHLCV route error', { error: err.message });
    next(err);
  }
});

export default router;
