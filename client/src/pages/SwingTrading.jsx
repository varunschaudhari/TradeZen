/**
 * @file SwingTrading.jsx
 * @description Swing trading hub — a single premium page bringing together the signal
 *   feed, live filters, headline stats, and open positions for the swing (delivery)
 *   lane. Additive: Dashboard/Signals/Positions/Performance are untouched: this page is
 *   a consolidated view for anyone who wants everything swing-related in one place.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import SignalCard from '../components/SignalCard.jsx';
import StatTile from '../components/StatTile.jsx';
import LogTradeModal from '../components/LogTradeModal.jsx';
import useSocket from '../hooks/useSocket.js';
import { signalsApi, tradesApi, performanceApi, watchlistApi } from '../services/api.js';
import { SOCKET_EVENTS } from '../utils/constants.js';
import { formatCurrency, formatPercent, timeAgo } from '../utils/formatters.js';

const VERDICTS = ['BUY', 'WAIT', 'SKIP'];
const CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW'];
const VERDICT_DOT = { BUY: 'bg-buy', WAIT: 'bg-wait', SKIP: 'bg-skip' };

const EMPTY_FILTERS = { verdicts: [], confidences: [], sector: '', symbol: '', from: '', to: '' };

/* ── Small chip toggle used throughout the filter bar ─────────────────────────── */
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

Chip.propTypes = {
  active: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
  activeClass: PropTypes.string,
};

