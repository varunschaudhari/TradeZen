/**
 * @file pythonBridge.js
 * @description HTTP client for the Python FastAPI microservice.
 *
 * Resilience strategy:
 *   • 1 automatic retry (linear 2 s backoff) on network/timeout/5xx errors.
 *   • 4xx errors are NOT retried — a bad request will not improve on retry.
 *   • checkPythonHealth() lets the scanner bail early instead of failing per-stock.
 *
 * All three exported functions maintain the same signatures as before so no
 * callers (marketScanner, routes/ohlcv, routes/market) need to change.
 */

import axios from 'axios';
import { PYTHON_SERVICE_URL } from '../config/constants.js';
import { logger } from '../config/logger.js';

// ── Axios client ──────────────────────────────────────────────────────────────

const pythonClient = axios.create({
  baseURL: PYTHON_SERVICE_URL,
  timeout: 60_000,
});

// ── Retry helper ──────────────────────────────────────────────────────────────

const RETRY_COUNT = 1; // 1 retry = 2 total attempts
const RETRY_BASE_MS = 2_000; // 2 s between attempts (linear)

/**
 * Calls `fn` up to `retries + 1` times.
 * 4xx responses propagate immediately — no retry, they are logic errors.
 * Network errors and 5xx are retried after a linear delay.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {number} [retries=RETRY_COUNT]
 * @returns {Promise<T>}
 */
async function withRetry(fn, retries = RETRY_COUNT) {
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_MS * attempt;
      logger.warn('pythonBridge: retrying request', { attempt, delay });
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      // 4xx → caller's fault; do not retry
      if (status && status >= 400 && status < 500) throw err;
      // Log transient error and continue to next attempt
      logger.warn('pythonBridge: transient error', {
        attempt,
        code: err.code,
        status,
        message: err.message,
      });
    }
  }

  throw lastErr;
}

// ── Error message formatter ───────────────────────────────────────────────────

/**
 * Produces a human-readable message from an axios error — used in thrown Error
 * messages so callers and logs contain actionable detail.
 *
 * @param {import('axios').AxiosError} err
 * @returns {string}
 */
