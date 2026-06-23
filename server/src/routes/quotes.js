/**
 * @file quotes.js
 * @description REST route — batch live price snapshots proxied from the Python service.
 *   GET /api/quotes?symbols=RELIANCE,TCS,INFY
 * @author SwingTrader AI Team
 */

import express from 'express';
import { fetchQuotes } from '../services/pythonBridge.js';
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

    const quotes = await fetchQuotes(symbols);
    res.json({ success: true, data: quotes, message: `${Object.keys(quotes).length} quotes` });
  } catch (err) {
    logger.error('GET /api/quotes failed', { error: err.message });
    next(err);
  }
});

export default router;
