/**
 * @file simonsExternal.js
 * @description Flow 5 (part 2) — Simons signals that depend on EXTERNAL data the
 *              project does not yet ingest: PEAD (earnings beats), sector rotation,
 *              FII flow, and Put/Call ratio. Each function accepts injected data and
 *              returns a neutral result (no score, no tag) when that data is absent,
 *              so the pipeline runs cleanly until the data feeds are wired in.
 * @author TradeZen Team
 * @created 2026-06-20
 * @lastModified 2026-06-20
 */

import {
  PC_RATIO_FEAR,
  PC_RATIO_GREED,
  PEAD_BEAT_PCT,
  PEAD_LOOKBACK_DAYS,
  SIMONS_POINTS,
} from '../config/constants.js';

const NEUTRAL = (extra = {}) => ({ active: false, score: 0, tag: null, ...extra });

/**
 * SIGNAL 6 — PEAD (Post-Earnings Announcement Drift).
 *
 * Fires when a company beat estimates and is on its first pullback after the pop.
 * Requires an earningsHistory record (from a future Tickertape/earnings feed).
 *
 * @param {object|null} earningsHistory - { reportedDaysAgo, epsBeatPct, rsiPulledBack, firstPullbackToEma20 }
 * @returns {{ active: boolean, score: number, tag: string|null, beatPct?: number }}
 */
export function detectPEAD(earningsHistory) {
  if (!earningsHistory) return NEUTRAL();
  const { reportedDaysAgo, epsBeatPct, rsiPulledBack, firstPullbackToEma20 } = earningsHistory;
  const recent = reportedDaysAgo != null && reportedDaysAgo <= PEAD_LOOKBACK_DAYS;
  const beat = epsBeatPct != null && epsBeatPct > PEAD_BEAT_PCT;
  if (recent && beat && rsiPulledBack && firstPullbackToEma20) {
    return { active: true, score: SIMONS_POINTS.PEAD, tag: 'PEAD_SETUP', beatPct: epsBeatPct };
  }
  return NEUTRAL();
}

/**
 * SIGNAL 7 — Sector rotation. Scores a stock by its sector's weekly rank.
 *
 * @param {object|null} sectorRanking - { topSectors: string[], bottomSectors: string[] }
 * @param {string|null} stockSector   - The stock's sector label
 * @returns {{ active: boolean, score: number, tag: string|null, tailwind: boolean, headwind: boolean }}
 */
export function detectSectorMomentum(sectorRanking, stockSector) {
  if (!sectorRanking || !stockSector) return NEUTRAL({ tailwind: false, headwind: false });
  const top = Array.isArray(sectorRanking.topSectors) ? sectorRanking.topSectors : [];
  const bottom = Array.isArray(sectorRanking.bottomSectors) ? sectorRanking.bottomSectors : [];
  if (top.includes(stockSector)) {
    return {
      active: true,
      score: SIMONS_POINTS.SECTOR_TOP,
      tag: 'SECTOR_TAILWIND',
      tailwind: true,
      headwind: false,
    };
  }
  if (bottom.includes(stockSector)) {
    return {
      active: true,
      score: SIMONS_POINTS.SECTOR_BOTTOM,
      tag: 'SECTOR_HEADWIND',
      tailwind: false,
      headwind: true,
    };
  }
  return NEUTRAL({ tailwind: false, headwind: false });
}

/**
 * SIGNAL 8 — FII flow momentum. Scores recent foreign-institutional net flow.
 *
 * @param {object|null} fiiData - { trend: 'BUYING'|'SELLING'|'NEUTRAL', netBuy3d?: number }
 * @returns {{ active: boolean, score: number, tag: string|null, trend: string }}
 */
export function evaluateFIIFlow(fiiData) {
  const trend = fiiData?.trend ?? null;
  if (trend === 'BUYING') {
    return { active: true, score: SIMONS_POINTS.FII_BUYING, tag: 'FII_BUYING', trend };
  }
  if (trend === 'SELLING') {
    return { active: true, score: SIMONS_POINTS.FII_SELLING, tag: 'FII_SELLING', trend };
  }
  return NEUTRAL({ trend: trend ?? 'NEUTRAL' });
}

/**
 * SIGNAL 9 — Put/Call ratio (contrarian market sentiment).
 *
 * @param {number|null} pcRatio - Nifty options Put/Call ratio
 * @returns {{ active: boolean, score: number, tag: string|null, pcRatio: number|null, interpretation: string }}
 */
export function evaluatePutCallRatio(pcRatio) {
  if (pcRatio == null) return NEUTRAL({ pcRatio: null, interpretation: 'unavailable' });
  if (pcRatio > PC_RATIO_FEAR) {
    return {
      active: true,
      score: SIMONS_POINTS.PC_FEAR,
      tag: 'PC_FEAR',
      pcRatio,
      interpretation: 'extreme fear → contrarian bullish',
    };
  }
  if (pcRatio >= 1.0) {
    return {
      active: true,
      score: SIMONS_POINTS.PC_ELEVATED,
      tag: null,
      pcRatio,
      interpretation: 'elevated fear → mildly bullish',
    };
  }
  if (pcRatio < PC_RATIO_GREED) {
    return {
      active: true,
      score: SIMONS_POINTS.PC_GREED,
      tag: null,
      pcRatio,
      interpretation: 'extreme greed → caution',
    };
  }
  return NEUTRAL({ pcRatio, interpretation: 'neutral' });
}
