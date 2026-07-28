/**
 * @file verdictEngine.js
 * @description Flow 4 (v2) — deterministic verdict engine. Replaces the Claude Sonnet
 *   call that used to sit between the 8 gates and the saved Signal: same inputs now
 *   always produce the same verdict, so the live pipeline, the backtest, and the
 *   calibration report all measure ONE strategy instead of "gates + an LLM's mood".
 *
 *   Decision rule (mirrors what was actually enforced in the Claude era — the
 *   BUY⇒HIGH override in parseClaudeResponse — now made explicit and consistent
 *   with gate 7's record):
 *     • hard block fired              → SKIP
 *     • market mode BEAR              → WAIT  (no BUY in bear, matching old gate 7)
 *     • score confidence HIGH  (≥60)  → BUY   (then target-geometry floor may downgrade)
 *     • score confidence MEDIUM       → WAIT  (condition: what's missing for HIGH)
 *     • score confidence LOW   (<50)  → SKIP  (qualified on gates, but score says no edge)
 *
 *   Levels come from the Python service's S/R + Fibonacci suggestions (previously the
 *   "fallbacks" — Claude was handed these same levels in its prompt and largely echoed
 *   them). The T1_MIN_R / RISK_REWARD_MIN target-geometry floor is ported verbatim from
 *   parseClaudeResponse so the QUALITY_DOWNGRADE discipline-ledger path keeps working.
 *
 *   Returns the exact result shape callClaudeAPI used to return, so signalManager's
 *   buildSignalDoc and scanPipeline's processCandidate consume it unchanged.
 *   tokensUsed/costInr are always 0 — kept for Signal schema continuity.
 *
 *   Claude still lives elsewhere by design: Haiku headline sentiment (newsFetcher,
 *   feeds gate 8, has a keyword fallback). Doesn't gate a verdict.
 *
 * @author TradeZen Team
 * @created 2026-07-13
 */

import {
  CONFIDENCE_LEVELS,
  PROXIMITY_52W_HIGH_PCT,
  RISK_REWARD_MIN,
  RSI_MAX,
  SCORE_HIGH_CONFIDENCE,
  SCORE_MEDIUM_CONFIDENCE,
  T1_MIN_R,
  VERDICTS,
  VOLUME_RATIO_MIN,
} from '../config/constants.js';
import { logger } from '../config/logger.js';

const round2 = (n) => Math.round(n * 100) / 100;
const MS_PER_DAY = 86_400_000;

/**
 * Derive the entry zone from the suggested entry (pure). The zone's HIGH is pinned to
 * the suggested entry itself so risk (= entryZone.high − stopLoss) stays identical to
 * what gate 6 already validated; the LOW extends a quarter-ATR below it as a pullback
 * buy window for the entry watcher.
 *
 * @param {number} entry - Python suggestedEntry
 * @param {number|null} atr - ATR(14), absolute ₹
 * @returns {{ low: number, high: number }|null}
 */
export function deriveEntryZone(entry, atr) {
  if (!(entry > 0)) return null;
  const band = atr > 0 ? 0.25 * atr : entry * 0.005;
  return { low: round2(Math.max(0.01, entry - band)), high: round2(entry) };
}

/**
 * Classify the setup type from tags + price structure (pure heuristic; the same
 * SETUP_TYPES enum Claude used to pick from).
 */
export function classifySetupType(stockData, gateResult) {
  const tags = gateResult?.tags ?? [];
  const ind = stockData?.indicators ?? {};
  const price = stockData?.currentPrice;
  const proximity =
    price != null && stockData?.high52w > 0
      ? ((stockData.high52w - price) / stockData.high52w) * 100
      : null;

  if (tags.includes('MEAN_REVERSION')) return 'MEAN_REVERSION';
  if (
    proximity != null &&
    proximity < PROXIMITY_52W_HIGH_PCT &&
    ind.ema20 != null &&
    ind.ema50 != null &&
    price > ind.ema20 &&
    ind.ema20 > ind.ema50
  ) {
    return 'MOMENTUM_BREAKOUT';
  }
  if (tags.includes('RSI_BOUNCE')) return 'PULLBACK_TO_SUPPORT';
  if (tags.includes('VOLUME_ANOMALY') || tags.includes('ACCUMULATION')) return 'VOLUME_ANOMALY';
  if (stockData?.sectorTailwind === true) return 'SECTOR_ROTATION';
  return 'OTHER';
}

