/**
 * @file quoteService.js
 * @description Phase 3 — the single quote facade every price consumer goes through
 *   (position monitor, entry watcher, ORB confirmation, /api/quotes). Providers are
 *   tried best-first, each filling only the symbols the previous one missed:
 *
 *     1. (future slot) broker WebSocket feed — true ticks; drops in here if a broker
 *        data API is ever added. DATA ONLY if so: order endpoints stay forbidden.
 *     2. Yahoo v8 live quotes (liveQuotes.js) — 2–6s lag, free, circuit-broken
 *     3. yfinance via Python /quotes — ~15 min lag, the always-there floor
 *
 *   Return shape is a superset of the old fetchQuotes shape, so consumers that only
 *   read { price, prevClose, change, changePct } keep working untouched; `source`
 *   ('YAHOO_LIVE' | 'YFINANCE') and `asOf` let newer callers reason about freshness.
 *
 * @author TradeZen Team
 * @created 2026-07-07
 */

import { LIVE_QUOTES_ENABLED } from '../config/constants.js';
import { getLiveQuotes } from './liveQuotes.js';
import { fetchQuotes } from './pythonBridge.js';

/**
 * Batch quotes, best available source per symbol. Never throws; symbols nothing
 * could serve are simply absent from the result.
 *
 * @param {string[]} symbols - NSE symbols without suffix
 * @returns {Promise<Record<string, { price:number|null, prevClose:number|null,
 *   change:number|null, changePct:number|null, source:string, asOf:string|null }>>}
 */
export const getQuotes = async (symbols) => {
  const wanted = [...new Set((symbols ?? []).filter(Boolean))];
  if (!wanted.length) return {};

  const out = LIVE_QUOTES_ENABLED ? await getLiveQuotes(wanted) : {};

  const missing = wanted.filter((s) => out[s]?.price == null);
  if (missing.length) {
    const fallback = await fetchQuotes(missing);
    for (const sym of missing) {
      const q = fallback[sym];
      if (q?.price != null) out[sym] = { ...q, source: 'YFINANCE', asOf: null };
    }
  }
  return out;
};
