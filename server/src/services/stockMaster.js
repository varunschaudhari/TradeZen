/**
 * @file stockMaster.js
 * @description Upsert helpers for the persistent Stock master collection. Two sources
 *   feed it: (1) every scan cycle upserts each scanned stock's latest status, and
 *   (2) the /stock detail (seed + analysis views) upserts sector + fundamentals. All
 *   writes are upserts keyed by symbol, so the collection self-heals and never blocks
 *   the scan/analysis flow (callers fire-and-forget).
 * @author TradeZen Team
 * @created 2026-06-27
 */

import Stock from '../models/Stock.js';
import { logger } from '../config/logger.js';

const clean = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) out[k] = v;
  return out;
};

/**
 * Upsert the latest scan status for many stocks in one bulk write.
 * @param {Array<{symbol,currentPrice,gatesPassed,compositeScore,verdict,droppedAtStage,reachedClaude}>} stocks
 * @param {Date} [at] - scan timestamp
 * @returns {Promise<number>} number of upserts attempted
 */
export async function upsertStockStatuses(stocks, at = new Date()) {
  const rows = (stocks ?? []).filter((s) => s?.symbol);
  if (!rows.length) return 0;
  try {
    const ops = rows.map((s) => ({
      updateOne: {
        filter: { symbol: s.symbol },
        update: {
          $set: clean({
            currentPrice: s.currentPrice,
            lastScan: {
              at,
              gatesPassed: s.gatesPassed ?? null,
              compositeScore: s.compositeScore ?? null,
              verdict: s.verdict ?? null,
              droppedAtStage: s.droppedAtStage ?? null,
              reachedClaude: !!s.reachedClaude,
            },
          }),
          $setOnInsert: { symbol: s.symbol, inUniverse: true },
        },
        upsert: true,
      },
    }));
    const res = await Stock.bulkWrite(ops, { ordered: false });
    logger.info('Stock master: scan statuses upserted', {
      matched: res.matchedCount,
      upserted: res.upsertedCount,
    });
    return ops.length;
  } catch (err) {
    logger.error('upsertStockStatuses failed', { error: err.message });
    return 0;
  }
}

/**
 * Upsert sector + fundamentals + latest market snapshot from a /stock detail object.
 * @param {object} detail - fetchStockDetail output
 * @param {object} [extra] - optional { compositeScore, verdict, signalAt }
 * @returns {Promise<boolean>}
 */
export async function upsertStockDetail(detail, extra = {}) {
  if (!detail?.symbol) return false;
  try {
    const set = clean({
      companyName: detail.companyName,
      sector: detail.sector,
      industry: detail.industry,
      peRatio: detail.peRatio,
      forwardPe: detail.forwardPe,
      marketCap: detail.marketCap,
      beta: detail.beta,
      dividendYield: detail.dividendYield,
      high52w: detail.high52w,
      low52w: detail.low52w,
      currentPrice: detail.currentPrice,
      weeklyTrend: detail.weeklyTrend,
      earningsTimestamp: detail.earningsTimestamp,
      fundamentalsRefreshedAt: new Date(),
    });
    if (extra.compositeScore != null || extra.verdict != null) {
      set.lastScan = clean({
        at: new Date(),
        compositeScore: extra.compositeScore,
        verdict: extra.verdict,
      });
    }
    await Stock.updateOne(
      { symbol: detail.symbol },
      { $set: set, $setOnInsert: { symbol: detail.symbol, inUniverse: true } },
      { upsert: true }
    );
    return true;
  } catch (err) {
    logger.error('upsertStockDetail failed', { symbol: detail.symbol, error: err.message });
    return false;
  }
}
