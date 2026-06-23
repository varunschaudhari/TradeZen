/**
 * @file universe.js
 * @description REST route — the static NSE universe symbol list, for search autocomplete.
 *   GET /api/universe — { symbols: string[], count }
 * @author SwingTrader AI Team
 */

import express from 'express';
import { fetchUniverse } from '../services/pythonBridge.js';
import { logger } from '../config/logger.js';

const router = express.Router();

// Cache the universe in-process — it is a static list that changes rarely, so there is
// no reason to hit the Python service on every keystroke-driven autocomplete load.
let cache = null;
let cachedAt = 0;
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// GET /api/universe
router.get('/', async (_req, res, next) => {
  try {
    const now = Date.now();
    if (!cache || now - cachedAt > TTL_MS) {
      const symbols = await fetchUniverse();
      if (symbols.length) {
        cache = symbols;
        cachedAt = now;
      }
    }
    const symbols = cache ?? [];
    res.json({ success: true, data: { symbols, count: symbols.length }, message: `${symbols.length} symbols` });
  } catch (err) {
    logger.error('GET /api/universe failed', { error: err.message });
    next(err);
  }
});

export default router;
