/**
 * @file signalManager.js
 * @description Flow 7 — signal persistence with deduplication, WAIT→BUY upgrade
 *              detection, and expiry. buildSignalDoc() maps the pipeline output
 *              (Claude + gates + Simons + news) into a Signal document; saveSignal()
 *              applies the 4-hour dedup window; expireStaleSignals() is the daily
 *              cron that deactivates signals past their validity.
 * @author TradeZen Team
 * @created 2026-06-20
 * @lastModified 2026-06-20
 */

import Signal from '../models/Signal.js';
import { DEDUPLICATION_HOURS, VERDICTS } from '../config/constants.js';
import { logger } from '../config/logger.js';

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

/**
 * Today's market close as a Date: 15:30 IST = 10:00 UTC (next day if already past).
 *
 * @param {Date} now - Reference time
 * @returns {Date} Expiry at today's (or tomorrow's) close
 */
function endOfTodayIst(now) {
  const expiry = new Date(now);
  expiry.setUTCHours(10, 0, 0, 0);
  if (expiry <= now) expiry.setUTCDate(expiry.getUTCDate() + 1);
  return expiry;
}

/**
 * Compute signal validity end. Uses Claude's signalValidDays when provided,
 * else defaults by verdict (BUY → today's close, WAIT → 3 days, SKIP → 1 day).
 *
 * @param {string} verdict - BUY | WAIT | SKIP
 * @param {number|null} signalValidDays - Claude-suggested validity in days
 * @param {Date} [now] - Reference time
 * @returns {Date} signalValidTill
 */
export function computeSignalValidTill(verdict, signalValidDays, now = new Date()) {
  if (typeof signalValidDays === 'number' && signalValidDays > 0) {
    return new Date(now.getTime() + signalValidDays * MS_PER_DAY);
  }
  if (verdict === VERDICTS.BUY) return endOfTodayIst(now);
  if (verdict === VERDICTS.WAIT) return new Date(now.getTime() + 3 * MS_PER_DAY);
  return new Date(now.getTime() + MS_PER_DAY);
}

/**
 * Parse a YYYY-MM-DD (or any date-ish) value to a Date, or null.
 *
 * @param {*} value - Candidate date value
 * @returns {Date|null}
 */
function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Map the full pipeline output into a plain Signal document (no DB I/O).
 *
 * @param {object} input - {
 *   claudeResult, stockData, gateResult, marketData, newsData, simons,
 *   verdict?, waitCondition?, position?, gate7Result?, now?
 * }
 * @returns {object} Signal document ready for Signal.create()
 */
export const buildSignalDoc = (input) => {
  const { claudeResult, stockData, gateResult, marketData, newsData, simons } = input;
  const now = input.now ?? new Date();
  const verdict = input.verdict ?? claudeResult.verdict;
  const waitCondition = input.waitCondition ?? claudeResult.waitCondition ?? null;
  const position = input.position ?? { shares: 0, capitalDeployed: 0, maxLoss: 0, maxProfit: 0 };
  const ind = stockData?.indicators ?? {};
  const gate7 = input.gate7Result ?? { passed: false, reason: 'Pending Claude confidence check' };
  const gatesPassed = (gateResult?.gatesPassed ?? 0) + (gate7.passed ? 1 : 0);

  return {
    symbol: stockData?.symbol,
    verdict,
    confidence: claudeResult.confidence,
    setupType: claudeResult.setupType ?? null,
    compositeScore: gateResult?.compositeScore ?? 0,
    compositeScoreAssessment: claudeResult.compositeScoreAssessment ?? null,
    entryZone: claudeResult.entryZone ?? null,
    entryTrigger: claudeResult.entryTrigger ?? null,
    stopLoss: claudeResult.stopLoss ?? stockData?.suggestedStopLoss,
    stopLossReason: claudeResult.stopLossReason ?? null,
    target1: claudeResult.target1 ?? stockData?.suggestedTarget1,
    target1Reason: claudeResult.target1Reason ?? null,
    target2: claudeResult.target2 ?? stockData?.suggestedTarget2,
    target2Reason: claudeResult.target2Reason ?? null,
    riskReward: claudeResult.riskReward,
    shares: position.shares,
    capitalDeployed: position.capitalDeployed,
    maxLoss: position.maxLoss,
    maxProfit: position.maxProfit,
    signalValidDays: claudeResult.signalValidDays ?? null,
    signalValidTill: computeSignalValidTill(verdict, claudeResult.signalValidDays, now),
    exitBeforeDate: toDate(claudeResult.exitBeforeDate),
    waitCondition,
    skipReason: claudeResult.skipReason ?? null,
    reasoning: claudeResult.reasoning,
    keyRisks: claudeResult.keyRisks ?? [],
    tailwindFactors: claudeResult.tailwindFactors ?? [],
    simonsSignals: claudeResult.simonsSignals ?? simons?.tags ?? [],
    tags: simons?.tags ?? gateResult?.tags ?? [],
    gatesPassed,
    gateDetails: { ...(gateResult?.gateDetails ?? {}), gate7 },
    indicators: {
      ema20: ind.ema20,
      ema50: ind.ema50,
      ema200: ind.ema200,
      rsi: ind.rsi14,
      macd: ind.macd,
      macdSignal: ind.macdSignal,
      macdHist: ind.macdHist,
      volRatio: ind.volRatio,
      atr: ind.atr14,
      bollingerB: ind.bbPctB,
      candlePattern: ind.candlePattern,
      momentum6m: stockData?.momentum6m ?? simons?.enrichment?.momentum6m,
      relativeStrength: stockData?.relativeStrength ?? simons?.enrichment?.relativeStrength,
    },
    marketContext: {
      niftyPrice: marketData?.nifty50?.price,
      vix: marketData?.vix,
      marketMode: marketData?.marketMode,
      adRatio: marketData?.adRatio,
      fiiTrend: marketData?.fiiTrend,
      pcRatio: marketData?.pcRatio,
    },
    newsSentiment: newsData?.sentiment,
    newsSentimentScore: newsData?.score ?? newsData?.sentimentScore ?? 0,
    newsHeadlines: newsData?.headlines ?? [],
    scanTimestamp: now,
    isActive: verdict === VERDICTS.BUY || verdict === VERDICTS.WAIT,
    claudeTokensUsed: claudeResult.tokensUsed ?? 0,
    claudeCostInr: claudeResult.costInr ?? 0,
  };
};

