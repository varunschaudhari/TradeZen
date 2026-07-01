/**
 * @file alerts.js
 * @description REST routes for user-set price alerts.
 *   GET    /api/alerts          — list all alerts (newest first)
 *   POST   /api/alerts          — create alert { symbol, targetPrice, direction, note? }
 *   PATCH  /api/alerts/:id/toggle — flip active flag
 *   DELETE /api/alerts/:id      — remove alert
 */

import express from 'express';
import PriceAlert from '../models/PriceAlert.js';
import { logger } from '../config/logger.js';

const router = express.Router();

// GET /api/alerts
router.get('/', async (_req, res, next) => {
  try {
    const alerts = await PriceAlert.find().sort({ createdAt: -1 });
    res.json({ success: true, data: alerts });
  } catch (err) {
    next(err);
  }
});

// POST /api/alerts
router.post('/', async (req, res, next) => {
  try {
    const { symbol, targetPrice, direction, note } = req.body;

    if (!symbol || targetPrice == null || !direction) {
      return res.status(400).json({ success: false, error: 'symbol, targetPrice, and direction are required' });
    }
    if (!['above', 'below'].includes(direction)) {
      return res.status(400).json({ success: false, error: 'direction must be "above" or "below"' });
    }

    const alert = await PriceAlert.create({
      symbol:      String(symbol).toUpperCase().trim(),
      targetPrice: Number(targetPrice),
      direction,
      note:        note ? String(note).trim() : '',
    });

    logger.info('Price alert created', { symbol: alert.symbol, targetPrice: alert.targetPrice, direction });
    res.status(201).json({ success: true, data: alert });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/alerts/:id/toggle
router.patch('/:id/toggle', async (req, res, next) => {
  try {
    const alert = await PriceAlert.findById(req.params.id);
    if (!alert) return res.status(404).json({ success: false, error: 'Alert not found' });

    alert.active = !alert.active;
    if (alert.active) alert.triggeredAt = null; // re-activating resets trigger
    await alert.save();

    res.json({ success: true, data: alert });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/alerts/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await PriceAlert.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Alert not found' });
    res.json({ success: true, message: 'Alert deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
