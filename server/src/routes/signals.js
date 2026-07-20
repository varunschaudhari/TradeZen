/**
 * @file signals.js
 * @description REST routes for trading signals
 *   GET  /api/signals         — latest 100 signals (optional ?verdict=BUY|WAIT|SKIP)
 *   GET  /api/signals/active  — active BUY + WAIT signals
 *   GET  /api/signals/:symbol — signal history for one NSE symbol
 *   POST /api/signals/scan    — trigger a manual scan cycle (non-blocking)
 * @author SwingTrader AI Team
 */

import express from 'express';
import Signal from '../models/Signal.js';
import Config from '../models/Config.js';
import MarketState from '../models/MarketState.js';
import { runFullScan, resolveGuards, effectiveVerdict } from '../scheduler/scanPipeline.js';
import { evaluateSymbols } from '../services/stockDiscovery.js';
import { decideVerdict } from '../services/verdictEngine.js';
import { checkGate7 } from '../services/gateChecker.js';
import { logger } from '../config/logger.js';
import { VERDICTS } from '../config/constants.js';

const router = express.Router();
const VALID_VERDICTS = new Set(Object.values(VERDICTS));

const VALID_CONFIDENCE = new Set(['HIGH', 'MEDIUM', 'LOW']);

/**
 * Decorate BUY-quality signals with this user's own actionability — the same
 * portfolio-capacity guards applied at scan time (see scanPipeline.js's
 * applyPerUserActioning), computed at read time instead of baked into the shared
 * Signal doc. Adds `myActionability: { verdict, waitCondition }` to each BUY signal;
 * WAIT/SKIP signals pass through unchanged (capacity guards only ever downgrade a BUY).
 *
 * Watchlist membership is checked FIRST, same as applyPerUserActioning's own gate —
 * a BUY signal for a symbol nobody is watching never reaches the capacity guards at
 * scan time (auto-open never even considers it), so it shouldn't look identically
 * actionable here either. Without this, a signal for an untracked symbol showed the
 * same "BUY" the whole feed shares, with no hint it will never auto-open.
 *
 * @param {object[]} signals - Plain signal objects (already .lean())
 * @param {string} userId
 * @returns {Promise<object[]>}
 */
async function decorateWithActionability(signals, userId) {
  if (!signals.some((s) => s.verdict === VERDICTS.BUY)) return signals;
  const [config, marketState] = await Promise.all([
    Config.findOne({ userId }).lean(),
    MarketState.findOne().select('marketMode').lean(),
  ]);
  if (!config) return signals;
  const watchlistSymbols = new Set((config.watchlist ?? []).map((w) => w.symbol));
  const guards = await resolveGuards(config, marketState?.marketMode ?? null);
  return signals.map((s) => {
    if (s.verdict !== VERDICTS.BUY) return s;
    if (!watchlistSymbols.has(s.symbol)) {
      return {
        ...s,
        myActionability: {
          verdict: VERDICTS.WAIT,
          waitCondition: 'Not on your watchlist — add it to track and auto-open',
        },
      };
    }
    return { ...s, myActionability: effectiveVerdict(s.verdict, s.waitCondition, guards, s.sector ?? null) };
  });
}

// GET /api/signals
// Query params: verdict, confidence, minGates, from (YYYY-MM-DD), to (YYYY-MM-DD), limit (max 500)
router.get('/', async (req, res, next) => {
  try {
    const filter = {};

    if (req.query.verdict && VALID_VERDICTS.has(req.query.verdict)) {
      filter.verdict = req.query.verdict;
    }
    if (req.query.confidence && VALID_CONFIDENCE.has(req.query.confidence)) {
      filter.confidence = req.query.confidence;
    }

    const minGates = parseInt(req.query.minGates, 10);
    if (!isNaN(minGates) && minGates > 0) {
      filter.gatesPassed = { $gte: minGates };
    }

    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) {
        const to = new Date(req.query.to);
        to.setUTCHours(23, 59, 59, 999);
        filter.createdAt.$lte = to;
      }
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    const signals = await Signal.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    const decorated = await decorateWithActionability(signals, req.userId);
    res.json({ success: true, data: decorated, message: `${signals.length} signals retrieved` });
  } catch (err) {
    next(err);
  }
});

