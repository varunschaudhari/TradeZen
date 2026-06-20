/**
 * @file Signals.jsx
 * @description Signal history page — full list with verdict filters and live WebSocket updates.
 *   Shows BUY/WAIT/SKIP signals with expandable gate detail.
 *   Live: new signals prepend in real time; scan:complete auto-refreshes.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import SignalCard from '../components/SignalCard.jsx';
import useSocket from '../hooks/useSocket.js';
import { signalsApi } from '../services/api.js';
import { SOCKET_EVENTS, VERDICTS } from '../utils/constants.js';
import { timeAgo } from '../utils/formatters.js';

const FILTERS = ['ALL', VERDICTS.BUY, VERDICTS.WAIT, VERDICTS.SKIP];

/* Skeleton placeholder cards during load */
const Skeleton = () => (
  <div className="card animate-pulse space-y-3">
    <div className="flex items-center justify-between">
      <div className="h-5 bg-slate-700 rounded w-24" />
      <div className="h-5 bg-slate-700 rounded w-12" />
    </div>
    <div className="h-3 bg-slate-700 rounded" />
    <div className="h-3 bg-slate-700 rounded w-4/5" />
    <div className="h-3 bg-slate-700 rounded w-3/5" />
    <div className="h-8 bg-slate-700 rounded w-1/3 mt-1" />
  </div>
);

const Signals = () => {
  const [signals,  setSignals]  = useState([]);
  const [filter,   setFilter]   = useState('ALL');
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const { subscribe } = useSocket();

  /* ── Data fetch ────────────────────────────────────────────────────────── */
  const fetchSignals = useCallback(async (verdict) => {
    setLoading(true);
    setError(null);
    try {
      const params = verdict !== 'ALL' ? { verdict } : undefined;
      const res = await signalsApi.getAll(params);
      setSignals(res.data ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSignals(filter); }, [fetchSignals, filter]);

  /* ── Live WebSocket events ─────────────────────────────────────────────── */
  useEffect(() => {
    /* New signal arrives */
    const unsubNew = subscribe(SOCKET_EVENTS.SIGNAL_NEW, (signal) => {
      /* Only prepend if it matches the current filter */
      if (filter === 'ALL' || filter === signal.verdict) {
        setSignals((prev) => [signal, ...prev]);
      }
      const icon = signal.verdict === 'BUY' ? '🚀' : signal.verdict === 'WAIT' ? '⏳' : '⏭';
      toast.success(`${icon} ${signal.verdict}: ${signal.symbol}`, { duration: 6000 });
    });

    /* Existing signal updated (e.g. isActive toggled) */
    const unsubUpdate = subscribe(SOCKET_EVENTS.SIGNAL_UPDATE, (updated) => {
      setSignals((prev) => prev.map((s) => (s._id === updated._id ? updated : s)));
    });

    /* Scan finished — refresh list and timestamp */
    const unsubScan = subscribe(SOCKET_EVENTS.SCAN_COMPLETE, (data) => {
      setLastScan(new Date());
      /* Only hard-refresh if there are new BUY signals (minimise flicker) */
      if ((data?.buySignals ?? 0) > 0 || filter !== 'ALL') {
        fetchSignals(filter);
      }
    });

    return () => { unsubNew(); unsubUpdate(); unsubScan(); };
  }, [subscribe, filter, fetchSignals]);

  /* ── Manual scan ───────────────────────────────────────────────────────── */
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

  /* ── Derived counts ────────────────────────────────────────────────────── */
  const counts = {
    [VERDICTS.BUY]:  signals.filter((s) => s.verdict === VERDICTS.BUY).length,
    [VERDICTS.WAIT]: signals.filter((s) => s.verdict === VERDICTS.WAIT).length,
    [VERDICTS.SKIP]: signals.filter((s) => s.verdict === VERDICTS.SKIP).length,
  };

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-surface p-4 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Signals</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {lastScan
              ? `Last scan: ${timeAgo(lastScan.toISOString())}`
              : 'Waiting for first scan…'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => fetchSignals(filter)}
            className="btn-primary text-xs px-3 py-1"
          >
            Refresh
          </button>
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

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((v) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
              filter === v
                ? 'bg-blue-600 text-white'
                : 'bg-surface-card text-slate-400 hover:text-slate-200 border border-slate-700'
            }`}
          >
            {v}
            {v !== 'ALL' && (
              <span className="ml-1.5 opacity-60">{counts[v] ?? 0}</span>
            )}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-500 self-center">
          {signals.length} total
        </span>
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
      {!loading && signals.length === 0 && (
        <div className="card text-center py-16">
          <p className="text-4xl mb-3">📭</p>
          <p className="text-slate-400 font-medium">No signals found</p>
          <p className="text-slate-500 text-sm mt-1">
            {filter !== 'ALL'
              ? `No ${filter} signals. Try "ALL" or run a scan.`
              : 'Add stocks to your watchlist and click Scan Now.'}
          </p>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="mt-4 text-xs px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {scanning ? 'Starting scan…' : '⚡ Start Scan'}
          </button>
        </div>
      )}

      {/* Signal grid */}
      {!loading && signals.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {signals.map((signal) => (
            <SignalCard key={signal._id} signal={signal} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Signals;
