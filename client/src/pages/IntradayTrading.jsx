/**
 * @file IntradayTrading.jsx
 * @description Intraday trading hub — a single premium page bringing together the
 *   trigger feed, live filters, headline stats, per-strategy P&L, and today's open/settled
 *   positions for the intraday lane (ORB, VWAP Reversion, Momentum Continuation; long or
 *   short). Additive: the Positions-page IntradayPanel and Performance-page track record
 *   are untouched. All figures here are NET of estimated costs — see tradingCosts.js.
 *
 *   IMPORTANT: This platform never places orders. Everything here is a paper record.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import StatTile from '../components/StatTile.jsx';
import { StrategyBadge, DirectionBadge, EXIT_META } from '../components/IntradayBadges.jsx';
import useSocket from '../hooks/useSocket.js';
import { intradayApi } from '../services/api.js';
import { SOCKET_EVENTS } from '../utils/constants.js';
import { formatCurrency, formatPercent, formatTime } from '../utils/formatters.js';

const STRATEGIES = ['ORB', 'VWAP_REVERSION', 'MOMENTUM_CONTINUATION', 'MANUAL'];
const DIRECTIONS = ['LONG', 'SHORT'];
const OUTCOMES = ['OPEN', 'WIN', 'LOSS'];

const EMPTY_FILTERS = { strategies: [], directions: [], outcomes: [], symbol: '', from: '', to: '' };

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

/* ── P&L by strategy — diverging bars from a zero baseline. Color encodes POLARITY
 * (profit vs loss), not strategy identity — identity is already the row label, so a
 * per-strategy hue here would conflate two different jobs onto one channel. ── */
