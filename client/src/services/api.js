/**
 * @file api.js
 * @description Centralized axios instance with all API call functions
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-15
 */

import axios from 'axios';

// Default to SAME-ORIGIN (relative '/api') so one reverse proxy / tunnel serves the whole
// app; nginx (and the Vite dev proxy) forward /api to the server. Set VITE_API_URL only if
// the API is hosted on a separate domain.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // send the httpOnly session cookie on every request
});

// Response interceptor — unwrap data, redirect to /login on an expired/missing
// session, or throw normalized errors. The auth check itself (GET /api/auth/me)
// must not redirect on its own 401 — that's the expected "not logged in yet" case.
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const isAuthCheck = error.config?.url?.includes('/api/auth/me');
    if (error.response?.status === 401 && !isAuthCheck && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    const message = error.response?.data?.error ?? error.message ?? 'Network error';
    return Promise.reject(new Error(message));
  }
);

export const authApi = {
  me: () => api.get('/api/auth/me'),
  login: (email, password) => api.post('/api/auth/login', { email, password }),
  logout: () => api.post('/api/auth/logout'),
};

export const signalsApi = {
  getAll: (params) => api.get('/api/signals', { params }),
  getActive: () => api.get('/api/signals/active'),
  getBySymbol: (symbol) => api.get(`/api/signals/${symbol}`),
  triggerScan: () => api.post('/api/signals/scan'),
};

export const tradesApi = {
  getAll:                (params) => api.get('/api/trades', { params }),
  getOpen:               () => api.get('/api/trades/open'),
  getLive:               () => api.get('/api/trades/live'),
  getSectorConcentration:() => api.get('/api/trades/sector-concentration'),
  getAccuracy:           () => api.get('/api/trades/accuracy'),
  getRiskSummary:        () => api.get('/api/trades/risk-summary'),
  refresh:               () => api.post('/api/trades/refresh'),
  create:      (data)    => api.post('/api/trades', data),
  update:      (id, data)=> api.patch(`/api/trades/${id}`, data),
  markT1Hit:   (id)      => api.patch(`/api/trades/${id}/target1`),
  close: (id, exitPrice, exitReason) =>
    api.patch(`/api/trades/${id}/close`, { exitPrice, exitReason }),
};

export const watchlistApi = {
  get:        ()               => api.get('/api/watchlist'),
  add:        (symbol, sector) => api.post('/api/watchlist', { symbol, sector }),
  updateNote: (symbol, notes)  => api.patch(`/api/watchlist/${symbol}`, { notes }),
  remove:     (symbol)         => api.delete(`/api/watchlist/${symbol}`),
};

export const performanceApi = {
  get:          ()            => api.get('/api/performance'),
  getDaily:     (days = 30)  => api.get('/api/performance/daily', { params: { days } }),
  getHistory:   (limit = 12) => api.get('/api/performance/history', { params: { limit } }),
  getBenchmark: ()            => api.get('/api/performance/benchmark'),
};

export const intradayApi = {
  getStats:   (source)     => api.get('/api/intraday/stats', { params: source ? { source } : {} }),
  getSignals: (limit = 50) => api.get('/api/intraday/signals', { params: { limit } }),
  getGoLive:  ()           => api.get('/api/intraday/golive'),
  getLive:    ()           => api.get('/api/intraday/live'),
  logTrade:   (data)       => api.post('/api/intraday/trades', data),
  closeTrade: (id, exitPrice) =>
    api.patch(`/api/intraday/trades/${id}/close`, exitPrice != null ? { exitPrice } : {}),
};

export const disciplineApi = {
  get: (limit = 30) => api.get('/api/discipline', { params: { limit } }),
};

export const marketApi = {
  get: () => api.get('/api/market'),
};

export const quotesApi = {
  // symbols: string[] — returns { SYMBOL: { price, prevClose, change, changePct } }
  get: (symbols) => api.get('/api/quotes', { params: { symbols: symbols.join(',') } }),
};

