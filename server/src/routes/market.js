/**
 * @file market.js
 * @description REST route — proxies live market data from Python service
 *   GET /api/market — current Nifty 50, VIX, A/D ratio, and market mode
 * @author SwingTrader AI Team
 */

import express from 'express';
import { fetchMarketData } from '../services/pythonBridge.js';
import Config from '../models/Config.js';
import { NSE_HOLIDAY_LIST } from '../config/constants.js';
import { logger } from '../config/logger.js';

const router = express.Router();

function getNextHoliday() {
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const todayStr = nowIST.toISOString().slice(0, 10);
  const upcoming = NSE_HOLIDAY_LIST
    .filter((h) => h.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!upcoming.length) return null;
  const next = upcoming[0];
  const diffMs = new Date(next.date) - new Date(todayStr);
  const daysAway = Math.round(diffMs / 86_400_000);
  return { date: next.date, name: next.name, daysAway };
}

// GET /api/market
router.get('/', async (_req, res, next) => {
  try {
    const [marketData, config] = await Promise.all([
      fetchMarketData(),
      Config.findOne().lean().catch(() => null),
    ]);
    // Flatten the nested Python response into the shape the frontend expects.
    // Python returns nifty50.price / nifty50.change / nifty50.changePct;
    // the client reads niftyPrice / niftyChange / niftyChangePct.
    const n = marketData?.nifty50 ?? {};
    const b = marketData?.bankNifty ?? {};
    res.json({
      success: true,
      data: {
        niftyPrice:     n.price     ?? null,
        niftyChange:    n.change    ?? null,
        niftyChangePct: n.changePct ?? null,
        bankNiftyPrice: b.price     ?? null,
        vix:            marketData?.vix     ?? null,
        adRatio:        marketData?.adRatio ?? null,
        marketMode:     config?.marketMode  ?? null,
        nextHoliday:    getNextHoliday(),
      },
      message: 'Market data retrieved',
    });
  } catch (err) {
    logger.error('GET /api/market failed', { error: err.message });
    next(err);
  }
});

export default router;
