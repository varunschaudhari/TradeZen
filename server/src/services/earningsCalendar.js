/**
 * @file earningsCalendar.js
 * @description NSE earnings-date feed for Gate 3 (no-earnings-within-15-days hard block).
 *   Fetches the official NSE corporate event calendar (board meetings), keeps entries whose
 *   purpose mentions financial results, and stamps the earliest upcoming date onto each
 *   matching Stock master doc (earningsTimestamp in epoch SECONDS — same convention as the
 *   yfinance value from Python /analyze). The scan pipeline prefers a fresh NSE date over
 *   the yfinance one via getNseEarningsOverride().
 *
 *   NSE session handling (cookie handshake, 401/403 refresh) lives in the shared
 *   nseClient.js. If the fetch fails the refresh is a no-op (yfinance dates keep
 *   flowing) — never fatal.
 *
 * @author TradeZen Team
 * @created 2026-07-02
 */

import mongoose from 'mongoose';
import Stock from '../models/Stock.js';
import {
  NSE_EARNINGS_TIMEOUT_MS,
  NSE_EARNINGS_FRESH_DAYS,
} from '../config/constants.js';
import { nseFetchJson } from './nseClient.js';
import { logger } from '../config/logger.js';

const NSE_CALENDAR_URL = 'https://www.nseindia.com/api/event-calendar?index=equities';
const NSE_CALENDAR_REFERER =
  'https://www.nseindia.com/companies-listing/corporate-filings-event-calendar';
const RESULTS_PURPOSE_RE = /financial\s*result|results/i;

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse an NSE calendar date ("02-Jul-2026") to epoch SECONDS (UTC midnight).
 * Gate 3 only needs day resolution, so midnight UTC is close enough to IST.
 *
 * @param {string} raw
 * @returns {number|null}
 */
export function parseNseDate(raw) {
  const m = String(raw ?? '').trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (month == null) return null;
  return Math.floor(Date.UTC(Number(m[3]), month, Number(m[1])) / 1000);
}

/**
 * Reduce raw NSE calendar rows to { SYMBOL → earliest upcoming results timestamp }.
 * Rows whose purpose doesn't mention results, or whose date is in the past, are dropped.
 *
 * @param {object[]} rows - Raw rows from the NSE event calendar
 * @param {number} [nowSec] - Injectable "now" for tests
 * @returns {Map<string, number>}
 */
export function extractResultsDates(rows, nowSec = Math.floor(Date.now() / 1000)) {
  const out = new Map();
  const cutoff = nowSec - 86_400; // keep today's event even after midnight drift
  for (const row of rows ?? []) {
    const purpose = `${row?.purpose ?? ''} ${row?.bm_desc ?? ''}`;
    if (!RESULTS_PURPOSE_RE.test(purpose)) continue;
    const symbol = String(row?.symbol ?? '').toUpperCase().trim();
    const ts = parseNseDate(row?.date);
    if (!symbol || ts == null || ts < cutoff) continue;
    const existing = out.get(symbol);
    if (existing == null || ts < existing) out.set(symbol, ts);
  }
  return out;
}

/**
 * Fetch the NSE event calendar and update earningsTimestamp on existing Stock docs.
 * Never throws — returns a summary and logs on failure so the cron stays healthy.
 *
 * @returns {Promise<{ ok: boolean, fetched: number, results: number, updated: number, reason?: string }>}
 */
export const refreshEarningsCalendar = async () => {
  const fail = (reason) => {
    logger.warn(`Earnings calendar refresh skipped: ${reason}`);
    return { ok: false, fetched: 0, results: 0, updated: 0, reason };
  };

  try {
    const data = await nseFetchJson(NSE_CALENDAR_URL, {
      referer: NSE_CALENDAR_REFERER,
      timeoutMs: NSE_EARNINGS_TIMEOUT_MS,
    });
    const rows = Array.isArray(data) ? data : (data?.data ?? []);
    const bySymbol = extractResultsDates(rows);
    if (!bySymbol.size) return fail('NSE calendar returned no upcoming results dates');

    if (mongoose.connection.readyState !== 1) return fail('MongoDB not connected');

    const now = new Date();
    // Update only symbols already in the Stock master — never seed new docs from NSE.
    const ops = [...bySymbol.entries()].map(([symbol, ts]) => ({
      updateOne: {
        filter: { symbol },
        update: {
          $set: { earningsTimestamp: ts, earningsSource: 'NSE', earningsRefreshedAt: now },
        },
      },
    }));
    const result = await Stock.bulkWrite(ops, { ordered: false });
    const updated = result.matchedCount ?? 0;
    logger.info('Earnings calendar refreshed from NSE', {
      fetched: rows.length,
      results: bySymbol.size,
      updated,
    });
    return { ok: true, fetched: rows.length, results: bySymbol.size, updated };
  } catch (err) {
    return fail(err.message);
  }
};

/**
 * Gate-3 override: the NSE-sourced earnings timestamp for a symbol, if fresh.
 * Returns null when there's no NSE data or it's stale — caller keeps the yfinance value.
 *
 * @param {string} symbol - NSE symbol
 * @returns {Promise<number|null>} Epoch seconds, or null
 */
export const getNseEarningsOverride = async (symbol) => {
  if (mongoose.connection.readyState !== 1) return null;
  try {
    const doc = await Stock.findOne({ symbol })
      .select('earningsTimestamp earningsSource earningsRefreshedAt')
      .lean();
    if (!doc || doc.earningsSource !== 'NSE' || !doc.earningsTimestamp) return null;
    const ageMs = Date.now() - new Date(doc.earningsRefreshedAt ?? 0).getTime();
    if (ageMs > NSE_EARNINGS_FRESH_DAYS * 86_400_000) return null;
    return doc.earningsTimestamp;
  } catch (err) {
    logger.debug('NSE earnings override lookup failed', { symbol, error: err.message });
    return null;
  }
};