export const stockApi = {
  getDetail: (symbol) => api.get(`/api/stock/${symbol}`),
};

export const alertsApi = {
  getAll:  ()     => api.get('/api/alerts'),
  create:  (data) => api.post('/api/alerts', data),
  toggle:  (id)   => api.patch(`/api/alerts/${id}/toggle`),
  remove:  (id)   => api.delete(`/api/alerts/${id}`),
};

export const holidaysApi = {
  getAll: () => api.get('/api/holidays'),
};

export const stocksApi = {
  getAll:      (params) => api.get('/api/stocks', { params }),
  getStats:    ()       => api.get('/api/stocks/stats'),
  add:         (data)   => api.post('/api/stocks', data),
  remove:      (symbol) => api.delete(`/api/stocks/${symbol}`),
  toggle:      (symbol) => api.patch(`/api/stocks/${symbol}/toggle`),
  bulkToggle:  (symbols, active) => api.post('/api/stocks/bulk-toggle', { symbols, active }),
};

export const universeApi = {
  get: () => api.get('/api/universe'),
};

export const scanApi = {
  getLatest: () => api.get('/api/scan/latest'),
  getHistory: () => api.get('/api/scan/history'),
  getPrep: () => api.get('/api/scan/prep'),
};

export const monitorApi = {
  getOverview: () => api.get('/api/monitor/overview'),
  getInventory: () => api.get('/api/monitor/inventory'),
  getCatalog: () => api.get('/api/monitor/catalog'),
  getProgress: () => api.get('/api/monitor/progress'),
  getEvents: () => api.get('/api/monitor/events'),
  getCalibration: () => api.get('/api/monitor/calibration', { timeout: 300000 }),
  triggerScan: () => api.post('/api/monitor/scan'),
  setScanner: (enabled) => api.patch('/api/monitor/scanner', { enabled }),
};

export const newsApi = {
  getBySymbol: (symbol) => api.get(`/api/news/${symbol}`),
};

export const configApi = {
  get: () => api.get('/api/config'),
  update: (data) => api.patch('/api/config', data),
};

export const ohlcvApi = {
  get: (symbol, period = '60d', interval = '15m') =>
    api.get(`/api/ohlcv/${symbol}`, { params: { period, interval } }),
};

export const pricesApi = {
  update: (prices) => api.post('/api/prices/update', { prices }),
};

export const analysisApi = {
  // The 23-section report is compute-heavy (backtest, Monte Carlo, liquidity, several
  // Python data fetches) — the first call for a symbol is the slowest (cold OHLCV cache).
  // Override the 30s global default with a 120s leash so it never times out client-side.
  getReport: (symbol) => api.get(`/api/analysis/${symbol}`, { timeout: 120000 }),
};

export const gatesApi = {
  getAnalytics: (days = 30) => api.get('/api/gates', { params: { days } }),
};

export const searchApi = {
  global: (q, limit = 5) => api.get('/api/search', { params: { q, limit } }),
};

export const backtestApi = {
  // Single setup replay — cached 30 days on server
  setup: (data) => api.post('/api/backtest/setup', data, { timeout: 180000 }),
  // Walk-forward across symbols/modes — can take 1-3 min
  run: (data) => api.post('/api/backtest/run', data, { timeout: 300000 }),
  // Per-signal flag edge analysis
  signalEdge: (data) => api.post('/api/backtest/signal-edge', data, { timeout: 300000 }),
  // Cached results list
  results: (symbol) => api.get('/api/backtest/results', { params: symbol ? { symbol } : {} }),
};

export const exportApi = {
  signalsUrl: (params = {}) => {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v != null && v !== '' && v !== 'ALL' && v !== 0)
    );
    const q = new URLSearchParams(clean).toString();
    return `/api/signals/export${q ? '?' + q : ''}`;
  },
  tradesUrl: () => '/api/trades/export',
};

export default api;
