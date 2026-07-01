/**
 * @file Signals.jsx
 * @description Signal history page — full list with verdict, confidence, gates, date-range,
 *   and symbol filters. Server-side filtering for all except symbol (client-side substring).
 *   Live: new signals prepend in real time; scan:complete auto-refreshes.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import SignalCard from '../components/SignalCard.jsx';
import LogTradeModal from '../components/LogTradeModal.jsx';
import useSocket from '../hooks/useSocket.js';
import { signalsApi, tradesApi, exportApi } from '../services/api.js';
import { SOCKET_EVENTS, VERDICTS } from '../utils/constants.js';
import { timeAgo } from '../utils/formatters.js';

const VERDICT_FILTERS = ['ALL', VERDICTS.BUY, VERDICTS.WAIT, VERDICTS.SKIP];
const CONF_FILTERS    = ['ALL', 'HIGH', 'MEDIUM', 'LOW'];
const GATES_OPTIONS   = [0, 5, 6, 7, 8]; // 0 = Any

/* Skeleton placeholder cards during load */
const Skeleton = () => (
  <div className="card space-y-3">
    <div className="flex items-center justify-between">
      <div className="skeleton h-5 rounded w-24" />
      <div className="skeleton h-5 rounded w-12" />
    </div>
    <div className="skeleton h-3 rounded" />
    <div className="skeleton h-3 rounded w-4/5" />
    <div className="skeleton h-3 rounded w-3/5" />
    <div className="skeleton h-8 rounded w-1/3 mt-1" />
  </div>
);

