/**
 * @file backtest.js
 * @description Backtest REST endpoints — setup replay (single entry/SL/T1/T2) and
 *              walk-forward (multi-symbol, hold-mode comparison + signal edge).
 *
 * Routes:
 *   POST /api/backtest/setup        — single setup replay, results cached 30d
 *   POST /api/backtest/run          — walk-forward across symbols/modes
 *   POST /api/backtest/signal-edge  — per-flag edge analysis
 *   GET  /api/backtest/results      — list cached BacktestResult documents
 */

import express from 'express';
import Joi from 'joi';
import { runBacktest, runSignalEdge, backtestSetup } from '../services/backtestEngine.js';
import BacktestResult from '../models/BacktestResult.js';
import Config from '../models/Config.js';
import { logger } from '../config/logger.js';
import { validateBody } from '../middleware/validateRequest.js';

const router = express.Router();

const SYMBOL_STR = Joi.string().uppercase().pattern(/^[A-Z]{1,20}$/).required();

// ── POST /api/backtest/setup ─────────────────────────────────────────────────
router.post(
  '/setup',
  validateBody(
    Joi.object({
      symbol:   SYMBOL_STR,
      entry:    Joi.number().positive().required(),
      stopLoss: Joi.number().positive().required(),
      target1:  Joi.number().positive().required(),
      target2:  Joi.number().positive().required(),
    })
  ),
  async (req, res) => {
    try {
      const { symbol, entry, stopLoss, target1, target2 } = req.body;

      // Serve from cache if an identical setup was run recently
      const cached = await BacktestResult.findOne({ symbol, entry, stopLoss, target1, target2 });
      if (cached) {
        return res.json({ success: true, cached: true, result: cached });
      }

      const raw = await backtestSetup(symbol, entry, stopLoss, target1, target2);
      if (!raw) {
        return res.status(422).json({ success: false, error: 'No backtest data — is the Python service running?' });
      }

      const rr    = entry > stopLoss ? +((target2 - entry) / (entry - stopLoss)).toFixed(2) : 0;
      const now   = new Date();
      const start = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
      const tot   = raw.tradesSimulated;
      const timeouts = Math.max(0, tot - (raw.winsAtT1 ?? 0) - (raw.winsAtT2 ?? 0) - (raw.losses ?? 0));
      const sampleSize = tot < 5 ? 'SMALL' : tot <= 10 ? 'MEDIUM' : 'LARGE';
      const assessment  = raw.performanceAssessment === 'NO_TRADES' ? 'INSUFFICIENT_DATA' : raw.performanceAssessment;

      const doc = await BacktestResult.create({
        symbol,
        entry, stopLoss, target1, target2,
        riskReward:          rr,
        backtestPeriod:      '2y',
        startDate:           start,
        endDate:             now,
        sampleSize,
        tradesSimulated:     tot,
        winsAtT1:            raw.winsAtT1  ?? 0,
        winsAtT2:            raw.winsAtT2  ?? 0,
        losses:              raw.losses    ?? 0,
        timeouts,
        winRate:             raw.winRate,
        winRateT1:           raw.winRateT1,
        winRateT2:           raw.winRateT2,
        lossRate:            tot ? +((raw.losses / tot) * 100).toFixed(2) : 0,
        avgRealizedRR:       raw.avgRealizedRR,
        avgHoldingDays:      raw.avgHoldingDays,
        largestWin:          raw.largestWin  ?? 0,
        largestLoss:         raw.largestLoss ?? 0,
        maxConsecutiveWins:  raw.maxConsecutiveWins ?? 0,
        performanceAssessment: assessment,
        trades:              raw.trades ?? [],
      });

      res.json({ success: true, cached: false, result: doc });
    } catch (err) {
      logger.error('Backtest setup error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ── POST /api/backtest/run ───────────────────────────────────────────────────
router.post(
  '/run',
  validateBody(
    Joi.object({
      symbols:      Joi.array().items(Joi.string().uppercase().pattern(/^[A-Z]{1,20}$/)).max(30).default([]),
      period:       Joi.string().valid('1y', '2y').default('2y'),
      modes:        Joi.array().items(Joi.string().valid('fixed', 'linear', 'adaptive')).min(1).default(['fixed', 'adaptive']),
      useWatchlist: Joi.boolean().default(false),
    })
  ),
  async (req, res) => {
    try {
      let { symbols, period, modes, useWatchlist } = req.body;

      if (useWatchlist || !symbols.length) {
        const config = await Config.findOne({ userId: req.userId });
        symbols = config?.watchlist?.map((w) => w.symbol) ?? [];
      }

      if (!symbols.length) {
        return res.status(400).json({ success: false, error: 'No symbols — add stocks to watchlist or provide symbols array' });
      }

      const result = await runBacktest(symbols, { period, modes });
      res.json({ success: true, ...result });
    } catch (err) {
      logger.error('Backtest run error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ── POST /api/backtest/signal-edge ───────────────────────────────────────────
router.post(
  '/signal-edge',
  validateBody(
    Joi.object({
      symbols:      Joi.array().items(Joi.string().uppercase().pattern(/^[A-Z]{1,20}$/)).max(30).default([]),
      period:       Joi.string().valid('1y', '2y').default('2y'),
      holdMode:     Joi.string().valid('fixed', 'linear', 'adaptive').default('adaptive'),
      useWatchlist: Joi.boolean().default(false),
    })
  ),
  async (req, res) => {
    try {
      let { symbols, period, holdMode, useWatchlist } = req.body;

      if (useWatchlist || !symbols.length) {
        const config = await Config.findOne({ userId: req.userId });
        symbols = config?.watchlist?.map((w) => w.symbol) ?? [];
      }

      if (!symbols.length) {
        return res.status(400).json({ success: false, error: 'No symbols to analyze' });
      }

      const result = await runSignalEdge(symbols, { period, holdMode });
      res.json({ success: true, ...result });
    } catch (err) {
      logger.error('Signal edge error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ── GET /api/backtest/results ─────────────────────────────────────────────────
router.get('/results', async (req, res) => {
  try {
    const filter = {};
    if (req.query.symbol) filter.symbol = req.query.symbol.toUpperCase();
    const results = await BacktestResult.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .select('-trades');
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
