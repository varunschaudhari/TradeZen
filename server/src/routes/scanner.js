/**
 * @file scanner.js
 * @description POST /api/scanner/run — run a full analyze → 8-gate → deterministic-verdict
 *              evaluation on an explicit symbol list and return the resulting signals.
 *              This is a preview/manual scan: it does NOT persist or send alerts (use
 *              POST /api/signals/scan for the persisting cron-style universe scan).
 * @author TradeZen Team
 * @created 2026-06-20
 */

import express from 'express';
import Config from '../models/Config.js';
import { evaluateSymbols } from '../services/stockDiscovery.js';
import { decideVerdict } from '../services/verdictEngine.js';
import { checkGate7 } from '../services/gateChecker.js';
import { logger } from '../config/logger.js';

const router = express.Router();

/**
 * Compact per-symbol result combining gate output and (optional) verdict analysis.
 * @param {object} candidate - enrichAndGate output
 * @param {object|null} analysis - decideVerdict result, or null if gates didn't qualify
 * @returns {object}
 */
function summarize(candidate, analysis) {
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
    verdict: analysis?.verdict ?? (gateResult.hardBlockFired ? 'SKIP' : 'WAIT'),
    confidence: analysis?.confidence ?? null,
    setupType: analysis?.setupType ?? null,
    entryZone: analysis?.entryZone ?? null,
    stopLoss: analysis?.stopLoss ?? stockData.suggestedStopLoss,
    target1: analysis?.target1 ?? stockData.suggestedTarget1,
    target2: analysis?.target2 ?? stockData.suggestedTarget2,
    riskReward: analysis?.riskReward ?? null,
    reasoning: analysis?.reasoning ?? null,
  };
}

// POST /api/scanner/run  body: { symbols: string[] }
router.post('/run', async (req, res, next) => {
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

    const cfg = await Config.findOne({ userId: req.userId })
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
      let analysis = null;
      if (candidate.gateResult.shouldCallClaude) {
        analysis = decideVerdict(candidate.stockData, marketData, candidate.gateResult);
        candidate.gate7 = checkGate7(analysis, marketData);
      }
      signals.push(summarize(candidate, analysis));
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