/** Rule-derived risk list — the honest, mechanical replacement for Claude's keyRisks. */
export function deriveKeyRisks(stockData, marketData, gateResult) {
  const risks = [];
  const ind = stockData?.indicators ?? {};
  const gd = gateResult?.gateDetails ?? {};

  if (gateResult?.earningsWarning) {
    risks.push('Earnings within the 15–20 day caution window — gap risk before the target horizon');
  }
  if (marketData?.vix != null && marketData.vix > 20) {
    risks.push(`Elevated VIX (${round2(marketData.vix)}) — expect wider swings`);
  }
  if (marketData?.marketMode === 'CAUTION' || marketData?.marketMode === 'MIXED') {
    risks.push(`Market mode ${marketData.marketMode} — position sizing already reduced by regime`);
  }
  if (ind.rsi14 != null && ind.rsi14 > RSI_MAX - 5) {
    risks.push(`RSI ${round2(ind.rsi14)} approaching the overbought ceiling (${RSI_MAX})`);
  }
  if (gd.gate4 && !gd.gate4.passed) risks.push(`Gate 4: ${gd.gate4.reason}`);
  if (gd.gate5 && !gd.gate5.passed) risks.push(`Gate 5: ${gd.gate5.reason}`);
  else if (ind.volRatio != null && ind.volRatio < VOLUME_RATIO_MIN) {
    risks.push(`Volume ${round2(ind.volRatio)}× below the ${VOLUME_RATIO_MIN}× confirmation bar`);
  }
  return risks.slice(0, 4);
}

/** Templated 2–4 sentence summary — states what the numbers say, no more. */
function buildReasoning(stockData, marketData, gateResult, verdict, rrT1) {
  const ind = stockData?.indicators ?? {};
  const drivers = (gateResult?.scoreBreakdown ?? [])
    .filter((b) => b.points > 0)
    .slice(0, 3)
    .map((b) => b.label.toLowerCase());
  const parts = [
    `Deterministic verdict: ${gateResult?.gatesPassed ?? 0}/7 pre-verdict gates passed, ` +
      `composite score ${gateResult?.compositeScore ?? 0}/100 (${gateResult?.scoreConfidence}).`,
  ];
  if (drivers.length) parts.push(`Score drivers: ${drivers.join('; ')}.`);
  parts.push(
    `Weekly trend ${stockData?.weeklyTrend ?? 'N/A'}, RSI ${ind.rsi14 != null ? round2(ind.rsi14) : 'N/A'}, ` +
      `volume ${ind.volRatio != null ? round2(ind.volRatio) : 'N/A'}×, market mode ${marketData?.marketMode ?? 'N/A'}.`
  );
  if (verdict === VERDICTS.BUY && rrT1 != null) {
    parts.push(`Levels from the S/R engine give ${rrT1}R to target 1.`);
  }
  return parts.join(' ');
}

/**
 * The deterministic replacement for callClaudeAPI — pure, synchronous, zero cost.
 *
 * @param {object} stockData  - StockAnalysis from the Python service (+ enrichment)
 * @param {object} marketData - Market snapshot (marketMode, vix, …)
 * @param {object} gateResult - Full runAllGates() output
 * @returns {object} claudeResult-shaped verdict object (tokensUsed/costInr = 0)
 */
