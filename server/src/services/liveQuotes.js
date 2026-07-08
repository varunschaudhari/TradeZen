/**
 * @file liveQuotes.js
 * @description Phase 3 — near-real-time NSE LTP via Yahoo's v8 chart API (measured lag
 *   2–6 seconds mid-session vs ~15 minutes for the yfinance 5m-bar path). No broker
 *   account, no credentials. NSE's own quote APIs were the first choice but are
 *   bot-blocked (403/404 even with a valid cookie session); Yahoo's quote meta is the
 *   reliable free source, and each quote carries its exchange timestamp so freshness
 *   is measured, not assumed.
 *
 *   Built defensively:
 *     - per-symbol in-memory cache (LIVE_QUOTES_CACHE_MS)
 *     - bounded concurrency + hard per-cycle cap (LIVE_QUOTES_MAX_SYMBOLS)
 *     - circuit breaker: LIVE_QUOTES_FAILURE_THRESHOLD consecutive failures → quiet
 *       for LIVE_QUOTES_FAILURE_BACKOFF_MS; quoteService falls back to the Python
 *       yfinance path — degraded latency, never an outage.
 *
 * @author TradeZen Team
 * @created 2026-07-07
 */

import {
  LIVE_QUOTES_CACHE_MS,
  LIVE_QUOTES_CONCURRENCY,
  LIVE_QUOTES_FAILURE_BACKOFF_MS,
  LIVE_QUOTES_FAILURE_THRESHOLD,
  LIVE_QUOTES_MAX_SYMBOLS,
  LIVE_QUOTES_TIMEOUT_MS,
} from '../config/constants.js';
import { logger } from '../config/logger.js';

const quoteUrl = (symbol) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?interval=1d&range=1d`;
const HEADERS = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };

const round2 = (n) => Math.round(n * 100) / 100;

/** @type {Map<string, { quote: object, expiresAt: number }>} */
const cache = new Map();
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

/** True while the breaker is open (recent consecutive feed failures). */
export function isLiveQuotesBackedOff() {
  return Date.now() < circuitOpenUntil;
}

/** Reset cache + breaker (tests). */
export function resetLiveQuotesState() {
  cache.clear();
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

/**
 * Map a Yahoo v8 chart payload to the app-wide quote shape (pure).
 * `asOf` is the EXCHANGE quote timestamp (regularMarketTime) — real freshness.
 *
 * @param {object} data - Raw v8 finance/chart JSON
 * @returns {{ price:number, prevClose:number|null, change:number|null,
 *   changePct:number|null, asOf:string|null }|null}
 */
export function parseYahooQuote(data) {
  const meta = data?.chart?.result?.[0]?.meta;
  const price = Number(meta?.regularMarketPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  const prevRaw = Number(meta?.chartPreviousClose ?? meta?.previousClose);
  const prevClose = Number.isFinite(prevRaw) && prevRaw > 0 ? round2(prevRaw) : null;
  const marketTime = Number(meta?.regularMarketTime);
  return {
    price: round2(price),
    prevClose,
    change: prevClose != null ? round2(price - prevClose) : null,
    changePct: prevClose != null ? round2(((price - prevClose) / prevClose) * 100) : null,
    asOf: Number.isFinite(marketTime) && marketTime > 0
      ? new Date(marketTime * 1000).toISOString()
      : null,
  };
}

async function fetchOne(symbol) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_QUOTES_TIMEOUT_MS);
  try {
    const res = await fetch(quoteUrl(symbol), { headers: HEADERS, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseYahooQuote(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Near-real-time quotes for a symbol list. Partial by design: symbols the feed
 * couldn't serve are simply absent — quoteService fills the gaps from yfinance.
 * Never throws.
 *
 * @param {string[]} symbols - NSE symbols without suffix
 * @returns {Promise<Record<string, object>>} { SYM: { price, prevClose, change,
 *   changePct, source:'YAHOO_LIVE', asOf } }
 */
export const getLiveQuotes = async (symbols) => {
  const out = {};
  const wanted = [...new Set((symbols ?? []).filter(Boolean))].slice(0, LIVE_QUOTES_MAX_SYMBOLS);
  if (!wanted.length) return out;

  const now = Date.now();
  const misses = [];
  for (const sym of wanted) {
    const hit = cache.get(sym);
    if (hit && now < hit.expiresAt) out[sym] = hit.quote;
    else misses.push(sym);
  }
  if (!misses.length || isLiveQuotesBackedOff()) return out;

  let cursor = 0;
  let tripped = false;
  const worker = async () => {
    while (cursor < misses.length && !tripped) {
      const sym = misses[cursor];
      cursor += 1;
      try {
        const quote = await fetchOne(sym);
        if (!quote) continue; // unknown symbol / malformed payload — not a feed failure
        const stamped = { ...quote, source: 'YAHOO_LIVE' };
        cache.set(sym, { quote: stamped, expiresAt: Date.now() + LIVE_QUOTES_CACHE_MS });
        out[sym] = stamped;
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= LIVE_QUOTES_FAILURE_THRESHOLD) {
          circuitOpenUntil = Date.now() + LIVE_QUOTES_FAILURE_BACKOFF_MS;
          tripped = true;
          logger.warn('Live quotes backing off — falling back to yfinance', {
            failures: consecutiveFailures,
            backoffMs: LIVE_QUOTES_FAILURE_BACKOFF_MS,
            lastError: err.message,
          });
        } else {
          logger.debug('Live quote fetch failed', { symbol: sym, error: err.message });
        }
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(LIVE_QUOTES_CONCURRENCY, misses.length) }, worker)
  );
  return out;
};
