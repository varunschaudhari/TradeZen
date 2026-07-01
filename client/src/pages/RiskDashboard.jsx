/**
 * @file RiskDashboard.jsx
 * @description Real-time capital protection dashboard — positions used, capital deployed,
 *   daily loss % vs pause threshold. Refreshes on socket events + 30s poll.
 *   Read-only: displays system safety state, never places or modifies trades.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { tradesApi } from '../services/api.js';
import useSocket from '../hooks/useSocket.js';
import { SOCKET_EVENTS } from '../utils/constants.js';
import { formatCurrency, timeAgo } from '../utils/formatters.js';

const REFRESH_MS = 30_000;

/* ── Arc Gauge (SVG semicircle) ──────────────────────────────────────────────── */
const ArcGauge = ({ pct, color, size = 120, value, sub }) => {
  const R = 46;
  const cx = 60;
  const cy = 60;
  const circumference = Math.PI * R;
  const filled = Math.min(pct / 100, 1) * circumference;
  const gap = circumference - filled;

  return (
    <svg
      width={size}
      height={Math.round(size * 0.72)}
      viewBox="0 0 120 86"
      aria-hidden="true"
    >
      {/* Track */}
      <path
        d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`}
        fill="none"
        stroke="rgba(51,65,85,0.7)"
        strokeWidth="10"
        strokeLinecap="round"
      />
      {/* Fill */}
      <path
        d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${gap}`}
        style={{ transition: 'stroke-dasharray 0.7s cubic-bezier(0.4,0,0.2,1)' }}
      />
      {/* Main value — rendered inside SVG so it never collides with the arc */}
      {value != null && (
        <text
          x="60"
          y="57"
          textAnchor="middle"
          fontSize="21"
          fontWeight="800"
          fill={color}
          fontFamily="'JetBrains Mono', 'Fira Code', ui-monospace, monospace"
          letterSpacing="-0.5"
        >
          {value}
        </text>
      )}
      {/* Sub label */}
      {sub && (
        <text
          x="60"
          y="72"
          textAnchor="middle"
          fontSize="8.5"
          fill="#64748b"
          fontFamily="system-ui, -apple-system, sans-serif"
        >
          {sub}
        </text>
      )}
    </svg>
  );
};

/* ── Gauge color helper ──────────────────────────────────────────────────────── */
function gaugeColor(pct, warnAt = 70, dangerAt = 90) {
  if (pct >= dangerAt) return { hex: '#ef4444', text: 'text-red-400', label: 'Critical' };
  if (pct >= warnAt)   return { hex: '#eab308', text: 'text-amber-400', label: 'Warning' };
  return                      { hex: '#22c55e', text: 'text-emerald-400', label: 'Safe' };
}