const Signals = () => {
  const [signals,      setSignals]      = useState([]);
  const [filter,       setFilter]       = useState('ALL');
  const [filterConf,   setFilterConf]   = useState('ALL');
  const [filterGates,  setFilterGates]  = useState(0);
  const [dateFrom,     setDateFrom]     = useState('');
  const [dateTo,       setDateTo]       = useState('');
  const [symbolSearch, setSymbolSearch] = useState('');
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [scanning,     setScanning]     = useState(false);
  const [lastScan,     setLastScan]     = useState(null);
  const [accuracy,     setAccuracy]     = useState({});
  const [logPrefill,   setLogPrefill]   = useState(null);
  const { subscribe } = useSocket();

  useEffect(() => {
    tradesApi.getAccuracy()
      .then((res) => setAccuracy(res?.data ?? {}))
      .catch(() => {});
  }, []);

  /* ── Data fetch ─────────────────────────────────────────────────────────── */
  const fetchSignals = useCallback(async (params) => {
    setLoading(true);
    setError(null);
    try {
      const q = {};
      if (params?.verdict && params.verdict !== 'ALL')         q.verdict    = params.verdict;
      if (params?.filterConf && params.filterConf !== 'ALL')  q.confidence = params.filterConf;
      if (params?.filterGates)                                 q.minGates   = params.filterGates;
      if (params?.dateFrom)                                    q.from       = params.dateFrom;
      if (params?.dateTo)                                      q.to         = params.dateTo;
      const res = await signalsApi.getAll(Object.keys(q).length ? q : undefined);
      setSignals(res.data ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSignals({ verdict: filter, filterConf, filterGates, dateFrom, dateTo });
  }, [fetchSignals, filter, filterConf, filterGates, dateFrom, dateTo]);

  /* ── Live WebSocket events ──────────────────────────────────────────────── */
  useEffect(() => {
    /* New signal — prepend only if it passes all current server-side filters */
    const unsubNew = subscribe(SOCKET_EVENTS.SIGNAL_NEW, (signal) => {
      const matchesVerdict = filter === 'ALL' || filter === signal.verdict;
      const matchesConf    = filterConf === 'ALL' || filterConf === signal.confidence;
      const matchesGates   = !filterGates || (signal.gatesPassed ?? 0) >= filterGates;
      if (matchesVerdict && matchesConf && matchesGates) {
        setSignals((prev) => [signal, ...prev]);
      }
      const icon = signal.verdict === 'BUY' ? '🚀' : signal.verdict === 'WAIT' ? '⏳' : '⏭';
      toast.success(`${icon} ${signal.verdict}: ${signal.symbol}`, { duration: 6000 });
    });

    /* Existing signal updated (e.g. isActive toggled) */
    const unsubUpdate = subscribe(SOCKET_EVENTS.SIGNAL_UPDATE, (updated) => {
      setSignals((prev) => prev.map((s) => (s._id === updated._id ? updated : s)));
    });

    /* Scan finished — refresh list */
    const unsubScan = subscribe(SOCKET_EVENTS.SCAN_COMPLETE, (data) => {
      setLastScan(new Date());
      if ((data?.buySignals ?? 0) > 0 || filter !== 'ALL') {
        fetchSignals({ verdict: filter, filterConf, filterGates, dateFrom, dateTo });
      }
    });

    return () => { unsubNew(); unsubUpdate(); unsubScan(); };
  }, [subscribe, filter, filterConf, filterGates, dateFrom, dateTo, fetchSignals]);

  /* ── Manual scan ────────────────────────────────────────────────────────── */
  const handleScan = useCallback(async () => {
    try {
      setScanning(true);
      await signalsApi.triggerScan();
      toast.success('Scan queued — results arrive live via WebSocket');
    } catch (err) {
      toast.error(`Scan failed: ${err.message}`);
    } finally {
      setScanning(false);
    }
  }, []);

  /* ── Filter helpers ─────────────────────────────────────────────────────── */
  const activeFilters = [
    filter !== 'ALL',
    filterConf !== 'ALL',
    filterGates > 0,
    !!dateFrom,
    !!dateTo,
    !!symbolSearch,
  ].filter(Boolean).length;

  const clearFilters = () => {
    setFilter('ALL');
    setFilterConf('ALL');
    setFilterGates(0);
    setDateFrom('');
    setDateTo('');
    setSymbolSearch('');
  };

  /* ── Derived ────────────────────────────────────────────────────────────── */
  const displayed = symbolSearch
    ? signals.filter((s) => s.symbol.includes(symbolSearch.toUpperCase()))
    : signals;

  const counts = {
    [VERDICTS.BUY]:  signals.filter((s) => s.verdict === VERDICTS.BUY).length,
    [VERDICTS.WAIT]: signals.filter((s) => s.verdict === VERDICTS.WAIT).length,
    [VERDICTS.SKIP]: signals.filter((s) => s.verdict === VERDICTS.SKIP).length,
  };

  const currentParams = { verdict: filter, filterConf, filterGates, dateFrom, dateTo };

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-surface p-4 space-y-4">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Signals</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {lastScan ? `Last scan: ${timeAgo(lastScan.toISOString())}` : 'Waiting for first scan…'}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => fetchSignals(currentParams)}
            className="btn-primary text-xs px-3 py-1"
          >
            Refresh
          </button>
          <a
            href={exportApi.signalsUrl({
              verdict:    filter    !== 'ALL' ? filter    : undefined,
              confidence: filterConf !== 'ALL' ? filterConf : undefined,
              minGates:   filterGates > 0 ? filterGates : undefined,
              from:       dateFrom || undefined,
              to:         dateTo   || undefined,
            })}
            download="signals.csv"
            className="text-xs px-3 py-1.5 bg-surface-card border border-slate-700 hover:border-slate-500 text-slate-300 rounded-lg transition-colors font-medium inline-flex items-center gap-1"
          >
            ↓ CSV
          </a>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="text-xs px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
          >
            {scanning ? 'Queuing…' : '⚡ Scan Now'}
          </button>
        </div>
      </div>

      {/* Verdict summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'BUY',  count: counts[VERDICTS.BUY],  color: 'text-buy',  border: 'border-buy/30',  bg: 'bg-buy/5'  },
          { label: 'WAIT', count: counts[VERDICTS.WAIT], color: 'text-wait', border: 'border-wait/30', bg: 'bg-wait/5' },
          { label: 'SKIP', count: counts[VERDICTS.SKIP], color: 'text-skip', border: 'border-skip/30', bg: 'bg-skip/5' },
        ].map(({ label, count, color, border, bg }) => (
          <button
            key={label}
            onClick={() => setFilter((f) => (f === label ? 'ALL' : label))}
            className={`card text-center py-3 transition-all border ${
              filter === label ? `${border} ${bg} ring-1 ring-current` : 'border-slate-700'
            }`}
          >
            <p className="text-xs text-slate-500 mb-1">{label}</p>
            <p className={`text-2xl font-mono font-bold ${color}`}>{count}</p>
          </button>
        ))}
      </div>

      {/* Filter panel */}
      <div className="card space-y-3 py-3">

        {/* Verdict row */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-slate-500 w-20 shrink-0">Verdict</span>
          {VERDICT_FILTERS.map((v) => (
            <button
              key={v}
              onClick={() => setFilter(v)}
              className={`text-xs px-3 py-1 rounded-lg font-medium transition-colors ${
                filter === v
                  ? 'bg-blue-600 text-white'
                  : 'bg-surface-elevated text-slate-400 hover:text-slate-200 border border-slate-700'
              }`}
            >
              {v}
              {v !== 'ALL' && <span className="ml-1 opacity-60">{counts[v] ?? 0}</span>}
            </button>
          ))}
        </div>

        {/* Confidence + Gates row */}
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-slate-500 w-20 shrink-0">Confidence</span>
            {CONF_FILTERS.map((c) => (
              <button
                key={c}
                onClick={() => setFilterConf(c)}
                className={`text-xs px-3 py-1 rounded-lg font-medium transition-colors ${
                  filterConf === c
                    ? 'bg-violet-600 text-white'
                    : 'bg-surface-elevated text-slate-400 hover:text-slate-200 border border-slate-700'
                }`}
              >
                {c === 'ALL' ? 'All' : c === 'MEDIUM' ? 'MED' : c}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-slate-500 w-20 shrink-0">Min Gates</span>
            {GATES_OPTIONS.map((g) => (
              <button
                key={g}
                onClick={() => setFilterGates(g)}
                className={`text-xs px-3 py-1 rounded-lg font-medium transition-colors ${
                  filterGates === g
                    ? 'bg-amber-600 text-white'
                    : 'bg-surface-elevated text-slate-400 hover:text-slate-200 border border-slate-700'
                }`}
              >
                {g === 0 ? 'Any' : `${g}+`}
              </button>
            ))}
          </div>
        </div>

        {/* Date range + Symbol + Clear */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-slate-500 w-20 shrink-0">Date range</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="input text-xs py-1 w-36"
          />
          <span className="text-xs text-slate-600">–</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="input text-xs py-1 w-36"
          />
          <input
            type="text"
            value={symbolSearch}
            onChange={(e) => setSymbolSearch(e.target.value)}
            placeholder="Symbol…"
            className="input text-xs py-1 w-28 ml-auto"
          />
          {activeFilters > 0 && (
            <button
              onClick={clearFilters}
              className="text-xs px-3 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
            >
              Clear {activeFilters}
            </button>
          )}
        </div>
      </div>

      {/* Result count */}
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span>
          {symbolSearch ? `${displayed.length} of ${signals.length}` : signals.length} signals
        </span>
        {activeFilters > 0 && (
          <span className="px-2 py-0.5 bg-blue-900/40 text-blue-300 rounded-full">
            {activeFilters} filter{activeFilters > 1 ? 's' : ''} active
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="card border-red-500/30 bg-red-500/10 text-red-400 text-sm">{error}</div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} />)}
        </div>
      )}

      {/* Empty state */}
      {!loading && displayed.length === 0 && (
        <div className="card text-center py-16">
          <p className="text-4xl mb-3">📭</p>
          <p className="text-slate-400 font-medium">No signals found</p>
          <p className="text-slate-500 text-sm mt-1">
            {activeFilters > 0
              ? 'No signals match the current filters. Try clearing some.'
              : 'Add stocks to your watchlist and click Scan Now.'}
          </p>
          {activeFilters > 0 ? (
            <button
              onClick={clearFilters}
              className="mt-4 text-xs px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
            >
              Clear all filters
            </button>
          ) : (
            <button
              onClick={handleScan}
              disabled={scanning}
              className="mt-4 text-xs px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {scanning ? 'Starting scan…' : '⚡ Start Scan'}
            </button>
          )}
        </div>
      )}

      {/* Signal grid */}
      {!loading && displayed.length > 0 && (
        <div className="stagger-grid grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {displayed.map((signal) => (
            <SignalCard
              key={signal._id}
              signal={signal}
              accuracy={accuracy[signal.symbol] ?? null}
              onLogTrade={signal.verdict === 'BUY' ? setLogPrefill : undefined}
            />
          ))}
        </div>
      )}

      {/* Log Trade modal — pre-filled from signal */}
      {logPrefill && (
        <LogTradeModal
          prefill={logPrefill}
          onClose={() => setLogPrefill(null)}
          onSuccess={() => setLogPrefill(null)}
        />
      )}
    </div>
  );
};

export default Signals;
