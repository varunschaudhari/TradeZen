/**
 * @file analysis.js
 * @description REST routes for comprehensive stock analysis reports
 * GET /api/analysis/:symbol — Full 10-section analysis report
 */

import express from 'express';
import { generateAnalysisReport } from '../services/analysisReport.js';
import { logger } from '../config/logger.js';

const router = express.Router();

// GET /api/analysis/:symbol
router.get('/:symbol', async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    if (!/^[A-Z]{1,20}$/.test(symbol)) {
      return res.status(400).json({ success: false, error: 'Invalid symbol format', code: 400 });
    }

    // Generate comprehensive analysis. Market data is fetched inside the service —
    // in parallel with stock detail on a cache miss, and skipped entirely on a cache hit.
    const report = await generateAnalysisReport(symbol, null, req.userId);

    res.json({
      success: true,
      data: report,
      message: `Analysis report for ${symbol}`,
    });
  } catch (err) {
    logger.error('GET /api/analysis/:symbol failed', { error: err.message });
    next(err);
  }
});

export default router;