export const decideVerdict = (stockData, marketData, gateResult) => {
  const confidence = gateResult?.scoreConfidence ?? CONFIDENCE_LEVELS.LOW;
  const score = gateResult?.compositeScore ?? 0;

  const entry = stockData?.suggestedEntry ?? null;
  const stopLoss = stockData?.suggestedStopLoss ?? null;
  const target1 = stockData?.suggestedTarget1 ?? null;
  const target2 = stockData?.suggestedTarget2 ?? null;
  const atr = stockData?.indicators?.atr14 ?? null;
  const entryZone = deriveEntryZone(entry, atr);

  const risk = entryZone?.high != null && stopLoss != null ? entryZone.high - stopLoss : null;
  const rrT1 = risk > 0 && target1 != null ? round2((target1 - entryZone.high) / risk) : null;
  const rrT2 = risk > 0 && target2 != null ? round2((target2 - entryZone.high) / risk) : null;

  const result = {
    verdict: VERDICTS.WAIT,
    confidence,
    setupType: classifySetupType(stockData, gateResult),
    entryZone,
    entryTrigger: entryZone
      ? `Price trades into ₹${entryZone.low}–₹${entryZone.high} with volume holding ≥ ${VOLUME_RATIO_MIN}× the 20-day average`
      : null,
    stopLoss,
    stopLossReason: 'Below the nearest support cluster (Python S/R engine)',
    target1,
    target1Reason: 'First resistance / Fibonacci projection (Python S/R engine)',
    target2,
    target2Reason: 'Extended resistance / Fibonacci projection (Python S/R engine)',
    riskReward: rrT1,
    signalValidDays: null,
    exitBeforeDate:
      gateResult?.earningsWarning && stockData?.earningsTimestamp
        ? new Date(stockData.earningsTimestamp * 1000 - 2 * MS_PER_DAY).toISOString().slice(0, 10)
        : null,
    waitCondition: null,
    skipReason: null,
    keyRisks: deriveKeyRisks(stockData, marketData, gateResult),
    tailwindFactors: (gateResult?.scoreBreakdown ?? [])
      .filter((b) => b.points > 0)
      .slice(0, 3)
      .map((b) => b.label),
    simonsSignals: gateResult?.tags ?? [],
    compositeScoreAssessment: `Composite ${score}/100 → ${confidence} (bands: ≥${SCORE_HIGH_CONFIDENCE} HIGH, ${SCORE_MEDIUM_CONFIDENCE}–${SCORE_HIGH_CONFIDENCE - 1} MEDIUM)`,
    reasoning: '',
    tokensUsed: 0,
    costInr: 0,
  };

  // ── Verdict ──────────────────────────────────────────────────────────────────
  if (gateResult?.hardBlockFired) {
    result.verdict = VERDICTS.SKIP;
    result.skipReason = 'Hard-block gate fired';
  } else if (marketData?.marketMode === 'BEAR') {
    result.verdict = VERDICTS.WAIT;
    result.waitCondition = 'Market in BEAR mode — BUY signals paused until the regime recovers';
  } else if (confidence === CONFIDENCE_LEVELS.HIGH) {
    result.verdict = VERDICTS.BUY;
  } else if (confidence === CONFIDENCE_LEVELS.MEDIUM) {
    result.verdict = VERDICTS.WAIT;
    result.waitCondition = `Composite score ${score} below the HIGH-confidence bar (${SCORE_HIGH_CONFIDENCE}) — wait for stronger confirmation (volume, RS, or sector tailwind)`;
  } else {
    result.verdict = VERDICTS.SKIP;
    result.skipReason = `Composite score ${score} < ${SCORE_MEDIUM_CONFIDENCE} — gates qualified but no measured edge`;
  }

  // ── Target-geometry floor on BUYs (ported verbatim from parseClaudeResponse) ──
  if (result.verdict === VERDICTS.BUY) {
    let downgradeReason = null;
    if (rrT1 == null) {
      downgradeReason = 'incomplete or invalid trade levels (entry/stop/target1)';
    } else if (rrT1 < T1_MIN_R) {
      downgradeReason = `target1 too close: ${rrT1}R < ${T1_MIN_R}R minimum`;
    } else if (rrT2 != null && rrT2 < RISK_REWARD_MIN) {
      downgradeReason = `target2 R:R ${rrT2} below ${RISK_REWARD_MIN}:1 minimum`;
    }
    if (downgradeReason) {
      logger.warn('BUY failed target-geometry floor — downgrading to WAIT', {
        symbol: stockData?.symbol,
        rrT1,
        rrT2,
        reason: downgradeReason,
      });
      result.verdict = VERDICTS.WAIT;
      result.downgradedFrom = VERDICTS.BUY;
      result.downgradeReason = downgradeReason;
      result.waitCondition = `Setup geometry too tight (${downgradeReason}) — wait for a pullback entry or a cleaner level structure`;
    }
  }

  result.reasoning = buildReasoning(stockData, marketData, gateResult, result.verdict, rrT1);
  return result;
};
