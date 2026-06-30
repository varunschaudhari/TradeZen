/**
 * @file Stocks.jsx
 * @description Full universe catalog — every scannable NSE symbol with its most-recent
 *   scan status (aggregated across recent scans), latest signal, gates, composite score,
 *   and drop stage. Searchable, filterable by sector / status, sortable, paginated.
 *   Symbols never scanned in the recent window show as "pending". Auto-refreshes on
 *   scan:complete. Click any row → full analysis report.
 * @author TradeZen Team
 * @created 2026-06-27
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import useSocket from '../hooks/useSocket.js';
import { monitorApi } from '../services/api.js';
import { SOCKET_EVENTS, SCAN_STAGE_STYLES } from '../utils/constants.js';
import { timeAgo, formatIndianNumber } from '../utils/formatters.js';

const PAGE_SIZE = 50;
const fmtPrice = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`);

const STATUS_FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'SCANNED', label: 'Scanned' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'WATCHLIST', label: 'Watchlist' },
  { key: 'SIGNALS', label: 'Has signal' },
  { key: 'BUY', label: 'BUY' },
];

const StageBadge = ({ stage }) =>
  stage ? (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border ${SCAN_STAGE_STYLES[stage] ?? 'bg-slate-700/40 text-slate-300 border-slate-600'}`}>
      {stage}
    </span>
  ) : (
    <span className="text-[10px] text-slate-600">pending</span>
  );
StageBadge.propTypes = { stage: PropTypes.string };

const Stocks = () => {
  const { subscribe } = useSocket();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [sortKey, setSortKey] = useState('score'); // score | symbol | gates | lastScan
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await monitorApi.getCatalog();
      setData(res.data ?? null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Refresh when a scan finishes.
  useEffect(() => {
    const unsub = subscribe(SOCKET_EVENTS.SCAN_COMPLETE, () => load());
    return () => unsub();
  }, [subscribe, load]);

  const stocks = data?.stocks ?? [];

  // Sector dropdown options derived from the data.
  const sectors = useMemo(() => {
    const set = new Set(stocks.map((s) => s.sector));
    return ['ALL', ...[...set].sort()];
  }, [stocks]);

  // Apply filters.
  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return stocks.filter((s) => {
      if (q && !s.symbol.includes(q)) return false;
      if (sector !== 'ALL' && s.sector !== sector) return false;
      if (status === 'SCANNED') return s.scanned;
      if (status === 'PENDING') return !s.scanned;
      if (status === 'WATCHLIST') return s.inWatchlist;
      if (status === 'SIGNALS') return !!s.signal;
      if (status === 'BUY') return s.signal?.verdict === 'BUY' || s.scanVerdict === 'BUY';
      return true;
    });
  }, [stocks, query, sector, status]);

  // Apply sort.
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      if (sortKey === 'symbol') return a.symbol.localeCompare(b.symbol);
      if (sortKey === 'gates') return (b.gatesPassed ?? -1) - (a.gatesPassed ?? -1);
      if (sortKey === 'lastScan') return new Date(b.lastScanAt ?? 0) - new Date(a.lastScanAt ?? 0);
      // default: score (scanned first, then by composite)
      if (a.scanned !== b.scanned) return a.scanned ? -1 : 1;
      return (b.compositeScore ?? -1) - (a.compositeScore ?? -1);
    });
    return arr;
  }, [filtered, sortKey]);

  // Reset to first page whenever the filtered set changes.
  useEffect(() => { setPage(0); }, [query, sector, status, sortKey]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const SortHeader = ({ label, k, align = 'left' }) => (
    <th
      className={`pb-2 pr-3 cursor-pointer select-none hover:text-slate-300 ${align === 'right' ? 'text-right' : ''}`}
      onClick={() => setSortKey(k)}
    >
      {label}{sortKey === k ? ' ▾' : ''}
    </th>
  );
  SortHeader.propTypes = { label: PropTypes.string, k: PropTypes.string, align: PropTypes.string };

  return (
    <div className="min-h-screen bg-surface p-4 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Stocks</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {data
              ? `${data.total} symbols · ${data.scannedCount} scanned · ${data.pendingCount} pending` +
                (data.lastScanAt ? ` · last scan ${timeAgo(data.lastScanAt)}` : '')
              : 'Loading universe…'}
          </p>
        </div>
        <button onClick={load} className="btn-ghost text-xs px-3 py-1.5">Refresh</button>
      </div>

      {error && <div className="card border-bear/30 bg-bear/10 text-bear text-sm">{error}</div>}

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbol…"
            className="input text-xs py-1.5 px-2 w-44"
          />
          <select value={sector} onChange={(e) => setSector(e.target.value)} className="input text-xs py-1.5 px-2 w-40">
            {sectors.map((s) => (
              <option key={s} value={s}>{s === 'ALL' ? 'All sectors' : s}</option>
            ))}
          </select>
          <div className="flex flex-wrap gap-1.5 ml-auto">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setStatus(f.key)}
                className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                  status === f.key
                    ? 'bg-accent text-white border-accent'
                    : 'bg-surface-card text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && <div className="card animate-pulse h-64" />}

      {!loading && data && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-500">Showing {pageRows.length} of {sorted.length} matching</p>
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-40"
              >
                ‹ Prev
              </button>
              <span className="text-slate-500">Page {page + 1} / {pageCount}</span>
              <button
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                className="px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-40"
              >
                Next ›
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead>
                <tr className="text-left text-[11px] text-slate-500 border-b border-slate-700">
                  <SortHeader label="Symbol" k="symbol" />
                  <th className="pb-2 pr-3">Sector</th>
                  <SortHeader label="Last scan" k="lastScan" />
                  <th className="pb-2 pr-3 text-right">Price</th>
                  <th className="pb-2 pr-3 text-right">P/E</th>
                  <th className="pb-2 pr-3 text-right">Mkt Cap</th>
                  <SortHeader label="Gates" k="gates" align="right" />
                  <SortHeader label="Score" k="score" align="right" />
                  <th className="pb-2 pr-3">Stage</th>
                  <th className="pb-2 pr-3">Signal</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((s) => (
                  <tr key={s.symbol} className="border-b border-slate-800 last:border-0 hover:bg-surface-elevated/30">
                    <td className="py-1.5 pr-3 font-medium text-slate-200">
                      {s.symbol}
                      {s.inWatchlist && <span className="ml-1 text-[9px] text-accent" title="In watchlist">★</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-400 text-xs">{s.sector}</td>
                    <td className="py-1.5 pr-3 text-slate-400 text-xs">{s.lastScanAt ? timeAgo(s.lastScanAt) : '—'}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-slate-300">{fmtPrice(s.currentPrice)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-slate-400">{s.peRatio != null ? s.peRatio.toFixed(1) : '—'}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-slate-400">{s.marketCap ? `₹${formatIndianNumber(s.marketCap)}` : '—'}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-slate-300">{s.gatesPassed == null ? '—' : `${s.gatesPassed}/8`}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-slate-300">{s.compositeScore ?? '—'}</td>
                    <td className="py-1.5 pr-3"><StageBadge stage={s.droppedAtStage} /></td>
                    <td className="py-1.5 pr-3">
                      {s.signal ? (
                        <span className={`text-xs font-semibold badge-${s.signal.verdict?.toLowerCase()}`}>{s.signal.verdict}</span>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right">
                      <Link to={`/analysis/${s.symbol}`} className="text-[11px] text-accent hover:underline">Analyze</Link>
                    </td>
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr><td colSpan={11} className="py-8 text-center text-slate-500 text-sm">No stocks match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default Stocks;
