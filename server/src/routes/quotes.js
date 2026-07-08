/**
 * @file quotes.js
 * @description REST route — batch live price snapshots via the quote facade
 *   (NSE near-real-time first, yfinance fallback; see quoteService.js).
 *   GET /api/quotes?symbols=RELIANCE,TCS,INFY
 * @author SwingTrader AI Team
 */

import express from 'express';
import { getQuotes } from '../services/quoteService.js';
import { logger } from '../config/logger.js';

const router = express.Router();

const MAX_SYMBOLS = 60;

// GET /api/quotes?symbols=A,B,C
router.get('/', async (req, res, next) => {
  try {
    const raw = String(req.query.symbols ?? '');
    const symbols = raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z]{1,20}$/.test(s))
      .slice(0, MAX_SYMBOLS);

    if (symbols.length === 0) {
      return res.json({ success: true, data: {}, message: 'No valid symbols supplied' });
    }

    const quotes = await getQuotes(symbols);
    res.json({ success: true, data: quotes, message: `${Object.keys(quotes).length} quotes` });
  } catch (err) {
    logger.error('GET /api/quotes failed', { error: err.message });
    next(err);
  }
});

export default router;
