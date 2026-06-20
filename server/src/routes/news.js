/**
 * @file news.js
 * @description REST route for on-demand news and sentiment for a stock symbol
 *   GET /api/news/:symbol — fetch headlines + sentiment (cached 30 min in newsFetcher)
 * @author SwingTrader AI Team
 */

import express from 'express';
import { fetchNewsAndSentiment } from '../services/newsFetcher.js';
import { logger } from '../config/logger.js';

const router = express.Router();

// GET /api/news/:symbol
router.get('/:symbol', async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    if (!/^[A-Z]{1,20}$/.test(symbol)) {
      return res.status(400).json({ success: false, error: 'Invalid symbol format', code: 400 });
    }

    const newsData = await fetchNewsAndSentiment(symbol);
    res.json({
      success: true,
      data: newsData,
      message: `News retrieved for ${symbol} (${newsData.headlines.length} headlines)`,
    });
  } catch (err) {
    logger.error('News route error', { error: err.message });
    next(err);
  }
});

export default router;