/* ── Verdict funnel — magnitude by category, status color = the verdict itself ── */
const VerdictFunnel = ({ counts }) => {
  const max = Math.max(1, ...VERDICTS.map((v) => counts[v] ?? 0));
  return (
    <div className="card glass">
      <p className="text-xs font-semibold text-slate-300 mb-3">Today&apos;s verdict mix</p>
      <div className="space-y-2.5">
        {VERDICTS.map((v) => {
          const n = counts[v] ?? 0;
          const pct = Math.round((n / max) * 100);
          return (
            <div key={v} className="flex items-center gap-3">
              <span className="w-11 text-[11px] font-semibold text-slate-400 uppercase">{v}</span>
              <div className="flex-1 h-2 rounded-full bg-surface-elevated/60 overflow-hidden">
                <div
                  className={`h-full rounded-full ${VERDICT_DOT[v]} transition-all duration-500`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-6 text-right text-xs font-mono tabular-nums text-slate-300">{n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

VerdictFunnel.propTypes = { counts: PropTypes.object.isRequired };

/* ── Read-only position glance — full management stays on the Positions page, which
 * already owns the price-refresh loop and the mutating action handlers (T1/SL/close). ── */
const PositionMiniCard = ({ trade }) => {
  const pnl = trade.unrealizedPnl ?? 0;
  const positive = pnl >= 0;
  return (
    <Link to="/positions" className="card card-interactive block">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono font-semibold text-slate-100">{trade.symbol}</span>
        {trade.target1Hit && (
          <span className="chip bg-bull/15 text-bull">T1 booked</span>
        )}
      </div>
      <div className="flex items-baseline justify-between mb-3">
        <span className={`text-lg font-bold tabular-nums ${positive ? 'text-bull' : 'text-bear'}`}>
          {formatCurrency(pnl)}
        </span>
        <span className={`text-xs font-mono ${positive ? 'text-bull' : 'text-bear'}`}>
          {formatPercent(trade.unrealizedPnlPct ?? 0)}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px] pt-2.5 border-t border-slate-800/70">
        <div>
          <p className="text-slate-500">Entry</p>
          <p className="font-mono text-slate-300">{trade.entryPrice?.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-slate-500">Current</p>
          <p className="font-mono text-slate-300">{trade.currentPrice?.toFixed(2) ?? '—'}</p>
        </div>
        <div>
          <p className="text-slate-500">Stop</p>
          <p className="font-mono text-bear">{(trade.slTrailedTo ?? trade.stopLoss)?.toFixed(2)}</p>
        </div>
      </div>
    </Link>
  );
};

PositionMiniCard.propTypes = {
  trade: PropTypes.shape({
    _id: PropTypes.string,
    symbol: PropTypes.string,
    entryPrice: PropTypes.number,
    currentPrice: PropTypes.number,
    stopLoss: PropTypes.number,
    slTrailedTo: PropTypes.number,
    target1Hit: PropTypes.bool,
    unrealizedPnl: PropTypes.number,
    unrealizedPnlPct: PropTypes.number,
  }).isRequired,
};

const SwingTrading = () => {
  const [signals, setSignals] = useState([]);
  const [trades, setTrades] = useState([]);
  const [perf, setPerf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [logPrefill, setLogPrefill] = useState(null);
  const { subscribe } = useSocket();

  const handleToggleWatchlist = useCallback(async (signal, currentlyOn) => {
    try {
      if (currentlyOn) {
        await watchlistApi.remove(signal.symbol);
        toast.success(`${signal.symbol} removed from watchlist`);
        return false;
      }
      await watchlistApi.add(signal.symbol, signal.sector || '');
      toast.success(`${signal.symbol} added to watchlist`);
      return true;
    } catch (err) {
      if (!currentlyOn && /already/i.test(err.message)) {
        toast(`${signal.symbol} is already on your watchlist`, { icon: 'ℹ️' });
        return true;
      }
      toast.error(err.message);
      return null;
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const [sigRes, tradeRes, perfRes] = await Promise.all([
        signalsApi.getAll({ limit: 500 }),
        tradesApi.getLive(),
        performanceApi.get().catch(() => null),
      ]);
      setSignals(sigRes.data ?? []);
      setTrades(tradeRes.data?.positions ?? []);
      setPerf(perfRes?.data ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribe(SOCKET_EVENTS.SIGNAL_NEW, () => load()), [subscribe, load]);
  useEffect(() => subscribe(SOCKET_EVENTS.TRADE_CLOSED, () => load()), [subscribe, load]);
  useEffect(() => subscribe(SOCKET_EVENTS.TRADE_TARGET1, () => load()), [subscribe, load]);

  const sectors = useMemo(
    () => [...new Set(signals.map((s) => s.sector).filter(Boolean))].sort(),
    [signals]
  );

  const filtered = useMemo(() => {
    const { verdicts, confidences, sector, symbol, from, to } = filters;
    const fromMs = from ? new Date(from).getTime() : null;
    const toMs = to ? new Date(to).setHours(23, 59, 59, 999) : null;
    return signals.filter((s) => {
      if (verdicts.length && !verdicts.includes(s.verdict)) return false;
      if (confidences.length && !confidences.includes(s.confidence)) return false;
      if (sector && s.sector !== sector) return false;
      if (symbol && !s.symbol?.toLowerCase().includes(symbol.toLowerCase())) return false;
      const t = new Date(s.createdAt).getTime();
      if (fromMs != null && t < fromMs) return false;
      if (toMs != null && t > toMs) return false;
      return true;
    });
  }, [signals, filters]);

  const todayCounts = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todays = signals.filter((s) => new Date(s.createdAt) >= startOfDay);
    return todays.reduce((acc, s) => {
      acc[s.verdict] = (acc[s.verdict] ?? 0) + 1;
      return acc;
    }, {});
  }, [signals]);

  const activeFilterCount =
    filters.verdicts.length + filters.confidences.length +
    (filters.sector ? 1 : 0) + (filters.symbol ? 1 : 0) + (filters.from ? 1 : 0) + (filters.to ? 1 : 0);

  const toggleIn = (key, value) =>
    setFilters((f) => ({
      ...f,
      [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value],
    }));

  const avgOpenRR = useMemo(() => {
    const withRR = trades.filter((t) => t.entryPrice > t.stopLoss);
    if (!withRR.length) return null;
    const sum = withRR.reduce((s, t) => {
      const risk = t.entryPrice - t.stopLoss;
      const reward = (t.target1 ?? t.entryPrice) - t.entryPrice;
      return s + (risk > 0 ? reward / risk : 0);
    }, 0);
    return sum / withRR.length;
  }, [trades]);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            Swing Trading
            <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent text-[10px] font-bold uppercase tracking-wide">
              Delivery
            </span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">8-gate system + deterministic score verdict · paper-tracked, never auto-executed</p>
        </div>
        <div className="flex gap-2">
          <Link to="/signals" className="btn-ghost text-xs">Full Signal History →</Link>
          <Link to="/positions" className="btn-ghost text-xs">All Positions →</Link>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatTile
          label="Win Rate"
          value={perf ? `${perf.winRate}%` : '—'}
          sublabel={perf ? `${perf.winningTrades}W / ${perf.losingTrades}L` : null}
          tone={perf?.winRate >= 50 ? 'bull' : 'bear'}
          loading={loading}
        />
        <StatTile
          label="Net P&L (closed)"
          value={perf ? formatCurrency(perf.totalPnl) : '—'}
          sublabel={perf ? formatPercent(perf.totalPnlPct) : null}
          tone={perf?.totalPnl >= 0 ? 'bull' : 'bear'}
          loading={loading}
        />
        <StatTile
          label="Open Positions"
          value={perf ? perf.openPositions : trades.length}
          sublabel={perf ? formatCurrency(perf.totalDeployed) + ' deployed' : null}
          tone="accent"
          loading={loading}
        />
        <StatTile
          label="Unrealized P&L"
          value={perf ? formatCurrency(perf.unrealizedPnl) : '—'}
          tone={perf?.unrealizedPnl >= 0 ? 'bull' : 'bear'}
          loading={loading}
        />
        <StatTile
          label="Avg R:R (open)"
          value={avgOpenRR != null ? `${avgOpenRR.toFixed(2)}:1` : '—'}
          tone={avgOpenRR >= 2 ? 'bull' : 'wait'}
          loading={loading}
        />
        <StatTile
          label="Signals Today"
          value={Object.values(todayCounts).reduce((a, b) => a + b, 0)}
          sublabel={`${todayCounts.BUY ?? 0} BUY`}
          tone="neutral"
          loading={loading}
        />
      </div>

      <VerdictFunnel counts={todayCounts} />

      {/* Filter bar */}
      <div className="glass rounded-xl p-3.5 sticky top-2 z-10 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide mr-1">Verdict</span>
          {VERDICTS.map((v) => (
            <Chip
              key={v}
              active={filters.verdicts.includes(v)}
              onClick={() => toggleIn('verdicts', v)}
              activeClass={
                v === 'BUY' ? 'bg-buy/20 text-buy border-buy/40'
                : v === 'WAIT' ? 'bg-wait/20 text-wait border-wait/40'
                : 'bg-skip/20 text-skip border-skip/40'
              }
            >
              {v}
            </Chip>
          ))}
          <span className="w-px h-4 bg-slate-700 mx-1" />
          <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide mr-1">Confidence</span>
          {CONFIDENCES.map((c) => (
            <Chip key={c} active={filters.confidences.includes(c)} onClick={() => toggleIn('confidences', c)}>
              {c}
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
          <input
            type="text"
            placeholder="Search symbol…"
            value={filters.symbol}
            onChange={(e) => setFilters((f) => ({ ...f, symbol: e.target.value }))}
            className="input w-40 !py-1.5 text-xs"
          />
          {sectors.length > 0 && (
            <select
              value={filters.sector}
              onChange={(e) => setFilters((f) => ({ ...f, sector: e.target.value }))}
              className="input !py-1.5 text-xs w-auto"
            >
              <option value="">All sectors</option>
              {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
            className="input !py-1.5 text-xs w-auto"
          />
          <span className="text-slate-600 text-xs">to</span>
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
            className="input !py-1.5 text-xs w-auto"
          />
          <span className="ml-auto text-xs text-slate-500">
            {filtered.length} of {signals.length} signals
          </span>
        </div>
      </div>

      {/* Signal feed */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-56 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-14">
          <p className="text-4xl mb-2">🔍</p>
          <p className="text-slate-400 font-medium">No signals match these filters</p>
        </div>
      ) : (
        <div className="stagger-grid grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.slice(0, 60).map((signal) => (
            <SignalCard
              key={signal._id}
              signal={signal}
              onLogTrade={signal.verdict === 'BUY' ? setLogPrefill : undefined}
              onToggleWatchlist={handleToggleWatchlist}
            />
          ))}
        </div>
      )}

      {/* Open positions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-300">Open Positions ({trades.length})</h2>
          <span className="text-[11px] text-slate-500">Last updated {timeAgo(new Date())}</span>
        </div>
        {trades.length === 0 ? (
          <div className="card text-center py-10">
            <p className="text-slate-500 text-sm">No open swing positions right now.</p>
          </div>
        ) : (
          <div className="stagger-grid grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {trades.map((trade) => <PositionMiniCard key={trade._id} trade={trade} />)}
          </div>
        )}
      </div>

      {logPrefill && (
        <LogTradeModal
          prefill={logPrefill}
          onClose={() => setLogPrefill(null)}
          onSuccess={() => { setLogPrefill(null); load(); }}
        />
      )}
    </div>
  );
};

export default SwingTrading;
