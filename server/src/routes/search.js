/**
 * @file search.js
 * @description Global search across Signal + Trade collections.
 *
 * GET /api/search?q=RELIANCE&limit=5
 * Returns signals and trades whose symbol matches the query (prefix, case-insensitive).
 * Also cross-checks the Config watchlist for quick navigation.
 */

import express from 'express';
import Signal from '../models/Signal.js';
import Trade from '../models/Trade.js';
import Config from '../models/Config.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json({ query: '', signals: [], trades: [], watchlist: [] });

    const limit = Math.min(parseInt(req.query.limit, 10) || 5, 10);

    // Sanitise: allow only alphanumeric + common symbol chars (&, ., -)
    const safe = q.replace(/[^A-Za-z0-9&.\-]/g, '');
    if (!safe) return res.json({ query: q, signals: [], trades: [], watchlist: [] });

    const regex = new RegExp(safe, 'i');

    const [signals, trades, config] = await Promise.all([
      Signal.find({ symbol: { $regex: regex } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select('symbol verdict confidence compositeScore gatesPassed createdAt entryZone stopLoss target1 target2')
        .lean(),

      Trade.find({ userId: req.userId, symbol: { $regex: regex } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select('symbol status entryPrice entryDate exitPrice exitDate realizedPnl realizedPnlPct exitReason')
        .lean(),

      Config.findOne({ userId: req.userId }).select('watchlist').lean(),
    ]);

    const watchlist = (config?.watchlist ?? [])
      .filter((w) => regex.test(w.symbol))
      .slice(0, 5)
      .map(({ symbol, sector }) => ({ symbol, sector }));

    res.json({ query: q, signals, trades, watchlist });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
