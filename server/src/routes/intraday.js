/**
 * @file intraday.js
 * @description REST routes for the intraday lane (experimental, paper-only). Three
 *   strategies (ORB, VWAP_REVERSION, MOMENTUM_CONTINUATION), both directions.
 *   GET   /api/intraday/stats            — aggregate stats (?source=SCANNER|MANUAL|ALL|ORB|VWAP_REVERSION|MOMENTUM_CONTINUATION, default SCANNER)
 *   GET   /api/intraday/signals          — recent IntradaySignal docs, newest first
 *   GET   /api/intraday/golive           — evidence gate per lane
 *   GET   /api/intraday/live             — today's session: open entries with live quotes + settled
 *   POST  /api/intraday/trades           — log a MANUAL intraday paper trade (LONG or SHORT)
 *   PATCH /api/intraday/trades/:id/close — close an open intraday entry (live quote if no price)
 * @author TradeZen Team
 * @created 2026-07-07
 * @lastModified 2026-07-09
 */

import express from 'express';
import Joi from 'joi';
import IntradaySignal from '../models/IntradaySignal.js';
import { ORB_PAPER_CAPITAL, ORB_PAPER_RISK_PCT } from '../config/constants.js';
import { evaluateGoLiveGate } from '../services/goLiveGate.js';
import { istSessionDate } from '../services/orbScanner.js';
import { getQuotes } from '../services/quoteService.js';
import { netAfterCosts } from '../services/tradingCosts.js';
import { validateBody } from '../middleware/validateRequest.js';
import { logger } from '../config/logger.js';

const router = express.Router();
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Source filter for the track record. Default (no param) and 'SCANNER' both mean "every
 * strategy combined, excluding MANUAL" — MANUAL logs must never blur the scanner's edge.
 * 'ALL' includes MANUAL too. A specific setupType (ORB | VWAP_REVERSION |
 * MOMENTUM_CONTINUATION) filters to that strategy alone.
 */
function sourceFilter(raw) {
  if (!raw) return { source: { $ne: 'MANUAL' } };
  const source = String(raw).toUpperCase();
  if (source === 'ALL') return {};
  if (source === 'SCANNER') return { source: { $ne: 'MANUAL' } };
  return { source }; // MANUAL, or an exact strategy name
}

// GET /api/intraday/stats — the two Phase 2 questions: is there an edge (win rate,
// avg R, paper P&L) and are alerts fresh enough to act on (avg latency)?
router.get('/stats', async (req, res, next) => {
  try {
    const signals = await IntradaySignal.find(sourceFilter(req.query.source)).lean();
    const settled = signals.filter((s) => s.exitReason != null);
    const wins = settled.filter((s) => (s.paperPnl ?? 0) > 0);
    const latencies = signals.filter((s) => s.alertLatencyMs != null);
    const avg = (arr, pick) =>
      arr.length ? arr.reduce((sum, x) => sum + (pick(x) ?? 0), 0) / arr.length : null;

    const byExit = {};
    for (const s of settled) byExit[s.exitReason] = (byExit[s.exitReason] ?? 0) + 1;

    // Per-strategy breakdown on the combined view — which of the three is actually
    // carrying the edge (or the losses) is exactly what decides where to focus next.
    const byStrategy = {};
    for (const s of settled) {
      const key = s.setupType ?? 'UNKNOWN';
      byStrategy[key] ??= { settled: 0, wins: 0, paperPnl: 0 };
      byStrategy[key].settled += 1;
      if ((s.paperPnl ?? 0) > 0) byStrategy[key].wins += 1;
      byStrategy[key].paperPnl = round2(byStrategy[key].paperPnl + (s.paperPnl ?? 0));
    }
    for (const key of Object.keys(byStrategy)) {
      const b = byStrategy[key];
      b.winRate = b.settled ? round2((b.wins / b.settled) * 100) : null;
    }

    res.json({
      success: true,
      data: {
        totalSignals: signals.length,
        settled: settled.length,
        pending: signals.length - settled.length,
        wins: wins.length,
        losses: settled.length - wins.length,
        winRate: settled.length ? round2((wins.length / settled.length) * 100) : null,
        avgResultPct: settled.length ? round2(avg(settled, (s) => s.resultPct)) : null,
        avgRMultiple: settled.length ? round2(avg(settled, (s) => s.rMultiple)) : null,
        totalPaperPnl: round2(settled.reduce((sum, s) => sum + (s.paperPnl ?? 0), 0)), // net
        totalGrossPnl: round2(settled.reduce((sum, s) => sum + (s.grossPnl ?? s.paperPnl ?? 0), 0)),
        totalEstCosts: round2(settled.reduce((sum, s) => sum + (s.estCosts ?? 0), 0)),
        avgLatencySec: latencies.length
          ? Math.round(avg(latencies, (s) => s.alertLatencyMs) / 1000)
          : null,
        byExitReason: byExit,
        byStrategy,
        paperCapital: ORB_PAPER_CAPITAL,
        paperRiskPct: ORB_PAPER_RISK_PCT,
      },
      message: 'Intraday experimental track record',
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/intraday/golive — the evidence gate: per-lane PASS/FAIL with hard thresholds
router.get('/golive', async (req, res, next) => {
  try {
    const gate = await evaluateGoLiveGate(req.userId);
    res.json({ success: true, data: gate, message: 'Go-live gate evaluation' });
  } catch (err) {
    next(err);
  }
});

// GET /api/intraday/signals?limit=50 — recent alerts, newest first
router.get('/signals', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10) || 50, 200);
    const signals = await IntradaySignal.find().sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ success: true, data: signals, message: `${signals.length} intraday signals` });
  } catch (err) {
    next(err);
  }
});

