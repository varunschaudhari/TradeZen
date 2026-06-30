/**
 * @file scan.js
 * @description Scan-snapshot visibility routes.
 *   GET /api/scan/latest  — most recent LIVE per-cycle snapshot (funnel + every scanned stock)
 *   GET /api/scan/history — recent LIVE snapshot summaries (funnel + counts, no per-stock detail)
 *   GET /api/scan/prep    — most recent EOD prep snapshot (next-session watchlist)
 * @author TradeZen Team
 * @created 2026-06-20
 */

import express from 'express';
import ScanResult from '../models/ScanResult.js';

const router = express.Router();
const HISTORY_LIMIT = 20;

// GET /api/scan/latest — latest LIVE intraday scan
router.get('/latest', async (_req, res, next) => {
  try {
    const latest = await ScanResult.findOne({ scanType: 'LIVE' }).sort({ createdAt: -1 }).lean();
    if (!latest) {
      return res.json({ success: true, data: null, message: 'No scans recorded yet' });
    }
    res.json({
      success: true,
      data: latest,
      message: `Scan from ${latest.createdAt.toISOString()}`,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/scan/history — lightweight LIVE summaries (drops the per-stock array)
router.get('/history', async (_req, res, next) => {
  try {
    const scans = await ScanResult.find({ scanType: 'LIVE' })
      .sort({ createdAt: -1 })
      .limit(HISTORY_LIMIT)
      .select('-stocks -watchlist')
      .lean();
    res.json({ success: true, data: scans, message: `${scans.length} recent scans` });
  } catch (err) {
    next(err);
  }
});

// GET /api/scan/prep — latest EOD prep (next-session watchlist)
router.get('/prep', async (_req, res, next) => {
  try {
    const prep = await ScanResult.findOne({ scanType: 'EOD_PREP' }).sort({ createdAt: -1 }).lean();
    if (!prep) {
      return res.json({ success: true, data: null, message: 'No EOD prep scan recorded yet' });
    }
    res.json({
      success: true,
      data: prep,
      message: `EOD prep from ${prep.createdAt.toISOString()}`,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
