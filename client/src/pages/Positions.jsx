/**
 * @file Positions.jsx
 * @description Open positions — live P&L, SL warnings, T1/close actions, log new trade.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import TradeCard, { ACTION_STYLES } from '../components/TradeCard.jsx';
import PositionsTable from '../components/PositionsTable.jsx';
import LogTradeModal from '../components/LogTradeModal.jsx';
import IntradayPanel from '../components/IntradayPanel.jsx';
import useSocket from '../hooks/useSocket.js';
import { tradesApi, quotesApi, pricesApi, exportApi, ohlcvApi } from '../services/api.js';
import { SOCKET_EVENTS, EXIT_REASONS, MAX_OPEN_TRADES } from '../utils/constants.js';
import { formatCurrency, formatPercent, timeAgo } from '../utils/formatters.js';
import { useApp } from '../context/AppContext.jsx';

const POLL_MS         = 45_000; // MongoDB position fetch
const PRICE_REFRESH_MS = 30_000; // live price push during market hours

const ACTIONS = ['EXIT_RISK', 'BOOK_T2', 'BOOK_T1', 'TRAIL_STOP', 'HOLD'];
const URGENCY_RANK = { EXIT_RISK: 0, BOOK_T2: 1, BOOK_T1: 2, TRAIL_STOP: 3, HOLD: 4 };
const SORT_OPTIONS = [
  { key: 'urgency', label: 'Urgency', dir: 'asc' },
  { key: 'pnlPct', label: 'P&L %', dir: 'desc' },
  { key: 'rMultiple', label: 'R-Multiple', dir: 'desc' },
  { key: 'daysHeld', label: 'Days Held', dir: 'desc' },
  { key: 'slDistance', label: 'SL Distance', dir: 'asc' },
];
const EMPTY_FILTERS = { sector: '', actions: [], pnlStatus: '', symbol: '' };

const sortVal = (t, key) => {
  switch (key) {
    case 'urgency': return URGENCY_RANK[t.live?.action] ?? 4;
    case 'pnlPct': return t.unrealizedPnlPct ?? 0;
    case 'rMultiple': return t.live?.rMultiple ?? 0;
    case 'daysHeld': return t.entryDate ? Date.now() - new Date(t.entryDate).getTime() : 0;
    case 'slDistance': return t.live?.slDistancePct ?? Infinity;
    default: return 0;
  }
};

const Chip = ({ active, onClick, children, activeClass = 'bg-accent/20 text-accent border-accent/40' }) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all duration-150 ${
      active ? activeClass : 'bg-surface-elevated/50 text-slate-400 border-slate-700 hover:text-slate-200 hover:border-slate-600'
    }`}
  >
    {children}
  </button>
);

const isMarketHours = () => {
  const nowIST = new Date(Date.now() + 5.5 * 3600 * 1000);
  const day  = nowIST.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const mins = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30; // 9:15–15:30 IST
};

/* ── Close Trade Modal ───────────────────────────────────────────────────────── */
const CloseTradeModal = ({ trade, onConfirm, onCancel }) => {
  const [exitPrice, setExitPrice] = useState(String(trade?.currentPrice ?? trade?.stopLoss ?? ''));
  const [reason,    setReason]    = useState(trade?._defaultReason ?? EXIT_REASONS.MANUAL);

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
  const { config } = useApp();
  const maxOpenTrades = config?.maxOpenTrades ?? MAX_OPEN_TRADES;
  const [trades,          setTrades]          = useState([]);
  const [summary,         setSummary]         = useState(null);
  const [updatedAt,       setUpdatedAt]        = useState(null);
  const [loading,         setLoading]          = useState(true);
  const [error,           setError]            = useState(null);
  const [slWarnings,      setSlWarnings]       = useState(new Set());
  const [closingTrade,    setClosingTrade]     = useState(null);
  const [showLogModal,    setShowLogModal]     = useState(false);
  const [priceRefreshing, setPriceRefreshing]  = useState(false);
  const [monitoring,      setMonitoring]       = useState(false);
  const [sparklines,      setSparklines]       = useState({});
  const [viewMode,        setViewMode]         = useState('cards');
  const [filters,         setFilters]          = useState(EMPTY_FILTERS);
  const [sortKey,         setSortKey]          = useState('urgency');
  const [sectorConcentration, setSectorConcentration] = useState(null);
  const { subscribe } = useSocket();

  /* Keep a stable ref to current trades for the price-refresh closure */
  const tradesRef = useRef([]);
  useEffect(() => { tradesRef.current = trades; }, [trades]);

  const loadTrades = useCallback(async () => {
    try {
      const [res, sectorRes] = await Promise.all([
        tradesApi.getLive(),
        tradesApi.getSectorConcentration().catch(() => null),
      ]);
      setTrades(res.data?.positions ?? []);
      setSummary(res.data?.summary ?? null);
      setUpdatedAt(res.data?.summary?.updatedAt ?? new Date().toISOString());
      setSectorConcentration(sectorRes?.data ?? null);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTrades(); }, [loadTrades]);

  /* MongoDB position poll — keeps suggestions + summary fresh */
  useEffect(() => {
    const id = setInterval(loadTrades, POLL_MS);
    return () => clearInterval(id);
  }, [loadTrades]);

  /* Live price push — fetches quotes and writes currentPrice to DB every 30s during market hours */
  useEffect(() => {
    const refresh = async () => {
      const syms = [...new Set(tradesRef.current.map((t) => t.symbol))];
      if (!syms.length || !isMarketHours()) return;
      setPriceRefreshing(true);
      try {
        const priceMap = await quotesApi.get(syms);
        const prices = syms
          .filter((s) => priceMap[s]?.price != null)
          .map((s) => ({ symbol: s, currentPrice: priceMap[s].price }));
        if (prices.length) {
          await pricesApi.update(prices);
          await loadTrades(); // pick up the freshly-written unrealizedPnl values
        }
      } catch { /* non-critical — stale prices are preferable to crashing */ }
      finally { setPriceRefreshing(false); }
    };

    const id = setInterval(refresh, PRICE_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadTrades]); // loadTrades is stable (useCallback [])

  /* Auto-refresh after scan completes */
  useEffect(() => subscribe(SOCKET_EVENTS.SCAN_COMPLETE, () => loadTrades()), [subscribe, loadTrades]);

  /* Sparkline data — 7-day daily closes per symbol, re-fetched only when symbol set changes */
  const symbolKey = useMemo(() => trades.map((t) => t.symbol).sort().join(','), [trades]);
  useEffect(() => {
    if (!symbolKey) return;
    let cancelled = false;
    const syms = symbolKey.split(',').filter(Boolean);
    Promise.all(
      syms.map((sym) =>
        ohlcvApi.get(sym, '10d', '1d')
          .then((r) => {
            const payload = r?.data;
            const arr = Array.isArray(payload) ? payload : (payload?.data ?? []);
            return { sym, closes: arr.slice(-7).map((c) => c.close).filter(Boolean) };
          })
          .catch(() => ({ sym, closes: [] }))
      )
    ).then((results) => {
      if (cancelled) return;
      const map = {};
      for (const { sym, closes } of results) map[sym] = closes;
      setSparklines(map);
    });
    return () => { cancelled = true; };
  }, [symbolKey]);

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
      toast.success(`Target 1 hit: ${updated.symbol} — SL trailed to entry`);
    });
  }, [subscribe]);

  /* Trade auto-closed (SL hit, T2 hit, or manual close on another tab) */
  useEffect(() => {
    return subscribe(SOCKET_EVENTS.TRADE_CLOSED, ({ _id, symbol, exitReason, realizedPnl }) => {
      setTrades((prev) => prev.filter((t) => t._id !== _id));
      setSlWarnings((prev) => { const s = new Set(prev); s.delete(String(_id)); return s; });
      const pnlStr = realizedPnl != null ? ` · ${realizedPnl >= 0 ? '+' : ''}₹${Math.round(realizedPnl).toLocaleString('en-IN')}` : '';
      const reasonLabels = { STOPLOSS: 'SL hit', TARGET2: 'T2 hit', MANUAL: 'Closed', TARGET1: 'T1 booked', EARNINGS: 'Earnings exit' };
      const label = reasonLabels[exitReason] ?? exitReason;
      if (exitReason === 'STOPLOSS') {
        toast.error(`${label}: ${symbol}${pnlStr}`);
      } else {
        toast.success(`${label}: ${symbol}${pnlStr}`);
      }
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

  const handleRunMonitor = useCallback(async () => {
    setMonitoring(true);
    try {
      const res = await tradesApi.refresh();
      const s = res.data;
      const parts = [];
      if (s.t1) parts.push(`${s.t1} T1`);
      if (s.t2) parts.push(`${s.t2} T2`);
      if (s.slHit) parts.push(`${s.slHit} SL`);
      if (s.warnings) parts.push(`${s.warnings} SL warning(s)`);
      toast.success(
        parts.length
          ? `Monitor ran — ${parts.join(', ')} processed`
          : `Monitor ran — ${s.checked} position(s) checked, all clear`
      );
      await loadTrades();
    } catch (err) {
      toast.error(`Monitor failed: ${err.message}`);
    } finally {
      setMonitoring(false);
    }
  }, [loadTrades]);

  const handleUpdateNotes = useCallback(async (id, notes) => {
    try {
      const res = await tradesApi.update(id, { notes });
      setTrades((prev) => prev.map((t) => (t._id === id ? { ...t, notes: res.data?.notes ?? notes } : t)));
      toast.success('Note saved');
    } catch (err) {
      toast.error(err.message);
    }
  }, []);

  const handleQuickClose = useCallback(async (id, price) => {
    const trade = trades.find((t) => t._id === id);
    if (!price || price <= 0) { toast.error('No price available to close at'); return; }
    try {
      await tradesApi.close(id, price, EXIT_REASONS.MANUAL);
      setTrades((prev) => prev.filter((t) => t._id !== id));
      setSlWarnings((prev) => { const s = new Set(prev); s.delete(String(id)); return s; });
      toast.success(`${trade?.symbol ?? ''} closed at ${formatCurrency(price)}`);
    } catch (err) {
      toast.error(err.message);
    }
  }, [trades]);

  /* ── Summary stats (prefer server live summary, fall back to local) ─────── */
  const totalDeployed    = summary?.totalDeployed   ?? trades.reduce((s, t) => s + (t.capitalDeployed ?? 0), 0);
  const totalUnrealized  = summary?.totalUnrealized ?? trades.reduce((s, t) => s + (t.unrealizedPnl  ?? 0), 0);
  const actionable       = summary?.actionable ?? trades.filter((t) => t.live && t.live.action !== 'HOLD').length;
  const atRisk           = summary?.atRisk ?? 0;
  const pnlColor         = totalUnrealized >= 0 ? 'text-bull' : 'text-bear';

  /* ── Filters + sort — applied client-side over the live positions list ──── */
  const distinctSectors = useMemo(
    () => [...new Set(trades.map((t) => t.sector).filter(Boolean))].sort(),
    [trades]
  );

  const filteredTrades = useMemo(() => {
    const { sector, actions, pnlStatus, symbol } = filters;
    return trades.filter((t) => {
      if (sector && t.sector !== sector) return false;
      if (actions.length && !actions.includes(t.live?.action ?? 'HOLD')) return false;
      if (pnlStatus === 'WIN' && (t.unrealizedPnl ?? 0) <= 0) return false;
      if (pnlStatus === 'LOSS' && (t.unrealizedPnl ?? 0) > 0) return false;
      if (symbol && !t.symbol?.toLowerCase().includes(symbol.toLowerCase())) return false;
      return true;
    });
  }, [trades, filters]);

  const sortedTrades = useMemo(() => {
    const opt = SORT_OPTIONS.find((o) => o.key === sortKey) ?? SORT_OPTIONS[0];
    const dirMult = opt.dir === 'asc' ? 1 : -1;
    return [...filteredTrades].sort((a, b) => (sortVal(a, sortKey) - sortVal(b, sortKey)) * dirMult);
  }, [filteredTrades, sortKey]);

  const activeFilterCount =
    (filters.sector ? 1 : 0) + filters.actions.length + (filters.pnlStatus ? 1 : 0) + (filters.symbol ? 1 : 0);

  const toggleAction = (action) =>
    setFilters((f) => ({
      ...f,
      actions: f.actions.includes(action) ? f.actions.filter((a) => a !== action) : [...f.actions, action],
    }));

  const overweightSector = sectorConcentration?.sectors?.find((s) => s.pct >= (sectorConcentration.warningThreshold ?? 40));

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
              ({trades.length} / {maxOpenTrades} slots)
            </span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
            {isMarketHours() ? (
              <>
                <span className={`w-1.5 h-1.5 rounded-full ${priceRefreshing ? 'bg-blue-400 animate-pulse' : 'bg-bull animate-pulse'}`} />
                {priceRefreshing ? 'Refreshing prices…' : `Live · prices refresh every ${PRICE_REFRESH_MS / 1000}s`}
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                Market closed · prices frozen
              </>
            )}
            {updatedAt ? ` · updated ${timeAgo(updatedAt)}` : ''}
            {summary && summary.quotesLive < summary.count
              ? ` · ${summary.count - summary.quotesLive} stale quote(s)`
              : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadTrades} className="btn-ghost text-xs px-3 py-1">
            Refresh
          </button>
          <button
            onClick={handleRunMonitor}
            disabled={monitoring}
            className="btn-primary text-xs px-3 py-1 disabled:opacity-60"
            title="Run the position monitor now — auto-marks T1/T2 hits and SL exits"
          >
            {monitoring ? 'Checking…' : '⚡ Check exits'}
          </button>
          <a
            href={exportApi.tradesUrl()}
            download="trades.csv"
            className="text-xs px-3 py-1.5 bg-surface-card border border-slate-700 hover:border-slate-500 text-slate-300 rounded-lg transition-colors font-medium inline-flex items-center gap-1"
          >
            ↓ CSV
          </a>
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

      {/* Sector concentration nudge */}
      {overweightSector && (
        <div className="card border-wait/40 bg-wait/10 text-wait text-sm flex items-center gap-2 flex-wrap">
          <span>⚠</span>
          <span className="flex-1">
            <strong>{overweightSector.sector}</strong> is {overweightSector.pct.toFixed(1)}% of deployed capital —
            over the {sectorConcentration.warningThreshold}% concentration guideline.
          </span>
          <Link to="/risk-attribution" className="text-xs underline underline-offset-2 hover:text-slate-200 shrink-0">
            View Risk &amp; Attribution →
          </Link>
        </div>
      )}

      {/* Filter bar */}
      {trades.length > 0 && (
        <div className="glass rounded-xl p-3.5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide mr-1">Action</span>
            {ACTIONS.map((a) => (
              <Chip key={a} active={filters.actions.includes(a)} onClick={() => toggleAction(a)}>
                {ACTION_STYLES[a].label}
              </Chip>
            ))}
            <span className="w-px h-4 bg-slate-700 mx-1" />
            <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide mr-1">P&amp;L</span>
            {[['', 'All'], ['WIN', 'Winners'], ['LOSS', 'Losers']].map(([val, label]) => (
              <Chip
                key={val || 'all'}
                active={filters.pnlStatus === val}
                onClick={() => setFilters((f) => ({ ...f, pnlStatus: val }))}
                activeClass={val === 'WIN' ? 'bg-bull/20 text-bull border-bull/40' : val === 'LOSS' ? 'bg-bear/20 text-bear border-bear/40' : undefined}
              >
                {label}
              </Chip>
            ))}
            {activeFilterCount > 0 && (
              <button
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="ml-auto text-xs text-slate-500 hover:text-slate-300 underline underline-offset-2"
              >
                Clear filters ({activeFilterCount})
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filters.sector}
              onChange={(e) => setFilters((f) => ({ ...f, sector: e.target.value }))}
              className="input !py-1.5 text-xs w-auto"
            >
              <option value="">All sectors</option>
              {distinctSectors.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input
              type="text"
              placeholder="Search symbol…"
              value={filters.symbol}
              onChange={(e) => setFilters((f) => ({ ...f, symbol: e.target.value }))}
              className="input w-36 !py-1.5 text-xs"
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
              className="input !py-1.5 text-xs w-auto"
              title="Sort positions by"
            >
              {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>Sort: {o.label}</option>)}
            </select>
            <div className="ml-auto flex items-center gap-1 bg-surface-elevated/50 border border-slate-700 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('cards')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${viewMode === 'cards' ? 'bg-accent/20 text-accent' : 'text-slate-400 hover:text-slate-200'}`}
              >
                Cards
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${viewMode === 'table' ? 'bg-accent/20 text-accent' : 'text-slate-400 hover:text-slate-200'}`}
              >
                Table
              </button>
            </div>
            <span className="text-xs text-slate-500">
              {sortedTrades.length} of {trades.length}
            </span>
          </div>
        </div>
      )}

      {/* Trade positions */}
      {trades.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-slate-400 font-medium">No open positions</p>
          <p className="text-slate-500 text-sm mt-1">
            Click <strong className="text-emerald-400">+ Log Trade</strong> to record a new position,
            or wait for a BUY signal on the Dashboard.
          </p>
        </div>
      ) : sortedTrades.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-4xl mb-3">🔍</p>
          <p className="text-slate-400 font-medium">No positions match these filters</p>
        </div>
      ) : viewMode === 'table' ? (
        <PositionsTable
          trades={sortedTrades}
          onMarkT1Hit={handleT1Hit}
          onMarkSLHit={handleSLHit}
          onMarkClosed={handleCloseOpen}
          onQuickClose={handleQuickClose}
          slWarnings={slWarnings}
        />
      ) : (
        <div className="stagger-grid grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sortedTrades.map((trade) => (
            <div
              key={trade._id}
              className={slWarnings.has(String(trade._id)) ? 'ring-2 ring-bear rounded-xl' : ''}
            >
              <TradeCard
                trade={trade}
                sparklineCloses={sparklines[trade.symbol]}
                onMarkT1Hit={handleT1Hit}
                onMarkClosed={handleCloseOpen}
                onMarkSLHit={handleSLHit}
                onTrailStop={handleTrailStop}
                onUpdateNotes={handleUpdateNotes}
                onQuickClose={handleQuickClose}
              />
            </div>
          ))}
        </div>
      )}

      {/* Intraday paper lane — strictly separate from the swing book above */}
      <IntradayPanel />

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
