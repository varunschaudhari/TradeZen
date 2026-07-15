/**
 * @file intradayUniverse.js
 * @description Builds the intraday module's OWN stock shortlist — liquid large-cap /
 *   F&O-proxy stocks (NIFTY50 + NEXT50), ranked by INTRADAY suitability (volatility ×
 *   liquidity) — completely decoupled from the swing EOD-prep shortlist, which was the
 *   root cause of two straight losing ORB signals (trend-quality stocks with no reason
 *   to also have clean intraday opening-range behavior). Reuses the existing cheap
 *   /screen pass (atrPct + avgTurnoverInr are already computed there) and skips the
 *   expensive per-symbol /analyze phase entirely — costs almost nothing beyond the swing
 *   EOD-prep call already made daily.
 * @author TradeZen Team
 * @created 2026-07-09
 */

import IntradayUniverse from '../models/IntradayUniverse.js';
import { screenUniverse } from './pythonBridge.js';
import {
  INTRADAY_MAX_SYMBOLS,
  INTRADAY_MIN_ATR_PCT,
  INTRADAY_MIN_TURNOVER_INR,
  INTRADAY_UNIVERSE_TIERS,
  ORB_SCANNER_ENABLED,
} from '../config/constants.js';
import { logger } from '../config/logger.js';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Score one screen candidate for intraday suitability (pure). Blends liquidity
 * (log10-scaled so a mega-cap's huge turnover doesn't just dominate everything) with
 * volatility (atrPct — the actual "does this stock move enough to trade" signal),
 * weighted toward volatility since two already-liquid stocks should mostly be ranked
 * by which one actually moves.
 *
 * @param {{ avgTurnoverInr?: number, atrPct?: number }} candidate
 * @returns {number}
 */
export function intradaySuitabilityScore(candidate) {
  const turnoverScore = Math.log10(Math.max(candidate.avgTurnoverInr ?? 0, 1));
  const volatilityScore = candidate.atrPct ?? 0;
  return round2(volatilityScore * 2 + turnoverScore);
}

/**
 * Build today's intraday shortlist from the swing screen's cheap OHLCV pass, filtered to
 * a stricter liquidity + volatility floor than swing uses, then re-ranked by intraday
 * suitability instead of swing trend quality. Never throws — returns a zero summary on
 * failure so the caller (cron / catch-up net) stays healthy.
 *
 * Gated on ORB_SCANNER_ENABLED — the intraday module's OWN enable flag, deliberately
 * independent of the swing Config.scannerEnabled toggle. Pausing swing must not pause
 * intraday, and vice versa; that's the whole point of the two being separate modules.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.forceRun=false] - Bypass the enabled guard (testing / catch-up)
 * @returns {Promise<{ symbols: number, universeCount: number, screenedCount: number, skipped?: string }>}
 */
export const buildIntradayUniverse = async ({ forceRun = false } = {}) => {
  try {
    if (!forceRun && !ORB_SCANNER_ENABLED) {
      return { symbols: 0, universeCount: 0, screenedCount: 0, skipped: 'disabled' };
    }
    const screen = await screenUniverse({ tiers: INTRADAY_UNIVERSE_TIERS, checkEarnings: true });
    const survivors = (screen.candidates ?? []).filter(
      (c) =>
        (c.avgTurnoverInr ?? 0) >= INTRADAY_MIN_TURNOVER_INR &&
        (c.atrPct ?? 0) >= INTRADAY_MIN_ATR_PCT
    );
    const ranked = survivors
      .map((c) => ({ ...c, suitabilityScore: intradaySuitabilityScore(c) }))
      .sort((a, b) => b.suitabilityScore - a.suitabilityScore)
      .slice(0, INTRADAY_MAX_SYMBOLS);

    await IntradayUniverse.create({
      symbols: ranked.map((c) => ({
        symbol: c.symbol,
        tier: c.tier,
        currentPrice: c.currentPrice,
        avgTurnoverInr: c.avgTurnoverInr,
        atrPct: c.atrPct,
        suitabilityScore: c.suitabilityScore,
      })),
      universeCount: screen.universeCount,
      screenedCount: screen.screenedCount,
    });

    logger.info('Intraday universe built', {
      symbols: ranked.length,
      universeCount: screen.universeCount,
      top5: ranked.slice(0, 5).map((c) => c.symbol),
    });
    return {
      symbols: ranked.length,
      universeCount: screen.universeCount,
      screenedCount: screen.screenedCount,
    };
  } catch (err) {
    logger.error('buildIntradayUniverse failed', { error: err.message });
    return { symbols: 0, universeCount: 0, screenedCount: 0 };
  }
};

/**
 * Symbols on the latest intraday shortlist (empty when none exists yet).
 * @returns {Promise<string[]>}
 */
export const getIntradayShortlistSymbols = async () => {
  const latest = await IntradayUniverse.findOne().sort({ createdAt: -1 }).select('symbols').lean();
  return (latest?.symbols ?? []).map((s) => s.symbol);
};
