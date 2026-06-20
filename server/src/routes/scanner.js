/**
 * @file scanner.js
 * @description POST /api/scanner/run — run a full analyze → 8-gate → Claude evaluation
 *              on an explicit symbol list and return the resulting signals. This is a
 *              preview/manual scan: it does NOT persist or send alerts (use
 *              POST /api/signals/scan for the persisting cron-style universe scan).
 * @author TradeZen Team
 * @created 2026-06-20
 */

import express from 'express';
import Config from '../models/Config.js';
import { evaluateSymbols } from '../services/stockDiscovery.js';
import { buildClaudePrompt, callClaudeAPI } from '../services/claudeEngine.js';
import { checkGate7 } from '../services/gateChecker.js';
import { claudeRateLimiter } from '../middleware/rateLimiter.js';
import { logger } from '../config/logger.js';

const router = express.Router();

/**
 * Compact per-symbol result combining gate output and (optional) Claude verdict.
 * @param {object} candidate - enrichAndGate output
 * @param {object|null} claude - Claude result, or null if gates didn't warrant a call
 * @returns {object}
 */
function summarize(candidate, claude) {
  const { stockData, gateResult, newsData } = candidate;
  return {
    symbol: stockData.symbol,
    currentPrice: stockData.currentPrice,
    gatesPassed: gateResult.gatesPassed,
    compositeScore: gateResult.compositeScore,
    scoreConfidence: gateResult.scoreConfidence,
    hardBlockFired: gateResult.hardBlockFired,
    shouldCallClaude: gateResult.shouldCallClaude,
    tags: gateResult.tags,
    newsSentiment: newsData?.sentiment,
    verdict: claude?.verdict ?? (gateResult.hardBlockFired ? 'SKIP' : 'WAIT'),
    confidence: claude?.confidence ?? null,
    setupType: claude?.setupType ?? null,
    entryZone: claude?.entryZone ?? null,
    stopLoss: claude?.stopLoss ?? stockData.suggestedStopLoss,
    target1: claude?.target1 ?? stockData.suggestedTarget1,
    target2: claude?.target2 ?? stockData.suggestedTarget2,
    riskReward: claude?.riskReward ?? null,
    reasoning: claude?.reasoning ?? null,
  };
}

// POST /api/scanner/run  body: { symbols: string[] }
router.post('/run', claudeRateLimiter, async (req, res, next) => {
  try {
    const raw = Array.isArray(req.body?.symbols) ? req.body.symbols : [];
    if (!raw.length) {
      return res
        .status(400)
        .json({
          success: false,
          error: 'Body must include a non-empty symbols[] array',
          code: 400,
        });
    }
    const symbols = [...new Set(raw.map((s) => String(s).replace(/\.NS$/i, '').toUpperCase()))];

    const cfg = await Config.findOne()
      .lean()
      .catch(() => null);
    const capital = cfg?.capital ?? 1_000_000;
    const riskPct = cfg?.riskPercentage ?? 1;

    const { marketData, candidates } = await evaluateSymbols(symbols, { capital, riskPct });
    const signals = [];
    for (const candidate of candidates) {
      if (candidate.error) {
        signals.push({ symbol: candidate.symbol, error: candidate.error });
        continue;
      }
      let claude = null;
      if (candidate.gateResult.shouldCallClaude) {
        const prompt = buildClaudePrompt(
          candidate.stockData,
          marketData,
          candidate.newsData,
          candidate.gateResult,
          capital
        );
        claude = await callClaudeAPI(prompt);
        candidate.gate7 = checkGate7(claude);
      }
      signals.push(summarize(candidate, claude));
    }

    logger.info('Manual scanner/run complete', {
      symbols: symbols.length,
      marketMode: marketData?.marketMode,
    });
    res.json({
      success: true,
      data: {
        marketMode: marketData?.marketMode,
        adRatio: marketData?.adRatio,
        count: signals.length,
        signals,
      },
      message: `${signals.length} symbols evaluated`,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