/**
 * Decide the dedup action for a new verdict given the latest active signal (pure).
 *
 * @param {object|null} existing - Latest active signal in the dedup window, or null
 * @param {string} newVerdict - The new signal's verdict
 * @returns {'created'|'duplicate'|'upgraded'|'changed'}
 */
export function decideDedupAction(existing, newVerdict) {
  if (!existing) return 'created';
  if (existing.verdict === newVerdict) return 'duplicate';
  if (existing.verdict === VERDICTS.WAIT && newVerdict === VERDICTS.BUY) return 'upgraded';
  return 'changed';
}

/**
 * Persist a signal with deduplication.
 *
 * Within DEDUPLICATION_HOURS for the same symbol:
 *  - same verdict        → no new doc; refresh scanTimestamp (action 'duplicate')
 *  - WAIT → BUY          → deactivate old, create new (action 'upgraded')
 *  - any other change    → deactivate old, create new (action 'changed')
 *  - no active signal    → create new (action 'created')
 *
 * The caller decides notifications based on the returned action.
 *
 * @param {object} input - Same shape as buildSignalDoc input
 * @returns {Promise<{ action: string, signal: object, previous: object|null }>}
 */
export const saveSignal = async (input) => {
  const now = input.now ?? new Date();
  const doc = buildSignalDoc({ ...input, now });
  const { symbol, verdict } = doc;

  const since = new Date(now.getTime() - DEDUPLICATION_HOURS * MS_PER_HOUR);
  const existing = await Signal.findOne({
    symbol,
    isActive: true,
    createdAt: { $gte: since },
  }).sort({ createdAt: -1 });
  const action = decideDedupAction(existing, verdict);

  if (action === 'duplicate') {
    existing.scanTimestamp = now;
    await existing.save();
    logger.info(`Dedup: ${symbol} ${verdict} unchanged within ${DEDUPLICATION_HOURS}h`);
    return { action, signal: existing, previous: null };
  }

  if (existing) {
    existing.isActive = false;
    await existing.save();
  }
  const signal = await Signal.create(doc);
  logger.info(`Signal ${action}: ${symbol} ${existing ? `${existing.verdict}→` : ''}${verdict}`, {
    compositeScore: doc.compositeScore,
  });
  return { action, signal, previous: existing ?? null };
};

/**
 * Deactivate all active signals whose validity has lapsed (daily cron, JOB 9).
 *
 * @param {Date} [now] - Reference time
 * @returns {Promise<number>} Count of signals expired
 */
export const expireStaleSignals = async (now = new Date()) => {
  const res = await Signal.updateMany(
    { signalValidTill: { $lt: now }, isActive: true },
    { $set: { isActive: false } }
  );
  const count = res.modifiedCount ?? 0;
  if (count) logger.info(`Expired ${count} stale signals`);
  return count;
};
