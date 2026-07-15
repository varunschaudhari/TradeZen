/**
 * @file test.js
 * @description POST /api/test/telegram — send a test message to the configured
 *              Telegram chat to verify alert delivery.
 * @author TradeZen Team
 * @created 2026-06-20
 */

import express from 'express';
import { sendTestMessage } from '../services/notifier.js';

const router = express.Router();

// POST /api/test/telegram  body: { message?: string }
router.post('/telegram', async (req, res, next) => {
  try {
    const result = await sendTestMessage(req.body?.message, req.userId);
    if (!result.ok) {
      return res.status(503).json({ success: false, error: result.reason, code: 503 });
    }
    res.json({ success: true, data: result, message: 'Test message sent to Telegram' });
  } catch (err) {
    next(err);
  }
});

export default router;
