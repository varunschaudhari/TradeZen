/**
 * @file scan.js
 * @description Scan-snapshot visibility routes.
 *   GET /api/scan/latest  — most recent per-cycle snapshot (funnel + every scanned stock)
 *   GET /api/scan/history — recent snapshot summaries (funnel + counts, no per-stock detail)
 * @author TradeZen Team
 * @created 2026-06-20
 */

import express from 'express';
import ScanResult from '../models/ScanResult.js';

const router = express.Router();
const HISTORY_LIMIT = 20;

// GET /api/scan/latest
router.get('/latest', async (_req, res, next) => {
  try {
    const latest = await ScanResult.findOne().sort({ createdAt: -1 }).lean();
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

// GET /api/scan/history — lightweight summaries (drops the per-stock array)
router.get('/history', async (_req, res, next) => {
  try {
    const scans = await ScanResult.find()
      .sort({ createdAt: -1 })
      .limit(HISTORY_LIMIT)
      .select('-stocks')
      .lean();
    res.json({ success: true, data: scans, message: `${scans.length} recent scans` });
  } catch (err) {
    next(err);
  }
});

export default router;
