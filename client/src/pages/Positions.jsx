/**
 * @file Positions.jsx
 * @description Open positions — live P&L, SL warnings, T1/close actions, log new trade.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import TradeCard from '../components/TradeCard.jsx';
import LogTradeModal from '../components/LogTradeModal.jsx';
import useSocket from '../hooks/useSocket.js';
import { tradesApi } from '../services/api.js';
import { SOCKET_EVENTS, EXIT_REASONS } from '../utils/constants.js';
import { formatCurrency, formatPercent, timeAgo } from '../utils/formatters.js';

const POLL_MS = 45_000; // auto-refresh live P&L every 45s

/* ── Close Trade Modal ───────────────────────────────────────────────────────── */
const CloseTradeModal = ({ trade, onConfirm, onCancel }) => {
  const [exitPrice, setExitPrice] = useState(String(trade?.currentPrice ?? trade?.stopLoss ?? ''));
  const [reason,    setReason]    = useState(EXIT_REASONS.MANUAL);

  const handleConfirm = () => {
    const price = parseFloat(exitPrice);
    if (!price || price <= 0) { toast.error('Enter a valid exit price'); return; }
    onConfirm(price, reason);
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="card w-full max-w-sm space-y-4">
        <h3 className="font-semibold text-slate-100">
          Close Position — <span className="font-mono">{trade?.symbol}</span>
        </h3>

        <div>
          <label className="text-xs text-slate-400 block mb-1">Exit Price (₹)</label>
          <input
            type="number" step="0.01"
            value={exitPrice}
            onChange={(e) => setExitPrice(e.target.value)}
            className="input w-full"
            autoFocus
          />
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">Exit Reason</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="input w-full"
          >
            <option value={EXIT_REASONS.MANUAL}>Manual exit</option>
            <option value={EXIT_REASONS.TARGET1}>Target 1 hit</option>
            <option value={EXIT_REASONS.TARGET2}>Target 2 hit</option>
            <option value={EXIT_REASONS.STOPLOSS}>Stop loss hit</option>
            <option value={EXIT_REASONS.EARNINGS}>Earnings event</option>
          </select>
        </div>

        <div className="flex gap-3">
          <button onClick={handleConfirm} className="flex-1 btn-primary">
            Confirm Close
          </button>
          <button
            onClick={onCancel}
            className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

/* ── Positions Page ──────────────────────────────────────────────────────────── */
const Positions = () => {
  const [trades,       setTrades]       = useState([]);
  const [summary,      setSummary]      = useState(null);
  const [updatedAt,    setUpdatedAt]    = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [slWarnings,   setSlWarnings]   = useState(new Set());
  const [closingTrade, setClosingTrade] = useState(null);
  const [showLogModal, setShowLogModal] = useState(false);
  const { subscribe } = useSocket();

  const loadTrades = useCallback(async () => {
    try {
      const res = await tradesApi.getLive();
      setTrades(res.data?.positions ?? []);
      setSummary(res.data?.summary ?? null);
      setUpdatedAt(res.data?.summary?.updatedAt ?? new Date().toISOString());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTrades(); }, [loadTrades]);

  /* Live auto-refresh on a timer (fresh quotes → live P&L + suggestions) */
  useEffect(() => {
    const id = setInterval(loadTrades, POLL_MS);
    return () => clearInterval(id);
  }, [loadTrades]);

  /* Auto-refresh after scan completes */
  useEffect(() => subscribe(SOCKET_EVENTS.SCAN_COMPLETE, () => loadTrades()), [subscribe, loadTrades]);

  /* SL warning highlight */
  useEffect(() => {
    return subscribe(SOCKET_EVENTS.TRADE_SL_WARNING, ({ tradeId, symbol, distancePct }) => {
      setSlWarnings((prev) => new Set([...prev, String(tradeId)]));
      toast.error(
        `⚠ SL Warning: ${symbol} is ${distancePct?.toFixed(2)}% above stop loss`,
        { duration: 10_000 }
      );
    });
  }, [subscribe]);

  /* T1 hit via socket */
  useEffect(() => {
    return subscribe(SOCKET_EVENTS.TRADE_TARGET1, (updated) => {
      setTrades((prev) => prev.map((t) => (t._id === updated._id ? updated : t)));
      toast.success(`🎯 Target 1 hit: ${updated.symbol} — SL trailed to entry`);
    });
  }, [subscribe]);

  /* ── Handlers ─────────────────────────────────────────────────────────── */
  const handleT1Hit = useCallback(async (id) => {
    try {
      const res = await tradesApi.markT1Hit(id);
      setTrades((prev) => prev.map((t) => (t._id === id ? res.data : t)));
      toast.success('Target 1 marked — SL trailed to entry');
    } catch (err) {
      toast.error(err.message);
    }
  }, []);

  const handleSLHit = useCallback((id) => {
    const trade = trades.find((t) => t._id === id);
    setClosingTrade({ ...trade, _defaultReason: EXIT_REASONS.STOPLOSS });
  }, [trades]);

  const handleTrailStop = useCallback(async (id, suggestedStop) => {
    try {
      const res = await tradesApi.update(id, { stopLoss: suggestedStop, slTrailed: true });
      setTrades((prev) => prev.map((t) => (t._id === id ? { ...t, ...res.data } : t)));
      toast.success(`Stop trailed to ${formatCurrency(suggestedStop)}`);
      loadTrades(); // re-evaluate suggestions against the new stop
    } catch (err) {
      toast.error(err.message);
    }
  }, [loadTrades]);

  const handleCloseOpen = useCallback((id) => {
    setClosingTrade(trades.find((t) => t._id === id) ?? null);
  }, [trades]);

  const handleConfirmClose = useCallback(async (exitPrice, exitReason) => {
    try {
      await tradesApi.close(closingTrade._id, exitPrice, exitReason);
      setTrades((prev) => prev.filter((t) => t._id !== closingTrade._id));
      setSlWarnings((prev) => { const s = new Set(prev); s.delete(String(closingTrade._id)); return s; });
      toast.success(`${closingTrade.symbol} position closed`);
      setClosingTrade(null);
    } catch (err) {
      toast.error(err.message);
    }
  }, [closingTrade]);

  const handleTradeLogged = useCallback((newTrade) => {
    setTrades((prev) => [newTrade, ...prev]);
  }, []);

  /* ── Summary stats (prefer server live summary, fall back to local) ─────── */
  const totalDeployed    = summary?.totalDeployed   ?? trades.reduce((s, t) => s + (t.capitalDeployed ?? 0), 0);
  const totalUnrealized  = summary?.totalUnrealized ?? trades.reduce((s, t) => s + (t.unrealizedPnl  ?? 0), 0);
  const actionable       = summary?.actionable ?? trades.filter((t) => t.live && t.live.action !== 'HOLD').length;
  const atRisk           = summary?.atRisk ?? 0;
  const pnlColor         = totalUnrealized >= 0 ? 'text-bull' : 'text-bear';

  /* ── Render ───────────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface p-4 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">
            Open Positions
            <span className="ml-2 text-sm font-normal text-slate-500">
              ({trades.length} / 15 slots)
            </span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-bull animate-pulse" />
            Live · auto-refreshes every {POLL_MS / 1000}s
            {updatedAt ? ` · updated ${timeAgo(updatedAt)}` : ''}
            {summary && summary.quotesLive < summary.count
              ? ` · ${summary.count - summary.quotesLive} stale quote(s)`
              : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadTrades} className="btn-primary text-xs px-3 py-1">
            Refresh
          </button>
          <button
            onClick={() => setShowLogModal(true)}
            className="text-xs px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg transition-colors font-medium"
          >
            + Log Trade
          </button>
        </div>
      </div>

      {error && (
        <div className="card border-red-500/30 bg-red-500/10 text-red-400 text-sm">{error}</div>
      )}

      {/* Summary strip */}
      {trades.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card text-center py-2">
            <p className="text-xs text-slate-500 mb-1">Capital Deployed</p>
            <p className="text-lg font-mono font-bold text-slate-100">
              {formatCurrency(totalDeployed)}
            </p>
          </div>
          <div className="card text-center py-2">
            <p className="text-xs text-slate-500 mb-1">Unrealized P&amp;L</p>
            <p className={`text-lg font-mono font-bold ${pnlColor}`}>
              {formatPercent(totalDeployed > 0 ? (totalUnrealized / totalDeployed) * 100 : 0)}
              <span className="text-xs ml-1">({formatCurrency(totalUnrealized)})</span>
            </p>
          </div>
          <div className="card text-center py-2">
            <p className="text-xs text-slate-500 mb-1">Action Needed</p>
            <p className={`text-2xl font-mono font-bold ${actionable > 0 ? 'text-wait' : 'text-slate-100'}`}>
              {actionable}
            </p>
          </div>
          <div className="card text-center py-2">
            <p className="text-xs text-slate-500 mb-1">At Risk</p>
            <p className={`text-2xl font-mono font-bold ${atRisk > 0 ? 'text-bear' : 'text-slate-100'}`}>
              {atRisk}
            </p>
          </div>
        </div>
      )}

      {/* SL warning banner */}
      {slWarnings.size > 0 && (
        <div className="card border-bear/40 bg-bear/10 text-bear text-sm flex items-center gap-2">
          <span>⚠</span>
          <span>
            <strong>SL Warning:</strong> {slWarnings.size} position(s) approaching stop loss. Review immediately.
          </span>
        </div>
      )}

      {/* Trade cards */}
      {trades.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-slate-400 font-medium">No open positions</p>
          <p className="text-slate-500 text-sm mt-1">
            Click <strong className="text-emerald-400">+ Log Trade</strong> to record a new position,
            or wait for a BUY signal on the Dashboard.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {trades.map((trade) => (
            <div
              key={trade._id}
              className={slWarnings.has(String(trade._id)) ? 'ring-2 ring-bear rounded-xl' : ''}
            >
              <TradeCard
                trade={trade}
                onMarkT1Hit={handleT1Hit}
                onMarkClosed={handleCloseOpen}
                onMarkSLHit={handleSLHit}
                onTrailStop={handleTrailStop}
              />
            </div>
          ))}
        </div>
      )}

      {/* Log Trade modal */}
      {showLogModal && (
        <LogTradeModal
          onClose={() => setShowLogModal(false)}
          onSuccess={handleTradeLogged}
        />
      )}

      {/* Close Trade modal */}
      {closingTrade && (
        <CloseTradeModal
          trade={closingTrade}
          onConfirm={handleConfirmClose}
          onCancel={() => setClosingTrade(null)}
        />
      )}
    </div>
  );
};

export default Positions;
