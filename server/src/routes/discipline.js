/**
 * @file discipline.js
 * @description REST route for the discipline ledger — the measured value of the
 *   system's NOs.
 *   GET /api/discipline — aggregate summary + recent blocked trades
 * @author TradeZen Team
 * @created 2026-07-07
 */

import express from 'express';
import BlockedTrade from '../models/BlockedTrade.js';
import { getLedgerSummary } from '../services/disciplineLedger.js';

const router = express.Router();

// GET /api/discipline?limit=30
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? '30', 10) || 30, 200);
    const [summary, recent] = await Promise.all([
      getLedgerSummary(),
      BlockedTrade.find().sort({ blockedAt: -1 }).limit(limit).lean(),
    ]);
    res.json({ success: true, data: { summary, recent }, message: 'Discipline ledger' });
  } catch (err) {
    next(err);
  }
});

export default router;
