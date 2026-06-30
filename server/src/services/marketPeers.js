/**
 * @file marketPeers.js
 * @description Shared real-data helpers for peer comparison & sector momentum. Peers come
 *   from the persistent Stock master (real sectors), and per-symbol stats come from live
 *   quotes + the (cached) daily history — so these sections use real market data instead
 *   of the fabricated/random placeholders they shipped with.
 * @author TradeZen Team
 * @created 2026-06-27
 */

import Stock from '../models/Stock.js';
import { fetchQuotes, fetchOhlcv } from './pythonBridge.js';
import { logger } from '../config/logger.js';

const LOOKBACK_BARS = 20; // ~1 month of trading days for the relative-strength window

/**
 * Real same-sector peers from the Stock master.
 * @param {string} symbol - the stock being analyzed
 * @param {string} sector - its sector (from /stock detail)
 * @param {number} [limit=5]
 * @returns {Promise<string[]>} peer symbols (excludes the input symbol)
 */
export async function getSectorPeers(symbol, sector, limit = 5) {
  if (!sector || sector === 'Unknown') return [];
  try {
    const peers = await Stock.find({ sector, symbol: { $ne: symbol } })
      .select('symbol')
      .limit(limit)
      .lean();
    return peers.map((p) => p.symbol);
  } catch (err) {
    logger.warn('getSectorPeers failed', { symbol, sector, error: err.message });
    return [];
  }
}

/**
 * Real per-symbol stats: live price + day change (quotes) and 20-day return (cached daily
 * history). Used to rank a stock against its peers on genuine performance.
 * @param {string[]} symbols
 * @returns {Promise<Record<string,{price:number|null,changePct:number|null,return20d:number|null}>>}
 */
export async function getSymbolStats(symbols) {
  const list = [...new Set(symbols)].filter(Boolean);
  if (!list.length) return {};
  const quotes = await fetchQuotes(list).catch(() => ({}));
  const out = {};
  await Promise.all(
    list.map(async (sym) => {
      const q = quotes[sym] ?? {};
      let return20d = null;
      try {
        const res = await fetchOhlcv(sym, '1y', '1d'); // cached in PriceHistory
        const bars = res?.data ?? [];
        if (bars.length > LOOKBACK_BARS) {
          const last = bars[bars.length - 1]?.close;
          const past = bars[bars.length - 1 - LOOKBACK_BARS]?.close;
          if (last != null && past) return20d = Math.round(((last - past) / past) * 1000) / 10;
        }
      } catch {
        /* leave return20d null — degrade gracefully */
      }
      out[sym] = {
        price: q.price ?? null,
        changePct: q.changePct ?? null,
        return20d,
      };
    })
  );
  return out;
}
