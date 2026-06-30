/**
 * @file historyCache.js
 * @description Read-through cache for historical price/indicator series. cachedFetch()
 *   returns a fresh-enough cached payload if present, otherwise runs the live fetcher and
 *   stores the result. Cache read/write failures degrade gracefully to a live fetch — the
 *   cache never breaks the caller. Used to wrap the heavy Python history endpoints.
 * @author TradeZen Team
 * @created 2026-06-27
 */

import PriceHistory from '../models/PriceHistory.js';
import { logger } from '../config/logger.js';

const TTL_HOURS = parseInt(process.env.HISTORY_CACHE_TTL_HOURS ?? '12', 10);
export const HISTORY_CACHE_TTL_MS = TTL_HOURS * 60 * 60 * 1000;

/**
 * Read-through cache.
 * @param {string} key - unique cache key
 * @param {number} ttlMs - max age before a cached entry is considered stale
 * @param {() => Promise<any>} fetcher - live fetch (may throw; errors propagate)
 * @param {(payload:any)=>boolean} [isValid] - only cache/serve payloads that pass this
 * @returns {Promise<any>}
 */
export async function cachedFetch(key, ttlMs, fetcher, isValid = (p) => p != null) {
  try {
    const hit = await PriceHistory.findOne({ key }).lean();
    if (hit && Date.now() - new Date(hit.fetchedAt).getTime() < ttlMs && isValid(hit.payload)) {
      return hit.payload;
    }
  } catch (err) {
    logger.warn('historyCache read failed — fetching live', { key, error: err.message });
  }

  const payload = await fetcher(); // may throw — let it propagate (don't cache failures)

  if (isValid(payload)) {
    PriceHistory.updateOne(
      { key },
      { $set: { key, payload, fetchedAt: new Date() } },
      { upsert: true }
    ).catch((err) => logger.warn('historyCache write failed', { key, error: err.message }));
  }
  return payload;
}
