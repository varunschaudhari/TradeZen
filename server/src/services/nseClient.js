/**
 * @file nseClient.js
 * @description Shared NSE-website HTTP client. NSE's API rejects bare requests: a
 *   browser-style cookie handshake against the homepage is required first, then API
 *   calls must carry those cookies + a Referer. This module owns that session (cached
 *   ~8 min, refreshed once on 401/403) so every NSE-backed feature — the earnings
 *   calendar and the Phase 3 live quotes — shares one handshake instead of hammering
 *   the homepage. All calls are best-effort: callers must treat failures as "no data",
 *   never as fatal.
 * @author TradeZen Team
 * @created 2026-07-07
 */

const NSE_HOME_URL = 'https://www.nseindia.com/';
const SESSION_TTL_MS = 8 * 60_000;

export const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

let _session = { cookie: null, expiresAt: 0 };

/**
 * Fetch with an AbortController timeout (native fetch, Node 18+).
 * @param {string} url
 * @param {object} headers
 * @param {number} timeoutMs
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, headers, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Session cookies for NSE API calls (cached; homepage handshake on miss).
 *
 * @param {number} [timeoutMs=10000]
 * @param {boolean} [force=false] - Discard the cached session and re-handshake
 * @returns {Promise<string|null>} Cookie header value, or null on failure
 */
export async function getNseSession(timeoutMs = 10_000, force = false) {
  if (!force && _session.cookie && Date.now() < _session.expiresAt) return _session.cookie;
  try {
    const res = await fetchWithTimeout(NSE_HOME_URL, BROWSER_HEADERS, timeoutMs);
    const setCookies =
      typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    if (!setCookies.length) return null;
    _session = {
      cookie: setCookies.map((c) => c.split(';')[0]).join('; '),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    return _session.cookie;
  } catch {
    return null;
  }
}

/** Drop the cached session (tests / forced refresh). */
export function clearNseSession() {
  _session = { cookie: null, expiresAt: 0 };
}

/**
 * GET an NSE API URL as JSON through the shared session. Retries exactly once with a
 * fresh handshake on 401/403 (expired cookies). Throws on any failure.
 *
 * @param {string} url - Full NSE API URL
 * @param {object} [opts]
 * @param {string} [opts.referer] - Referer header (some endpoints require a page URL)
 * @param {number} [opts.timeoutMs=10000]
 * @returns {Promise<any>} Parsed JSON
 */
export async function nseFetchJson(url, { referer = NSE_HOME_URL, timeoutMs = 10_000 } = {}) {
  let cookie = await getNseSession(timeoutMs);
  if (!cookie) throw new Error('NSE cookie handshake failed');

  const headers = () => ({
    ...BROWSER_HEADERS,
    Accept: 'application/json',
    Cookie: cookie,
    Referer: referer,
  });
  let res = await fetchWithTimeout(url, headers(), timeoutMs);
  if (res.status === 401 || res.status === 403) {
    cookie = await getNseSession(timeoutMs, true);
    if (!cookie) throw new Error('NSE session refresh failed');
    res = await fetchWithTimeout(url, headers(), timeoutMs);
  }
  if (!res.ok) throw new Error(`NSE HTTP ${res.status}`);
  return res.json();
}
