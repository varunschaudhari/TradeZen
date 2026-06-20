/**
 * @file newsSources.js
 * @description Flow 6 (part 1) — raw news source fetchers for Gate 8. Pulls from
 *              Google News RSS, Moneycontrol RSS, and (best-effort) NSE corporate
 *              announcements, then merges + de-duplicates. Each source fails soft
 *              (returns []) so one dead source never blocks a scan.
 * @author TradeZen Team
 * @created 2026-06-20
 * @lastModified 2026-06-20
 */

import Parser from 'rss-parser';
import { NEWS_SOURCE_TIMEOUT_MS } from '../config/constants.js';
import { logger } from '../config/logger.js';

const rssParser = new Parser({
  timeout: NEWS_SOURCE_TIMEOUT_MS,
  headers: { 'User-Agent': 'TradeZen/2.0 (+https://localhost)' },
});

const GOOGLE_TAKE = 10;
const MONEYCONTROL_TAKE = 5;
const NSE_TAKE = 5;
const MONEYCONTROL_RSS = 'https://www.moneycontrol.com/rss/latestnews.xml';
const FRESH_WINDOW_MS = 48 * 60 * 60 * 1000; // only keep items from the last 48h

/**
 * Normalize a headline title for de-duplication (lowercase, collapse whitespace).
 *
 * @param {string} title - Raw headline
 * @returns {string} Normalized key
 */
function normalizeTitle(title) {
  return String(title ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Map an rss-parser item to our internal headline shape, dropping stale items.
 *
 * @param {object} item - rss-parser item
 * @param {string} source - Source label
 * @returns {{ title: string, source: string, publishedAt: Date|null }|null}
 */
function toHeadline(item, source) {
  const title = (item.title ?? '').trim();
  if (!title) return null;
  const ts = item.isoDate ?? item.pubDate;
  const publishedAt = ts ? new Date(ts) : null;
  if (publishedAt && Date.now() - publishedAt.getTime() > FRESH_WINDOW_MS) return null;
  return { title, source, publishedAt };
}

/**
 * SOURCE 1 — Google News RSS search for the company.
 *
 * @param {string} companyName - Full company name or symbol
 * @returns {Promise<object[]>} Headline objects (empty on failure)
 */
export async function fetchGoogleNews(companyName) {
  try {
    const query = encodeURIComponent(`${companyName} NSE stock India`);
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`;
    const feed = await rssParser.parseURL(url);
    return (feed.items ?? [])
      .slice(0, GOOGLE_TAKE)
      .map((item) => toHeadline(item, 'GoogleNews'))
      .filter(Boolean);
  } catch (err) {
    logger.warn('Google News fetch failed', { error: err.message });
    return [];
  }
}

/**
 * SOURCE 2 — Moneycontrol latest-news RSS, filtered to the company.
 *
 * @param {string} companyName - Full company name
 * @param {string} symbol - NSE symbol (secondary match)
 * @returns {Promise<object[]>} Headline objects (empty on failure)
 */
export async function fetchMoneycontrol(companyName, symbol) {
  try {
    const feed = await rssParser.parseURL(MONEYCONTROL_RSS);
    const needle = companyName.toLowerCase();
    const sym = symbol.toLowerCase();
    return (feed.items ?? [])
      .filter((item) => {
        const t = (item.title ?? '').toLowerCase();
        return t.includes(needle) || t.includes(sym);
      })
      .slice(0, MONEYCONTROL_TAKE)
      .map((item) => toHeadline(item, 'Moneycontrol'))
      .filter(Boolean);
  } catch (err) {
    logger.warn('Moneycontrol fetch failed', { error: err.message });
    return [];
  }
}

/**
 * SOURCE 3 — NSE corporate announcements (best-effort).
 *
 * NSE's API requires a browser cookie handshake and usually rejects unauthenticated
 * requests, so this returns [] in practice until proper NSE access is wired in. The
 * structure is here so it can be enabled without touching the orchestration.
 *
 * @param {string} symbol - NSE symbol
 * @returns {Promise<object[]>} Headline objects (empty on failure/blocked)
 */
export async function fetchNseAnnouncements(symbol) {
  const url = `https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(symbol)}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NEWS_SOURCE_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    const rows = Array.isArray(data) ? data : (data?.data ?? []);
    return rows
      .slice(0, NSE_TAKE)
      .map((row) => toHeadline({ title: row.subject ?? row.desc, pubDate: row.an_dt }, 'NSE'))
      .filter(Boolean);
  } catch (err) {
    logger.debug('NSE announcements unavailable (expected without cookie handshake)', {
      error: err.message,
    });
    return [];
  }
}

/**
 * Fetch all sources in parallel, de-duplicate by normalized title, sort newest-first.
 *
 * @param {string} symbol - NSE symbol (e.g. 'RELIANCE')
 * @param {string} companyName - Full company name (defaults to symbol)
 * @returns {Promise<{ headlines: string[], items: object[], sources: string[] }>}
 */
export async function gatherHeadlines(symbol, companyName) {
  const name = companyName || symbol;
  const settled = await Promise.allSettled([
    fetchGoogleNews(name),
    fetchMoneycontrol(name, symbol),
    fetchNseAnnouncements(symbol),
  ]);
  const all = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

  const seen = new Set();
  const deduped = [];
  for (const item of all) {
    const key = normalizeTitle(item.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  deduped.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));

  const sources = [...new Set(deduped.map((item) => item.source))];
  return { headlines: deduped.map((item) => item.title), items: deduped, sources };
}