function axiosErrMsg(err) {
  if (err.response) {
    const body = JSON.stringify(err.response.data ?? {}).slice(0, 200);
    return `HTTP ${err.response.status}: ${body}`;
  }
  if (err.code === 'ECONNABORTED') return `Timeout (>${pythonClient.defaults.timeout} ms)`;
  if (err.code === 'ECONNREFUSED') return 'Python service not running (ECONNREFUSED)';
  if (err.code === 'ENOTFOUND') return `Host not found: ${err.hostname ?? PYTHON_SERVICE_URL}`;
  return err.message;
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Quick liveness check — returns true only if Python service responds healthy.
 * Call this at scanner startup to fail fast rather than spamming error logs
 * for every symbol in the watchlist.
 *
 * @returns {Promise<boolean>}
 */
export const checkPythonHealth = async () => {
  try {
    const res = await pythonClient.get('/health', { timeout: 5_000 });
    return res.data?.status === 'healthy';
  } catch {
    return false;
  }
};

// Analyze in chunks so a large candidate set never exceeds the per-request timeout.
// Python /analyze processes symbols sequentially (~1–2s each via yfinance), so ~45
// symbols in one call blew past the 60s client timeout and aborted the whole scan.
const ANALYZE_CHUNK_SIZE = 12;

/**
 * POST /analyze — run the full technical-analysis pipeline for a list of NSE symbols.
 *
 * Symbols are sent in chunks of ANALYZE_CHUNK_SIZE and the results merged, so one slow
 * or timed-out chunk degrades to per-symbol errors instead of aborting the entire scan.
 * Never throws — a fully failed chunk yields `{ symbol, error }` entries.
 *
 * @param {string[]} symbols   - NSE symbols without suffix (e.g. ['RELIANCE', 'TCS'])
 * @param {number}   capital   - Current trading capital in INR
 * @param {number}   riskPct   - Risk percentage per trade (e.g. 1 for 1%)
 * @returns {Promise<{ results: object[], analyzedCount: number, errorCount: number }>}
 */
export const analyzeStocks = async (symbols, capital, riskPct) => {
  const merged = { results: [], analyzedCount: 0, errorCount: 0 };

  for (let i = 0; i < symbols.length; i += ANALYZE_CHUNK_SIZE) {
    const chunk = symbols.slice(i, i + ANALYZE_CHUNK_SIZE);
    try {
      const response = await withRetry(() =>
        pythonClient.post('/analyze', { symbols: chunk, capital, riskPct })
      );
      const data = response.data ?? {};
      merged.results.push(...(data.results ?? []));
      merged.analyzedCount += data.analyzedCount ?? data.results?.length ?? 0;
      merged.errorCount += data.errorCount ?? 0;
    } catch (err) {
      const msg = axiosErrMsg(err);
      logger.error('Python /analyze chunk failed — continuing with remaining chunks', {
        chunkSize: chunk.length,
        error: msg,
      });
      for (const symbol of chunk) merged.results.push({ symbol, error: `analyze failed: ${msg}` });
      merged.errorCount += chunk.length;
    }
  }

  return merged;
};

/**
 * POST /screen — pre-filter the static NSE universe (Step 2) to a candidate shortlist.
 *
 * Runs 6 cheap filters (liquidity, market-cap tier, trend, momentum, ATR, earnings)
 * in the Python service so only survivors are sent to the heavy /analyze pipeline.
 * The screen downloads OHLCV for the whole universe, so it can be slow — uses the
 * longer client timeout and is allowed to retry on transient failure.
 *
 * @param {object}   [opts]
 * @param {string[]|null} [opts.tiers=null]        - Index tiers to include (null = all)
 * @param {boolean}  [opts.checkEarnings=true]      - Apply the earnings pre-filter
 * @param {string[]} [opts.extraSymbols=[]]         - Watchlist overlay always screened
 * @returns {Promise<{ candidates: object[], universeCount: number, screenedCount: number, candidateCount: number, rejectionCounts: object }>}
 */
export const screenUniverse = async ({
  tiers = null,
  checkEarnings = true,
  extraSymbols = [],
} = {}) => {
  try {
    const response = await withRetry(() =>
      pythonClient.post(
        '/screen',
        { tiers, checkEarnings, extraSymbols },
        { timeout: 300_000 } // universe-wide OHLCV download can take minutes
      )
    );
    return response.data;
  } catch (err) {
    const msg = axiosErrMsg(err);
    logger.error('Python /screen failed', { error: msg });
    throw new Error(`Python service /screen unavailable: ${msg}`);
  }
};

/**
 * GET /market — fetch live Nifty 50, Bank Nifty, India VIX, and A/D ratio.
 * Called before every scan cycle to check Gate 1 and market mode.
 *
 * @returns {Promise<{ nifty50: object, bankNifty: object, vix: number|null, adRatio: number|null }>}
 */
export const fetchMarketData = async () => {
  try {
    const response = await withRetry(() => pythonClient.get('/market'));
    return response.data;
  } catch (err) {
    const msg = axiosErrMsg(err);
    logger.error('Python /market failed', { error: msg });
    throw new Error(`Python service /market unavailable: ${msg}`);
  }
};

/**
 * GET /nifty-history — fetch Nifty 50 daily closes for the relative-strength signal.
 * Returns [] on failure so the scan degrades gracefully (RS becomes neutral).
 *
 * @param {string} [period='1y'] - yfinance period string
 * @returns {Promise<number[]>} Daily closes (oldest→newest)
 */
export const fetchNiftyHistory = async (period = '1y') => {
  try {
    const response = await withRetry(() =>
      pythonClient.get('/nifty-history', { params: { period } })
    );
    return response.data?.closes ?? [];
  } catch (err) {
    logger.warn('Python /nifty-history failed — relative strength will be neutral', {
      error: axiosErrMsg(err),
    });
    return [];
  }
};

/**
 * GET /nifty-history — Nifty closes WITH dates (for backtest date alignment).
 *
 * @param {string} [period='2y'] - yfinance period
 * @returns {Promise<{ dates: string[], closes: number[] }>} empty arrays on failure
 */
export const fetchNiftySeries = async (period = '2y') => {
  try {
    const response = await withRetry(() =>
      pythonClient.get('/nifty-history', { params: { period }, timeout: 60_000 })
    );
    return { dates: response.data?.dates ?? [], closes: response.data?.closes ?? [] };
  } catch (err) {
    logger.warn('Python /nifty-history (series) failed', { error: axiosErrMsg(err) });
    return { dates: [], closes: [] };
  }
};

/**
 * GET /universe — the full static NSE universe symbol list (for full-universe backtests).
 *
 * @returns {Promise<string[]>} Symbols, or [] on failure
 */
export const fetchUniverse = async () => {
  try {
    const response = await withRetry(() => pythonClient.get('/universe', { timeout: 15_000 }));
    return response.data?.symbols ?? [];
  } catch (err) {
    logger.error('Python /universe failed', { error: axiosErrMsg(err) });
    return [];
  }
};

/**
 * GET /indicator-series/:symbol — per-bar OHLCV + indicators for backtesting.
 *
 * @param {string} symbol - NSE symbol (without .NS)
 * @param {string} [period='2y'] - yfinance period
 * @returns {Promise<{ symbol: string, bars: number, series: object }|null>} null on failure
 */
export const fetchIndicatorSeries = async (symbol, period = '2y') => {
  try {
    const response = await withRetry(() =>
      pythonClient.get(`/indicator-series/${symbol}`, { params: { period }, timeout: 120_000 })
    );
    return response.data;
  } catch (err) {
    logger.error('Python /indicator-series failed', { symbol, error: axiosErrMsg(err) });
    return null;
  }
};

/**
 * GET /quotes — batch live price snapshot for a list of NSE symbols.
 * Returns {} on failure so dashboard cards degrade to "no live price" instead of erroring.
 *
 * @param {string[]} symbols - NSE symbols without suffix
 * @returns {Promise<Record<string, { price: number|null, prevClose: number|null, change: number|null, changePct: number|null }>>}
 */
export const fetchQuotes = async (symbols) => {
  if (!symbols?.length) return {};
  try {
    const response = await withRetry(() =>
      pythonClient.get('/quotes', { params: { symbols: symbols.join(',') }, timeout: 20_000 })
    );
    return response.data?.quotes ?? {};
  } catch (err) {
    logger.warn('Python /quotes failed — cards will show no live price', { error: axiosErrMsg(err) });
    return {};
  }
};

/**
 * GET /stock/:symbol — full on-demand analysis + fundamentals (P/E, market cap, sector)
 * for the dedicated stock detail page.
 *
 * @param {string} symbol - NSE symbol (without .NS)
 * @returns {Promise<object>} StockDetail object
 */
export const fetchStockDetail = async (symbol) => {
  try {
    const response = await withRetry(() =>
      pythonClient.get(`/stock/${symbol}`, { timeout: 30_000 })
    );
    return response.data;
  } catch (err) {
    const msg = axiosErrMsg(err);
    logger.error('Python /stock failed', { symbol, error: msg });
    throw new Error(`Stock detail unavailable for ${symbol}: ${msg}`);
  }
};

/**
 * GET /ohlcv/:symbol — fetch OHLCV candlestick data for the dashboard chart.
 *
 * @param {string} symbol               - NSE symbol (without .NS)
 * @param {string} [period='60d']       - yfinance period string
 * @param {string} [interval='15m']     - yfinance interval string
 * @returns {Promise<{ symbol: string, interval: string, data: Array<{ time: number, open: number, high: number, low: number, close: number, volume: number }> }>}
 */
export const fetchOhlcv = async (symbol, period = '60d', interval = '15m') => {
  try {
    const response = await withRetry(() =>
      pythonClient.get(`/ohlcv/${symbol}`, { params: { period, interval } })
    );
    return response.data;
  } catch (err) {
    const msg = axiosErrMsg(err);
    logger.error('Python /ohlcv failed', { symbol, period, interval, error: msg });
    throw new Error(`OHLCV unavailable for ${symbol}: ${msg}`);
  }
};