// GET /api/intraday/live — today's session view: open entries enriched with a fresh
// quote (unrealized P&L, stop/target proximity) + entries already settled today.
// Read-only — exits are stamped by the settle job or an explicit close, never here.
router.get('/live', async (_req, res, next) => {
  try {
    const sessionDate = istSessionDate();
    const todays = await IntradaySignal.find({ sessionDate }).sort({ createdAt: -1 }).lean();
    const open = todays.filter((s) => s.exitReason == null);
    const settled = todays.filter((s) => s.exitReason != null);

    const quotes = open.length
      ? await getQuotes([...new Set(open.map((s) => s.symbol))]).catch(() => ({}))
      : {};
    const enriched = open.map((s) => {
      const price = quotes[s.symbol]?.price ?? null;
      const entry = s.breakoutPrice;
      const isLong = s.direction !== 'SHORT';
      const priceDiff = price != null && entry != null ? (isLong ? price - entry : entry - price) : null;
      return {
        ...s,
        currentPrice: price,
        unrealizedGross: priceDiff != null ? round2(priceDiff * (s.shares ?? 0)) : null,
        unrealizedPct: priceDiff != null && entry ? round2((priceDiff / entry) * 100) : null,
        stopBreached:
          price != null &&
          s.suggestedStop != null &&
          (isLong ? price <= s.suggestedStop : price >= s.suggestedStop),
        targetReached:
          price != null &&
          s.suggestedTarget != null &&
          (isLong ? price >= s.suggestedTarget : price <= s.suggestedTarget),
      };
    });

    res.json({
      success: true,
      data: { sessionDate, open: enriched, settled },
      message: `${enriched.length} open, ${settled.length} settled today`,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/intraday/trades — log a MANUAL intraday paper trade, LONG or SHORT. Same
// collection as scanner alerts (one lifecycle: settle job square-offs apply) but
// source=MANUAL keeps it out of every strategy's track record and the go-live evidence.
// Paper only — no orders. Direction flips which side of entry the stop/target must sit
// on, so that relational check happens here (not in the Joi schema — Joi can validate a
// field against a static bound, not "less than OR greater than depending on another field").
const newIntradayTradeSchema = Joi.object({
  symbol: Joi.string().uppercase().pattern(/^[A-Z0-9&-]{1,20}$/).required(),
  direction: Joi.string().valid('LONG', 'SHORT').default('LONG'),
  entryPrice: Joi.number().positive().required(),
  stopLoss: Joi.number().positive().required(),
  target: Joi.number().positive().required(),
  shares: Joi.number().integer().min(1).required(),
  notes: Joi.string().allow('').max(500).default(''),
});

router.post('/trades', validateBody(newIntradayTradeSchema), async (req, res, next) => {
  try {
    const { symbol, direction, entryPrice, stopLoss, target, shares, notes } = req.body;
    const isLong = direction !== 'SHORT';
    if (isLong && !(stopLoss < entryPrice && target > entryPrice)) {
      return res.status(400).json({
        success: false,
        error: 'For a LONG trade, stop loss must be below entry and target above entry',
        code: 400,
      });
    }
    if (!isLong && !(stopLoss > entryPrice && target < entryPrice)) {
      return res.status(400).json({
        success: false,
        error: 'For a SHORT trade, stop loss must be above entry and target below entry',
        code: 400,
      });
    }

    const now = new Date();
    const trade = await IntradaySignal.create({
      symbol,
      sessionDate: istSessionDate(),
      setupType: 'MANUAL',
      direction,
      source: 'MANUAL',
      breakoutPrice: entryPrice,
      suggestedStop: stopLoss,
      suggestedTarget: target,
      shares,
      capitalDeployed: round2(shares * entryPrice),
      barTime: now, // settle job replays bars strictly after this
      alertedAt: now,
      notes,
    });
    logger.info(`Manual intraday trade logged: ${symbol}`, { direction, entryPrice, shares });
    res.status(201).json({ success: true, data: trade.toObject(), message: 'Intraday trade logged' });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/intraday/trades/:id/close — close an open intraday entry. Uses the given
// exitPrice, else a fresh quote. Any entry (ORB or MANUAL) can be closed by hand —
// exitReason MANUAL marks that the human, not the replay, decided the exit.
const closeIntradaySchema = Joi.object({
  exitPrice: Joi.number().positive().optional(),
});

router.patch('/trades/:id/close', validateBody(closeIntradaySchema), async (req, res, next) => {
  try {
    const sig = await IntradaySignal.findById(req.params.id);
    if (!sig) {
      return res.status(404).json({ success: false, error: 'Intraday entry not found', code: 404 });
    }
    if (sig.exitReason != null) {
      return res.status(409).json({ success: false, error: 'Entry already settled', code: 409 });
    }

    let exitPrice = req.body.exitPrice ?? null;
    if (exitPrice == null) {
      const quote = (await getQuotes([sig.symbol]).catch(() => ({})))[sig.symbol];
      exitPrice = quote?.price ?? null;
    }
    if (!(exitPrice > 0)) {
      return res.status(422).json({
        success: false,
        error: 'No live quote available — pass exitPrice explicitly',
        code: 422,
      });
    }

    const entry = sig.breakoutPrice;
    const direction = sig.direction ?? 'LONG';
    const isLong = direction !== 'SHORT';
    const riskPerShare = Math.max(Math.abs(entry - sig.suggestedStop), 0.01);
    const priceDiff = isLong ? exitPrice - entry : entry - exitPrice;
    const grossPnl = round2((sig.shares ?? 0) * priceDiff);
    const { netPnl, costs } = netAfterCosts(grossPnl, entry, exitPrice, sig.shares ?? 0, 'INTRADAY', direction);
    const now = new Date();
    Object.assign(sig, {
      exitPrice: round2(exitPrice),
      exitReason: 'MANUAL',
      exitTime: now,
      rMultiple: round2(priceDiff / riskPerShare),
      grossPnl,
      estCosts: costs.total,
      paperPnl: netPnl,
      resultPct: round2((priceDiff / entry) * 100),
      settledAt: now,
    });
    await sig.save();
    logger.info(`Intraday trade closed: ${sig.symbol} @ ₹${exitPrice}`, { netPnl });
    res.json({ success: true, data: sig.toObject(), message: 'Intraday trade closed' });
  } catch (err) {
    next(err);
  }
});

export default router;