/* ── Metric card ─────────────────────────────────────────────────────────────── */
const MetricCard = ({ title, icon, pct, mainValue, mainSub, sub1, sub2, warnAt, dangerAt }) => {
  const color = gaugeColor(pct, warnAt, dangerAt);
  return (
    <div className={`card flex flex-col items-center text-center gap-2 py-5 ${
      color.label === 'Critical' ? 'card-bear' : color.label === 'Warning' ? 'card-wait' : ''
    }`}>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-slate-500 font-semibold">
        <span>{icon}</span>
        <span>{title}</span>
      </div>

      <ArcGauge pct={pct} color={color.hex} value={mainValue} sub={mainSub} />

      <div className="w-full space-y-1 pt-1">
        {sub1 && (
          <div className="flex items-center justify-between text-xs px-1">
            <span className="text-slate-500">{sub1.label}</span>
            <span className={`font-mono font-semibold ${sub1.color ?? 'text-slate-300'}`}>{sub1.value}</span>
          </div>
        )}
        {sub2 && (
          <div className="flex items-center justify-between text-xs px-1">
            <span className="text-slate-500">{sub2.label}</span>
            <span className={`font-mono font-semibold ${sub2.color ?? 'text-slate-300'}`}>{sub2.value}</span>
          </div>
        )}
      </div>

      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
        color.label === 'Critical' ? 'bg-red-500/15 text-red-400' :
        color.label === 'Warning'  ? 'bg-amber-500/15 text-amber-400' :
                                     'bg-emerald-500/15 text-emerald-400'
      }`}>
        {color.label}
      </span>
    </div>
  );
};

/* ── Status banner ───────────────────────────────────────────────────────────── */
const StatusBanner = ({ risk }) => {
  if (!risk) return null;

  const { isDailyLossPaused, capitalDeployedPct, maxCapitalDeployedPct, openCount, maxOpenTrades, slotsLeft } = risk;

  let level = 'safe';
  let message = 'All limits within bounds — BUY signals are active.';
  if (isDailyLossPaused) {
    level = 'paused';
    message = 'Daily loss threshold reached — BUY signals are paused for today.';
  } else if (capitalDeployedPct >= maxCapitalDeployedPct) {
    level = 'critical';
    message = 'Capital limit reached — no new positions can be opened.';
  } else if (slotsLeft === 0) {
    level = 'critical';
    message = `Max positions reached (${maxOpenTrades}/${maxOpenTrades}) — no new positions can be opened.`;
  } else if (capitalDeployedPct >= maxCapitalDeployedPct * 0.85 || openCount >= maxOpenTrades - 2) {
    level = 'caution';
    message = `Approaching limits — ${slotsLeft} slot${slotsLeft !== 1 ? 's' : ''} left, ${(maxCapitalDeployedPct - capitalDeployedPct).toFixed(1)}% capital headroom.`;
  }

  const styles = {
    safe:     { bg: 'bg-emerald-500/10 border-emerald-500/30', text: 'text-emerald-400', dot: 'bg-emerald-400', icon: '✓' },
    caution:  { bg: 'bg-amber-500/10 border-amber-500/30',   text: 'text-amber-400',   dot: 'bg-amber-400',   icon: '⚠' },
    critical: { bg: 'bg-red-500/10 border-red-500/30',       text: 'text-red-400',     dot: 'bg-red-500',     icon: '✕' },
    paused:   { bg: 'bg-red-500/10 border-red-500/30',       text: 'text-red-400',     dot: 'bg-red-500 animate-pulse', icon: '⏸' },
  }[level];

  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${styles.bg}`}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${styles.dot}`} />
      <span className={`text-sm font-semibold ${styles.text}`}>
        {styles.icon} {message}
      </span>
    </div>
  );
};

/* ── Open positions table ────────────────────────────────────────────────────── */
const PositionsTable = ({ positions, capital }) => {
  const navigate = useNavigate();
  if (!positions?.length) {
    return (
      <div className="card text-center py-10">
        <p className="text-slate-500 text-sm">No open positions</p>
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700/60">
            {['Symbol', 'Deployed', '% of Capital', 'Unrealized P&L', 'Entry', 'Stop Loss', 'Distance'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-slate-500 font-semibold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.map((p, i) => {
            const slDist = p.currentPrice && p.stopLoss
              ? ((p.currentPrice - p.stopLoss) / p.currentPrice) * 100
              : null;
            const isBelowSl = slDist !== null && slDist < 0;
            const isNearSl  = slDist !== null && slDist >= 0 && slDist < 2;
            const pnlUp = (p.unrealizedPnl ?? 0) >= 0;

            return (
              <tr
                key={p._id ?? i}
                onClick={() => navigate('/positions')}
                className="border-b border-slate-700/30 last:border-0 hover:bg-surface-elevated/30 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-100">{p.symbol}</span>
                    {p.target1Hit && (
                      <span className="text-[9px] bg-emerald-500/15 text-emerald-400 px-1.5 py-px rounded-full font-bold">T1</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-slate-300 tabular-nums">
                  {formatCurrency(p.capitalDeployed, 0)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-surface-elevated rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent/70 rounded-full"
                        style={{ width: `${Math.min(p.capitalPct * 10, 100)}%` }}
                      />
                    </div>
                    <span className="font-mono text-slate-400 tabular-nums text-xs">{p.capitalPct}%</span>
                  </div>
                </td>
                <td className={`px-4 py-3 font-mono font-semibold tabular-nums ${pnlUp ? 'text-emerald-400' : 'text-red-400'}`}>
                  {pnlUp ? '+' : ''}{formatCurrency(p.unrealizedPnl ?? 0, 0)}
                </td>
                <td className="px-4 py-3 font-mono text-slate-400 tabular-nums text-xs">
                  {p.entryPrice ? formatCurrency(p.entryPrice, 0) : '—'}
                </td>
                <td className="px-4 py-3 font-mono text-slate-400 tabular-nums text-xs">
                  {p.stopLoss ? formatCurrency(p.stopLoss, 0) : '—'}
                </td>
                <td className={`px-4 py-3 font-mono font-semibold tabular-nums text-xs ${
                  isBelowSl ? 'text-red-400' : isNearSl ? 'text-amber-400' : 'text-slate-400'
                }`}>
                  {slDist !== null ? `${slDist.toFixed(1)}%` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

/* ── Main page ───────────────────────────────────────────────────────────────── */
const RiskDashboard = () => {
  const [risk,      setRisk]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const timerRef = useRef(null);
  const { subscribe } = useSocket();

  const fetchRisk = useCallback(async () => {
    try {
      const res = await tradesApi.getRiskSummary();
      setRisk(res.data);
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  /* Initial load + 30s poll */
  useEffect(() => {
    fetchRisk();
    timerRef.current = setInterval(fetchRisk, REFRESH_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchRisk]);

  /* Refresh on any trade/scan socket event */
  useEffect(() => {
    const events = [
      SOCKET_EVENTS.SCAN_COMPLETE,
      SOCKET_EVENTS.TRADE_TARGET1,
      SOCKET_EVENTS.TRADE_TARGET2,
      SOCKET_EVENTS.TRADE_SL_WARNING,
    ];
    const unsubs = events.map((ev) => subscribe(ev, fetchRisk));
    return () => unsubs.forEach((u) => u());
  }, [subscribe, fetchRisk]);

  const r = risk;

  /* Skeleton */
  if (loading) {
    return (
      <div className="min-h-screen bg-surface p-4 space-y-4">
        <div className="skeleton h-8 rounded w-48" />
        <div className="skeleton h-12 rounded" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1,2,3].map((i) => <div key={i} className="skeleton h-52 rounded-xl" />)}
        </div>
        <div className="skeleton h-40 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-surface p-4">
        <div className="card border-red-500/30 bg-red-500/10 text-red-400 text-sm">
          Failed to load risk summary: {error}
        </div>
      </div>
    );
  }

  /* Derived values for gauge cards */
  const positionsPct  = r ? (r.openCount / r.maxOpenTrades) * 100 : 0;
  const capitalPct    = r?.capitalDeployedPct ?? 0;
  const dailyLossPct  = r?.dailyLossPct ?? 0;
  const dailyLossProgress = r ? (dailyLossPct / r.dailyLossThreshold) * 100 : 0;

  return (
    <div className="min-h-screen bg-surface p-4 space-y-5">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Risk Dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {updatedAt ? `Updated ${timeAgo(updatedAt.toISOString())}` : 'Loading…'}
          </p>
        </div>
        <button onClick={fetchRisk} className="btn-primary text-xs px-3 py-1.5">
          Refresh
        </button>
      </div>

      {/* Status banner */}
      <StatusBanner risk={r} />

      {/* Three gauge cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

        {/* Positions */}
        <MetricCard
          title="Position Slots"
          icon="↗"
          pct={positionsPct}
          mainValue={`${r?.openCount ?? 0}/${r?.maxOpenTrades ?? 15}`}
          mainSub="positions open"
          sub1={{ label: 'Slots remaining', value: `${r?.slotsLeft ?? 0}`, color: r?.slotsLeft <= 2 ? 'text-red-400' : 'text-emerald-400' }}
          sub2={{ label: 'Utilisation', value: `${r?.slotsUsedPct ?? 0}%` }}
          warnAt={70}
          dangerAt={90}
        />

        {/* Capital */}
        <MetricCard
          title="Capital Deployed"
          icon="₹"
          pct={(capitalPct / (r?.maxCapitalDeployedPct ?? 95)) * 100}
          mainValue={`${capitalPct}%`}
          mainSub={`of ${r?.maxCapitalDeployedPct ?? 95}% max`}
          sub1={{ label: 'Deployed', value: formatCurrency(r?.totalCapitalDeployed ?? 0, 0) }}
          sub2={{ label: 'Available', value: formatCurrency(r?.capitalAvailable ?? 0, 0), color: 'text-emerald-400' }}
          warnAt={75}
          dangerAt={92}
        />

        {/* Daily loss */}
        <MetricCard
          title="Daily Loss"
          icon="⚡"
          pct={dailyLossProgress}
          mainValue={`${dailyLossPct}%`}
          mainSub={`of ${r?.dailyLossThreshold ?? 3}% pause limit`}
          sub1={{ label: "Today's P&L", value: formatCurrency(r?.dailyRealizedPnl ?? 0, 0), color: (r?.dailyRealizedPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400' }}
          sub2={{ label: 'Trades today', value: `${r?.dailyWins ?? 0}W / ${r?.dailyLosses ?? 0}L` }}
          warnAt={60}
          dangerAt={90}
        />
      </div>

      {/* Risk config strip */}
      <div className="glass rounded-xl px-5 py-3 flex flex-wrap items-center gap-x-8 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">Risk per trade</span>
          <span className="font-mono font-bold text-slate-200">{r?.riskPct ?? 0.4}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">Max loss / trade</span>
          <span className="font-mono font-bold text-red-400">{formatCurrency(r?.perTradeMaxLoss ?? 0, 0)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">Total capital</span>
          <span className="font-mono font-bold text-slate-200">{formatCurrency(r?.capital ?? 0, 0)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">BUY signals</span>
          <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${
            r?.isDailyLossPaused
              ? 'bg-red-500/15 text-red-400'
              : 'bg-emerald-500/15 text-emerald-400'
          }`}>
            {r?.isDailyLossPaused ? 'Paused' : 'Active'}
          </span>
        </div>
      </div>

      {/* Open positions breakdown */}
      <div>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Open Positions — Capital Allocation
        </h2>
        <PositionsTable positions={r?.openPositions} capital={r?.capital} />
      </div>
    </div>
  );
};

export default RiskDashboard;
