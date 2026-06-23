/**
 * @file api.js
 * @description Centralized axios instance with all API call functions
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-15
 */

import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:5000',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Response interceptor — unwrap data or throw normalized errors
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const message = error.response?.data?.error ?? error.message ?? 'Network error';
    return Promise.reject(new Error(message));
  }
);

export const signalsApi = {
  getAll: (params) => api.get('/api/signals', { params }),
  getActive: () => api.get('/api/signals/active'),
  getBySymbol: (symbol) => api.get(`/api/signals/${symbol}`),
  triggerScan: () => api.post('/api/signals/scan'),
};

export const tradesApi = {
  getAll: () => api.get('/api/trades'),
  getOpen: () => api.get('/api/trades/open'),
  create: (data) => api.post('/api/trades', data),
  update: (id, data) => api.patch(`/api/trades/${id}`, data),
  markT1Hit: (id) => api.patch(`/api/trades/${id}/target1`),
  close: (id, exitPrice, exitReason) =>
    api.patch(`/api/trades/${id}/close`, { exitPrice, exitReason }),
};

export const watchlistApi = {
  get: () => api.get('/api/watchlist'),
  add: (symbol, sector) => api.post('/api/watchlist', { symbol, sector }),
  remove: (symbol) => api.delete(`/api/watchlist/${symbol}`),
};

export const performanceApi = {
  get: () => api.get('/api/performance'),
  getHistory: (limit = 12) => api.get('/api/performance/history', { params: { limit } }),
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

export const universeApi = {
  get: () => api.get('/api/universe'),
};

export const scanApi = {
  getLatest: () => api.get('/api/scan/latest'),
  getHistory: () => api.get('/api/scan/history'),
};

export const newsApi = {
  getBySymbol: (symbol) => api.get(`/api/news/${symbol}`),
};

export const chatApi = {
  ask: (message, context) => api.post('/api/chat', { message, context }),
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

export default api;