const PnlByStrategy = ({ byStrategy }) => {
  const rows = STRATEGIES
    .map((key) => ({ key, ...byStrategy[key] }))
    .filter((r) => r.settled > 0);
  if (!rows.length) {
    return (
      <div className="card glass">
        <p className="text-xs font-semibold text-slate-300 mb-1">Net P&amp;L by strategy</p>
        <p className="text-xs text-slate-500">No settled signals yet.</p>
      </div>
    );
  }
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.paperPnl ?? 0)));
  return (
    <div className="card glass">
      <p className="text-xs font-semibold text-slate-300 mb-3">Net P&amp;L by strategy</p>
      <div className="space-y-3">
        {rows.map((r) => {
          const pnl = r.paperPnl ?? 0;
          const positive = pnl >= 0;
          const widthPct = Math.round((Math.abs(pnl) / maxAbs) * 50); // half-width max (bidirectional)
          return (
            <div key={r.key} className="flex items-center gap-3">
              <span className="w-28 text-[11px] font-medium text-slate-400 flex-shrink-0">
                <StrategyBadge setupType={r.key} />
              </span>
              <div className="flex-1 h-2.5 rounded-full bg-surface-elevated/60 relative overflow-hidden">
                <span className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-600" />
                <div
                  className={`absolute top-0 bottom-0 rounded-full ${positive ? 'bg-bull' : 'bg-bear'} transition-all duration-500`}
                  style={
                    positive
                      ? { left: '50%', width: `${widthPct}%` }
                      : { right: '50%', width: `${widthPct}%` }
                  }
                />
              </div>
              <span className={`w-24 text-right text-xs font-mono tabular-nums ${positive ? 'text-bull' : 'text-bear'}`}>
                {formatCurrency(pnl)}
              </span>
              <span className="w-16 text-right text-[11px] text-slate-500">
                {r.winRate != null ? `${r.winRate}% WR` : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

PnlByStrategy.propTypes = { byStrategy: PropTypes.object.isRequired };

/* ── Condensed go-live evidence — full detail lives on the Performance page ───── */
const EvidenceStrip = ({ gate }) => {
  const lane = gate?.intraday;
  if (!lane) return null;
  return (
    <div className={`card ${lane.pass ? 'card-bull' : ''}`}>
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-xs font-semibold text-slate-300">Go-live evidence (intraday, all strategies)</p>
        <span className={`chip ${lane.pass ? 'bg-bull/15 text-bull' : 'bg-slate-700/50 text-slate-400'}`}>
          {lane.pass ? 'PASS' : 'NOT YET'}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {(lane.checks ?? []).map((c) => (
          <div key={c.label} className="flex items-center gap-1.5 text-[11px]">
            <span className={c.pass ? 'text-bull' : 'text-slate-500'}>{c.pass ? '✓' : '○'}</span>
            <span className="text-slate-400 truncate" title={`${c.label}: ${c.value} (need ${c.threshold})`}>
              {c.label}
            </span>
          </div>
        ))}
      </div>
      <Link to="/performance" className="text-[11px] text-accent hover:underline mt-2.5 inline-block">
        Full evidence detail →
      </Link>
    </div>
  );
};

EvidenceStrip.propTypes = { gate: PropTypes.object };

const outcomeOf = (sig) => {
  if (sig.exitReason == null) return 'OPEN';
  return (sig.paperPnl ?? 0) > 0 ? 'WIN' : 'LOSS';
};

/* ── 0-100 gauge: how far price has travelled from stop (0) toward target (100),
 * direction-aware. Feeds the mini progress bar in the Stop/Target cell so an open
 * position's risk/reward position is visible without doing the arithmetic. ── */
const distanceProgress = (current, stop, target, direction) => {
  if (current == null || stop == null || target == null) return null;
  const isLong = direction !== 'SHORT';
  const range = isLong ? target - stop : stop - target;
  if (!range) return null;
  const raw = isLong ? current - stop : stop - current;
  return Math.min(100, Math.max(0, Math.round((raw / range) * 100)));
};

const IntradayTrading = () => {
  const [stats, setStats] = useState(null);
  const [signals, setSignals] = useState([]);
  const [live, setLive] = useState({ sessionDate: null, open: [], settled: [] });
  const [gate, setGate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [closingId, setClosingId] = useState(null);
  const { subscribe } = useSocket();

  const load = useCallback(async () => {
    try {
      const [statsRes, sigRes, liveRes, gateRes] = await Promise.all([
        intradayApi.getStats('SCANNER'),
        intradayApi.getSignals(300),
        intradayApi.getLive(),
        intradayApi.getGoLive().catch(() => null),
      ]);
      setStats(statsRes.data ?? null);
      setSignals(sigRes.data ?? []);
      setLive(liveRes.data ?? { sessionDate: null, open: [], settled: [] });
      setGate(gateRes?.data ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 45_000);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => subscribe(SOCKET_EVENTS.INTRADAY_ORB, () => load()), [subscribe, load]);

  const filtered = useMemo(() => {
    const { strategies, directions, outcomes, symbol, from, to } = filters;
    const fromMs = from ? new Date(from).getTime() : null;
    const toMs = to ? new Date(to).setHours(23, 59, 59, 999) : null;
    return signals.filter((s) => {
      if (strategies.length && !strategies.includes(s.setupType)) return false;
      if (directions.length && !directions.includes(s.direction ?? 'LONG')) return false;
      if (outcomes.length && !outcomes.includes(outcomeOf(s))) return false;
      if (symbol && !s.symbol?.toLowerCase().includes(symbol.toLowerCase())) return false;
      const t = new Date(s.createdAt).getTime();
      if (fromMs != null && t < fromMs) return false;
      if (toMs != null && t > toMs) return false;
      return true;
    });
  }, [signals, filters]);

  // Today's session P&L — distinct from the "Net P&L" tile below, which is all-time.
  // Settled legs are realized (paperPnl); still-open legs are marked-to-market via the
  // live quote /live already fetched (unrealizedGross) — summing both gives "how is
  // today going" including whatever's still in flight, not just what's closed so far.
  const todaysPnl = useMemo(() => {
    const settledNet = (live.settled ?? []).reduce((s, x) => s + (x.paperPnl ?? 0), 0);
    const openNet = (live.open ?? []).reduce((s, x) => s + (x.unrealizedGross ?? 0), 0);
    return { settledNet, openNet, total: settledNet + openNet };
  }, [live]);

  const activeFilterCount =
    filters.strategies.length + filters.directions.length + filters.outcomes.length +
    (filters.symbol ? 1 : 0) + (filters.from ? 1 : 0) + (filters.to ? 1 : 0);

  const toggleIn = (key, value) =>
    setFilters((f) => ({
      ...f,
      [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value],
    }));

  const handleClose = async (id) => {
    try {
      const res = await intradayApi.closeTrade(id);
      const t = res.data;
      const meta = EXIT_META[t.exitReason] ?? { label: t.exitReason };
      toast.success(`${t.symbol} closed @ ₹${t.exitPrice} (${meta.label}, net ${formatCurrency(t.paperPnl)})`);
      setClosingId(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            Intraday Trading
            <span className="px-1.5 py-0.5 rounded bg-wait/15 text-wait text-[10px] font-bold uppercase tracking-wide">
              Experimental
            </span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            ORB · VWAP Reversion · Momentum Continuation — separate paper capital, never touches swing risk
          </p>
        </div>
        <Link to="/performance" className="btn-ghost text-xs">Full track record →</Link>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile
          label="Win Rate"
          value={stats?.winRate != null ? `${stats.winRate}%` : '—'}
          sublabel={stats ? `${stats.wins}W / ${stats.losses}L` : null}
          tone={stats?.winRate >= 50 ? 'bull' : 'bear'}
          loading={loading}
        />
        <StatTile
          label="Today's P&L"
          value={live.sessionDate ? formatCurrency(todaysPnl.total) : '—'}
          sublabel={
            live.sessionDate
              ? `settled ${formatCurrency(todaysPnl.settledNet)}${
                  live.open.length ? ` · open ${formatCurrency(todaysPnl.openNet)}` : ''
                }`
              : null
          }
          tone={todaysPnl.total >= 0 ? 'bull' : 'bear'}
          loading={loading}
        />
        <StatTile
          label="Net P&L (All-Time)"
          value={stats ? formatCurrency(stats.totalPaperPnl) : '—'}
          sublabel={stats ? `gross ${formatCurrency(stats.totalGrossPnl)}` : null}
          tone={stats?.totalPaperPnl >= 0 ? 'bull' : 'bear'}
          loading={loading}
        />
        <StatTile
          label="Settled / Pending"
          value={stats ? `${stats.settled} / ${stats.pending}` : '—'}
          tone="accent"
          loading={loading}
        />
        <StatTile
          label="Avg Alert Latency"
          value={stats?.avgLatencySec != null ? `${stats.avgLatencySec}s` : '—'}
          sublabel="bar-close → alert"
          tone={stats?.avgLatencySec != null && stats.avgLatencySec <= 90 ? 'bull' : 'wait'}
          loading={loading}
        />
        <StatTile
          label="Est. Costs Paid"
          value={stats ? formatCurrency(stats.totalEstCosts) : '—'}
          tone="neutral"
          loading={loading}
        />
      </div>

      {stats && <PnlByStrategy byStrategy={stats.byStrategy ?? {}} />}
      {gate && <EvidenceStrip gate={gate} />}

      {/* Today's session */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-slate-300">
            Today&apos;s session {live.sessionDate ? `— ${live.sessionDate}` : ''}
          </p>
          <span className="text-[11px] text-slate-500">{live.open.length} open · {live.settled.length} settled</span>
        </div>
        {live.open.length === 0 && live.settled.length === 0 ? (
          <p className="text-xs text-slate-500">No intraday activity yet today.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 text-left border-b border-slate-700/60">
                  <th className="py-1.5 pr-3 font-medium">Symbol</th>
                  <th className="py-1.5 pr-3 font-medium">Setup</th>
                  <th className="py-1.5 pr-3 font-medium">Entry</th>
                  <th className="py-1.5 pr-3 font-medium">Current Price</th>
                  <th className="py-1.5 pr-3 font-medium">Stop</th>
                  <th className="py-1.5 pr-3 font-medium">Target</th>
                  <th className="py-1.5 pr-3 font-medium">Rel Vol</th>
                  <th className="py-1.5 pr-3 font-medium">Qty</th>
                  <th className="py-1.5 pr-3 font-medium">Current Value</th>
                  <th className="py-1.5 pr-3 font-medium">Time</th>
                  <th className="py-1.5 pr-3 font-medium">Result</th>
                  <th className="py-1.5 pr-3 font-medium">R</th>
                  <th className="py-1.5 pr-3 font-medium">P&L %</th>
                  <th className="py-1.5 pr-3 font-medium">Net P&L</th>
                  <th className="py-1.5 pr-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {live.open.map((t) => (
                  <tr key={t._id} className="border-b border-slate-800/60">
                    <td className="py-2 pr-3 font-mono font-semibold text-slate-100">{t.symbol}</td>
                    <td className="py-2 pr-3 space-x-1 whitespace-nowrap">
                      <StrategyBadge setupType={t.setupType} />
                      <DirectionBadge direction={t.direction} />
                    </td>
                    <td className="py-2 pr-3 font-mono text-slate-400">{t.breakoutPrice?.toFixed(2) ?? '—'}</td>
                    <td className={`py-2 pr-3 font-mono font-semibold ${(t.unrealizedPct ?? 0) >= 0 ? 'text-bull' : 'text-bear'}`}>
                      {t.currentPrice != null ? t.currentPrice.toFixed(2) : '—'}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-bear min-w-[64px]">
                      {t.suggestedStop?.toFixed(2) ?? '—'}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-bull min-w-[64px]">
                      {t.suggestedTarget?.toFixed(2) ?? '—'}
                      {(() => {
                        const pct = distanceProgress(t.currentPrice, t.suggestedStop, t.suggestedTarget, t.direction);
                        return pct == null ? null : (
                          <div className="h-1 rounded-full bg-surface-elevated/60 relative mt-1 overflow-hidden">
                            <div
                              className={`absolute inset-y-0 left-0 rounded-full ${pct >= 50 ? 'bg-bull' : 'bg-bear'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        );
                      })()}
                    </td>
                    <td className="py-2 pr-3 font-mono text-slate-400">{t.relVolume != null ? `${t.relVolume.toFixed(1)}×` : '—'}</td>
                    <td className="py-2 pr-3 font-mono text-slate-400">{t.shares ?? '—'}</td>
                    <td className="py-2 pr-3 font-mono text-slate-300">
                      {t.currentPrice != null && t.shares != null ? formatCurrency(t.currentPrice * t.shares) : '—'}
                    </td>
                    <td className="py-2 pr-3 text-slate-500 text-xs whitespace-nowrap">{formatTime(t.alertedAt ?? t.barTime)}</td>
                    <td className="py-2 pr-3 text-xs text-slate-500">
                      {t.stopBreached ? <span className="text-bear">▼ below stop</span>
                        : t.targetReached ? <span className="text-bull">▲ target hit</span>
                        : 'open'}
                    </td>
                    <td className="py-2 pr-3 font-mono text-slate-500 text-xs">—</td>
                    <td className={`py-2 pr-3 font-mono text-xs ${(t.unrealizedPct ?? 0) >= 0 ? 'text-bull' : 'text-bear'}`}>
                      {t.unrealizedPct != null ? formatPercent(t.unrealizedPct) : '—'}
                    </td>
                    <td className={`py-2 pr-3 font-mono ${(t.unrealizedGross ?? 0) >= 0 ? 'text-bull' : 'text-bear'}`}>
                      {t.unrealizedGross != null ? formatCurrency(t.unrealizedGross) : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {closingId === String(t._id) ? (
                        <span className="inline-flex gap-1.5">
                          <button onClick={() => handleClose(t._id)} className="px-2 py-0.5 rounded text-xs bg-bear/20 hover:bg-bear/30 text-bear border border-bear/40">
                            Confirm
                          </button>
                          <button onClick={() => setClosingId(null)} className="px-2 py-0.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300">×</button>
                        </span>
                      ) : (
                        <button onClick={() => setClosingId(String(t._id))} className="px-2 py-0.5 rounded text-xs bg-slate-700/70 hover:bg-slate-600 text-slate-300 border border-slate-600/50">
                          Close
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {live.settled.map((t) => {
                  const meta = EXIT_META[t.exitReason] ?? { label: t.exitReason, cls: 'text-slate-300' };
                  return (
                    <tr key={t._id} className="border-b border-slate-800/60 last:border-0 opacity-80">
                      <td className="py-2 pr-3 font-mono font-semibold text-slate-200">{t.symbol}</td>
                      <td className="py-2 pr-3 space-x-1 whitespace-nowrap">
                        <StrategyBadge setupType={t.setupType} />
                        <DirectionBadge direction={t.direction} />
                      </td>
                      <td className="py-2 pr-3 font-mono text-slate-400">{t.breakoutPrice?.toFixed(2) ?? '—'}</td>
                      <td className={`py-2 pr-3 font-mono ${(t.resultPct ?? 0) >= 0 ? 'text-bull' : 'text-bear'}`}>
                        {t.exitPrice != null ? t.exitPrice.toFixed(2) : '—'}
                      </td>
                      <td className="py-2 pr-3 font-mono text-[11px] text-bear">{t.suggestedStop?.toFixed(2) ?? '—'}</td>
                      <td className="py-2 pr-3 font-mono text-[11px] text-bull">{t.suggestedTarget?.toFixed(2) ?? '—'}</td>
                      <td className="py-2 pr-3 font-mono text-slate-400">{t.relVolume != null ? `${t.relVolume.toFixed(1)}×` : '—'}</td>
                      <td className="py-2 pr-3 font-mono text-slate-400">{t.shares ?? '—'}</td>
                      <td className="py-2 pr-3 font-mono text-slate-400">
                        {t.exitPrice != null && t.shares != null ? formatCurrency(t.exitPrice * t.shares) : '—'}
                      </td>
                      <td className="py-2 pr-3 text-slate-500 text-xs whitespace-nowrap">{formatTime(t.exitTime)}</td>
                      <td className={`py-2 pr-3 text-xs font-semibold ${meta.cls}`}>{meta.label}</td>
                      <td className={`py-2 pr-3 font-mono text-xs ${(t.rMultiple ?? 0) >= 0 ? 'text-bull' : 'text-bear'}`}>
                        {t.rMultiple != null ? `${t.rMultiple.toFixed(2)}R` : '—'}
                      </td>
                      <td className={`py-2 pr-3 font-mono text-xs ${(t.resultPct ?? 0) >= 0 ? 'text-bull' : 'text-bear'}`}>
                        {t.resultPct != null ? formatPercent(t.resultPct) : '—'}
                      </td>
                      <td className={`py-2 pr-3 font-mono ${(t.paperPnl ?? 0) >= 0 ? 'text-bull' : 'text-bear'}`}>
                        {formatCurrency(t.paperPnl)}
                      </td>
                      <td />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="glass rounded-xl p-3.5 sticky top-2 z-10 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide mr-1">Strategy</span>
          {STRATEGIES.map((s) => (
            <Chip key={s} active={filters.strategies.includes(s)} onClick={() => toggleIn('strategies', s)}>
              <StrategyBadge setupType={s} />
            </Chip>
          ))}
          <span className="w-px h-4 bg-slate-700 mx-1" />
          <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide mr-1">Direction</span>
          {DIRECTIONS.map((d) => (
            <Chip
              key={d}
              active={filters.directions.includes(d)}
              onClick={() => toggleIn('directions', d)}
              activeClass={d === 'SHORT' ? 'bg-bear/20 text-bear border-bear/40' : 'bg-bull/20 text-bull border-bull/40'}
            >
              {d}
            </Chip>
          ))}
          <span className="w-px h-4 bg-slate-700 mx-1" />
          <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide mr-1">Outcome</span>
          {OUTCOMES.map((o) => (
            <Chip key={o} active={filters.outcomes.includes(o)} onClick={() => toggleIn('outcomes', o)}>
              {o}
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
            {filtered.length} of {signals.length} triggers
          </span>
        </div>
      </div>

      {/* Trigger feed */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-14">
          <p className="text-4xl mb-2">🔍</p>
          <p className="text-slate-400 font-medium">No triggers match these filters</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 text-left border-b border-slate-700/60">
                <th className="py-2 pr-3 font-medium">Symbol</th>
                <th className="py-2 pr-3 font-medium">Setup</th>
                <th className="py-2 pr-3 font-medium">Entry</th>
                <th className="py-2 pr-3 font-medium">Stop</th>
                <th className="py-2 pr-3 font-medium">Target</th>
                <th className="py-2 pr-3 font-medium">Rel Vol</th>
                <th className="py-2 pr-3 font-medium">Outcome</th>
                <th className="py-2 pr-3 font-medium">R</th>
                <th className="py-2 pr-3 font-medium">Net P&L</th>
                <th className="py-2 font-medium">Session</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 150).map((s) => {
                const outcome = outcomeOf(s);
                const meta = EXIT_META[s.exitReason] ?? { label: 'Open', cls: 'text-accent' };
                return (
                  <tr key={s._id} className="border-b border-slate-800/60 last:border-0 hover:bg-surface-hover/30">
                    <td className="py-2 pr-3 font-mono font-semibold text-slate-100">{s.symbol}</td>
                    <td className="py-2 pr-3 space-x-1 whitespace-nowrap">
                      <StrategyBadge setupType={s.setupType} />
                      <DirectionBadge direction={s.direction} />
                    </td>
                    <td className="py-2 pr-3 font-mono text-slate-300">{s.breakoutPrice?.toFixed(2) ?? '—'}</td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-bear">{s.suggestedStop?.toFixed(2) ?? '—'}</td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-bull">{s.suggestedTarget?.toFixed(2) ?? '—'}</td>
                    <td className="py-2 pr-3 font-mono text-slate-400">{s.relVolume != null ? `${s.relVolume.toFixed(1)}×` : '—'}</td>
                    <td className={`py-2 pr-3 text-xs font-semibold ${outcome === 'OPEN' ? 'text-accent' : meta.cls}`}>
                      {outcome === 'OPEN' ? 'Open' : meta.label}
                    </td>
                    <td className="py-2 pr-3 font-mono text-slate-400">{s.rMultiple != null ? `${s.rMultiple.toFixed(2)}R` : '—'}</td>
                    <td className={`py-2 pr-3 font-mono font-semibold ${(s.paperPnl ?? 0) >= 0 ? 'text-bull' : s.paperPnl != null ? 'text-bear' : 'text-slate-500'}`}>
                      {s.paperPnl != null ? formatCurrency(s.paperPnl) : '—'}
                    </td>
                    <td className="py-2 text-slate-500 text-xs">{s.sessionDate}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default IntradayTrading;