// GET /api/signals/active  — must be before /:symbol
router.get('/active', async (req, res, next) => {
  try {
    const signals = await Signal.find({
      isActive: true,
      verdict: { $in: [VERDICTS.BUY, VERDICTS.WAIT] },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    const decorated = await decorateWithActionability(signals, req.userId);
    res.json({ success: true, data: decorated, message: `${signals.length} active signals` });
  } catch (err) {
    next(err);
  }
});

// POST /api/signals/scan — must be before /:symbol
router.post('/scan', async (_req, res, next) => {
  try {
    // Fire-and-forget: caller gets 202 immediately; scan emits socket events as it runs.
    // forceRun: true — an explicit manual trigger overrides the market-hours guard
    // (the automatic cron still respects market hours). Uses last-close data after hours.
    runFullScan({ forceRun: true }).catch((err) =>
      logger.error('Manual scan cycle failed', { error: err.message })
    );
    res.status(202).json({ success: true, data: null, message: 'Scan cycle started' });
  } catch (err) {
    next(err);
  }
});

// POST /api/signals/test — full 8-gate + deterministic-verdict check for one symbol
// (no persistence). Must be before /:symbol. Body: { symbol: "ICICIBANK" }
router.post('/test', async (req, res, next) => {
  try {
    const symbol = String(req.body?.symbol ?? '')
      .replace(/\.NS$/i, '')
      .toUpperCase();
    if (!symbol) {
      return res
        .status(400)
        .json({ success: false, error: 'Body must include "symbol"', code: 400 });
    }
    const cfg = await Config.findOne({ userId: req.userId })
      .lean()
      .catch(() => null);
    const capital = cfg?.capital ?? 1_000_000;

    const { marketData, candidates } = await evaluateSymbols([symbol], {
      capital,
      riskPct: cfg?.riskPercentage ?? 1,
    });
    const candidate = candidates[0];
    if (!candidate || candidate.error) {
      return res
        .status(422)
        .json({ success: false, error: candidate?.error ?? 'No analysis available', code: 422 });
    }

    const { stockData, gateResult, newsData } = candidate;
    // Same qualification bar as the live scan: hard block or <5 gates never gets a verdict.
    let analysis = null;
    if (gateResult.shouldCallClaude) {
      analysis = decideVerdict(stockData, marketData, gateResult);
      gateResult.gateDetails.gate7 = checkGate7(analysis, marketData);
    }

    res.json({
      success: true,
      data: {
        symbol,
        marketMode: marketData?.marketMode,
        adRatio: marketData?.adRatio,
        currentPrice: stockData.currentPrice,
        gatesPassed: gateResult.gatesPassed,
        hardBlockFired: gateResult.hardBlockFired,
        shouldCallClaude: gateResult.shouldCallClaude,
        compositeScore: gateResult.compositeScore,
        scoreConfidence: gateResult.scoreConfidence,
        tags: gateResult.tags,
        gateDetails: gateResult.gateDetails,
        indicators: stockData.indicators,
        news: {
          sentiment: newsData.sentiment,
          score: newsData.score,
          headlines: newsData.headlines,
        },
        verdict: analysis?.verdict ?? (gateResult.hardBlockFired ? 'SKIP' : 'WAIT'),
        confidence: analysis?.confidence ?? null,
        analysis: analysis
          ? {
              verdict: analysis.verdict,
              confidence: analysis.confidence,
              setupType: analysis.setupType,
              entryZone: analysis.entryZone,
              stopLoss: analysis.stopLoss,
              target1: analysis.target1,
              target2: analysis.target2,
              riskReward: analysis.riskReward,
              reasoning: analysis.reasoning,
              keyRisks: analysis.keyRisks,
            }
          : null,
      },
      message: `Full check for ${symbol}`,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/signals/export — CSV download (must be before /:symbol)
router.get('/export', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.verdict && VALID_VERDICTS.has(req.query.verdict))         filter.verdict    = req.query.verdict;
    if (req.query.confidence && VALID_CONFIDENCE.has(req.query.confidence)) filter.confidence = req.query.confidence;
    const minGates = parseInt(req.query.minGates, 10);
    if (!isNaN(minGates) && minGates > 0) filter.gatesPassed = { $gte: minGates };
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) {
        const to = new Date(req.query.to);
        to.setUTCHours(23, 59, 59, 999);
        filter.createdAt.$lte = to;
      }
    }
    const signals = await Signal.find(filter).sort({ createdAt: -1 }).limit(1000).lean();
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
    const header = ['Date','Symbol','Verdict','Confidence','Entry Low','Entry High','Stop Loss','Target 1','Target 2','Risk:Reward','Gates Passed','New Sentiment','Reasoning'];
    const rows = signals.map((s) => [
      new Date(s.createdAt).toISOString().slice(0, 10),
      s.symbol,
      s.verdict,
      s.confidence ?? '',
      s.entryZone?.low ?? '',
      s.entryZone?.high ?? '',
      s.stopLoss ?? '',
      s.target1 ?? '',
      s.target2 ?? '',
      s.riskReward ?? '',
      s.gatesPassed ?? '',
      s.newsSentiment ?? '',
      s.reasoning ?? '',
    ].map(esc).join(','));
    const csv = '﻿' + [header.map(esc).join(','), ...rows].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="signals.csv"');
    res.send(csv);
  } catch (err) { next(err); }
});

// GET /api/signals/:symbol
router.get('/:symbol', async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const signals = await Signal.find({ symbol }).sort({ createdAt: -1 }).limit(20).lean();
    res.json({
      success: true,
      data: signals,
      message: signals.length
        ? `${signals.length} signals for ${symbol}`
        : `No signals found for ${symbol}`,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
