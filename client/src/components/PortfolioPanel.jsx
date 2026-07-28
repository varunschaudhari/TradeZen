/**
 * Portfolio Command Center — hero card with 3-metric row, heat map, and positions book.
 * Designed for a Bloomberg-style dark-pro trading terminal feel.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import useSocket from '../hooks/useSocket.js';
import useCountUp from '../hooks/useCountUp.js';
import ContextMenu from './ContextMenu.jsx';
import { useApp } from '../context/AppContext.jsx';
import { tradesApi, performanceApi, quotesApi, pricesApi, intradayApi } from '../services/api.js';
import { SOCKET_EVENTS, EXIT_REASONS, MAX_OPEN_TRADES } from '../utils/constants.js';
import { formatCurrency, formatPercent, timeAgo } from '../utils/formatters.js';

const POLL_MS          = 45_000;
const PRICE_REFRESH_MS = 30_000;

const isMarketHours = () => {
  const nowIST = new Date(Date.now() + 5.5 * 3600 * 1000);
  const day = nowIST.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
};

/* ══════════════════════════════════════════════════════════════════
   Equity Sparkline — tiny curve from monthly capital snapshots
═══════════════════════════════════════════════════════════════════ */
const Sparkline = ({ points }) => {
  if (!points || points.length < 2) {
    return <span className="text-[10px] text-slate-700 italic">equity — building…</span>;
  }
  const W = 96, H = 26;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const coords = points.map((v, i) => ({
    x: (i / (points.length - 1)) * W,
    y: H - ((v - min) / span) * (H - 4) - 2,
  }));
  const up = points[points.length - 1] >= points[0];
  const color = up ? '#22c55e' : '#ef4444';
  const gradId = up ? 'spk-bull' : 'spk-bear';

  /* Catmull-Rom → cubic Bezier smooth path */
  const smooth = () => {
    let d = `M${coords[0].x},${coords[0].y}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[Math.max(0, i - 1)];
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const p3 = coords[Math.min(coords.length - 1, i + 2)];
      const cp1x = (p1.x + (p2.x - p0.x) / 6).toFixed(2);
      const cp1y = (p1.y + (p2.y - p0.y) / 6).toFixed(2);
      const cp2x = (p2.x - (p3.x - p1.x) / 6).toFixed(2);
      const cp2y = (p2.y - (p3.y - p1.y) / 6).toFixed(2);
      d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
    }
    return d;
  };
  const linePath = smooth();
  const last = coords[coords.length - 1];
  const areaPath = `${linePath} L${last.x},${H} L${coords[0].x},${H} Z`;

  return (
    <svg width={W} height={H} className="overflow-visible flex-shrink-0" aria-label="equity curve">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last.x} cy={last.y} r="2.5" fill={color} />
    </svg>
  );
};
Sparkline.propTypes = { points: PropTypes.arrayOf(PropTypes.number) };

/* ══════════════════════════════════════════════════════════════════
   Risk-o-meter — SVG semicircle gauge showing max-loss % of capital
   Arc: left (0%) → top (50%) → right (100% = MAX_PCT).
   sweep=0 (CCW in SVG) goes through the top of the circle.
═══════════════════════════════════════════════════════════════════ */
const MAX_RISK_PCT = 6; // gauge full = 6% of capital at risk

const RiskOmeter = ({ positions, capital }) => {
  const maxLoss = positions.reduce((sum, p) => {
    const cur = p.currentPrice ?? p.entryPrice ?? 0;
    const sl  = p.stopLoss ?? 0;
    const sh  = p.shares ?? 0;
    return sum + Math.max(0, (cur - sl) * sh);
  }, 0);

  const riskPct  = capital > 0 ? (maxLoss / capital) * 100 : 0;
  const fillFrac = Math.min(riskPct / MAX_RISK_PCT, 1);

  // Geometry: cx=60, cy=62, r=46
  // At fillFrac f: θ = (1-f)*180°  (180°=left, 0°=right)
  // SVG point: x = cx + r*cos(θ), y = cy - r*sin(θ)
  const cx = 60, cy = 62, r = 46;
  const pt = (f) => {
    const rad = ((1 - f) * 180 * Math.PI) / 180;
    return [+(cx + r * Math.cos(rad)).toFixed(2), +(cy - r * Math.sin(rad)).toFixed(2)];
  };

  const [lx, ly] = pt(0);
  const [rx, ry] = pt(1);
  const [fx, fy] = pt(fillFrac);

  const track = `M ${lx} ${ly} A ${r} ${r} 0 0 0 ${rx} ${ry}`;
  const arc   = fillFrac > 0.01
    ? `M ${lx} ${ly} A ${r} ${r} 0 0 0 ${fx} ${fy}`
    : null;

  const color = riskPct < 2 ? '#22c55e' : riskPct < 4 ? '#eab308' : '#ef4444';
  const label = riskPct < 2 ? 'Low' : riskPct < 4 ? 'Medium' : 'High';

  return (
    <div className="flex flex-col items-center">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-0.5">Risk Exposure</p>
      <svg width="120" height="74" viewBox="0 8 120 74">
        {/* Track */}
        <path d={track} fill="none" stroke="#1e293b" strokeWidth="10" strokeLinecap="round" />
        {/* Fill */}
        {arc && <path d={arc} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" />}
        {/* Center value */}
        <text
          x="60" y="62" textAnchor="middle"
          fontSize="15" fontWeight="700" fill={color}
          fontFamily="'JetBrains Mono', 'Fira Code', monospace"
        >
          {riskPct.toFixed(1)}%
        </text>
        {/* Scale labels — at y=76 so they stay inside the viewBox (8..82) */}
        <text x={lx - 4} y="76" textAnchor="end" fontSize="8" fill="#475569">0%</text>
        <text x={rx + 4} y="76" textAnchor="start" fontSize="8" fill="#475569">{MAX_RISK_PCT}%</text>
      </svg>
      <p className="text-[10px] -mt-1" style={{ color }}>{label} risk</p>
      <p className="text-[9px] text-slate-600">if all stops hit</p>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════
   Portfolio Heat Map — 15-slot grid, colored by unrealized P&L %
═══════════════════════════════════════════════════════════════════ */
const HeatMap = ({ positions, maxSlots }) => {
  const cellStyle = (p) => {
    if (!p) return 'border-dashed border-slate-700/40 bg-slate-800/20 text-slate-700 cursor-default';
    const pct = p.unrealizedPnlPct ?? 0;
    if (pct >= 3)    return 'border-emerald-500/50 bg-emerald-500/25 text-emerald-300 cursor-pointer hover:bg-emerald-500/35';
    if (pct >= 1)    return 'border-emerald-500/30 bg-emerald-500/12 text-emerald-400 cursor-pointer hover:bg-emerald-500/20';
    if (pct >= -0.5) return 'border-slate-600/50 bg-slate-700/40 text-slate-300 cursor-pointer hover:bg-slate-700/60';
    if (pct >= -2)   return 'border-red-500/30 bg-red-500/12 text-red-400 cursor-pointer hover:bg-red-500/20';
    return                  'border-red-500/50 bg-red-500/25 text-red-300 cursor-pointer hover:bg-red-500/35';
  };

  const slots = Array.from({ length: maxSlots }, (_, i) => positions[i] ?? null);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-widest text-slate-500">Portfolio Heat Map</p>
        <p className="text-[10px] text-slate-600">{positions.length} / {maxSlots} slots filled</p>
      </div>
      <div className="stagger-grid grid grid-cols-5 gap-1.5">
        {slots.map((p, i) => (
          <div
            key={i}
            title={p ? `${p.symbol}: ${(p.unrealizedPnlPct ?? 0).toFixed(2)}%` : 'Empty slot'}
            className={`rounded-lg border px-1 py-1.5 text-center transition-all ${cellStyle(p)}`}
          >
            {p ? (
              <>
                <p className="font-mono text-[9px] font-bold truncate leading-tight">{p.symbol}</p>
                <p className="font-mono text-[10px] font-bold leading-snug mt-0.5">
                  {(p.unrealizedPnlPct ?? 0) >= 0 ? '▲' : '▼'}
                  {Math.abs(p.unrealizedPnlPct ?? 0).toFixed(1)}%
                </p>
              </>
            ) : (
              <p className="text-[9px] leading-snug select-none py-1">—</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
HeatMap.propTypes = { positions: PropTypes.array.isRequired, maxSlots: PropTypes.number.isRequired };

/* ══════════════════════════════════════════════════════════════════
   SL → Entry → T1 → T2 Progress Bar
   Current price is a dot on the bar. Red zone = risk; green = reward.
═══════════════════════════════════════════════════════════════════ */
const TradeProgressBar = ({ trade }) => {
  const { stopLoss: sl, entryPrice: entry, target1: t1, target2: t2, currentPrice: cur } = trade;
  if (!sl || !entry || !t1 || !t2 || cur == null) return null;

  const min  = sl, max = t2, span = max - min || 1;
  const pct  = (v) => Math.min(Math.max(((v - min) / span) * 100, 0), 100);
  const ePct = pct(entry);
  const tPct = pct(t1);
  const cPct = pct(cur);
  const up   = cur >= entry;

  return (
    <div className="mt-2.5 mb-0.5 select-none">
      {/* Bar */}
      <div className="relative h-1.5 rounded-full bg-slate-800/80">
        {/* Risk zone: SL → Entry — gradient red */}
        <div
          className="absolute h-full rounded-l-full"
          style={{
            width: `${ePct}%`,
            background: 'linear-gradient(90deg, rgba(239,68,68,0.12) 0%, rgba(239,68,68,0.38) 100%)',
          }}
        />
        {/* Reward zone 1: Entry → T1 */}
        <div
          className="absolute h-full"
          style={{
            left: `${ePct}%`,
            width: `${Math.max(0, tPct - ePct)}%`,
            background: 'linear-gradient(90deg, rgba(34,197,94,0.2) 0%, rgba(34,197,94,0.42) 100%)',
          }}
        />
        {/* Reward zone 2: T1 → T2 — brighter gradient */}
        <div
          className="absolute h-full rounded-r-full"
          style={{
            left: `${tPct}%`,
            background: 'linear-gradient(90deg, rgba(34,197,94,0.42) 0%, rgba(34,197,94,0.65) 100%)',
          }}
        />
        {/* Entry marker (thin vertical line) */}
        <div
          className="absolute w-px h-3 bg-slate-500 rounded -top-[3px]"
          style={{ left: `${ePct}%` }}
        />
        {/* T1 marker */}
        <div
          className="absolute w-px h-3 bg-emerald-500/60 rounded -top-[3px]"
          style={{ left: `${tPct}%` }}
        />
        {/* Current price dot */}
        <div
          className="absolute w-3 h-3 rounded-full border-[2px] -top-[3px] -translate-x-1/2 shadow"
          style={{
            left: `${cPct}%`,
            backgroundColor: up ? '#22c55e' : '#ef4444',
            borderColor:     up ? '#22c55e' : '#ef4444',
          }}
        />
      </div>
      {/* Scale labels */}
      <div className="flex justify-between mt-1 text-[9px] font-mono text-slate-600">
        <span>SL {sl?.toLocaleString('en-IN')}</span>
        <span className="text-slate-600">T1 {t1?.toLocaleString('en-IN')}</span>
        <span>T2 {t2?.toLocaleString('en-IN')}</span>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════
   Per-position attention status label
═══════════════════════════════════════════════════════════════════ */
const positionStatus = (p) => {
  const cur = p.currentPrice;
  if (cur == null) return { label: 'no price', cls: 'text-slate-600' };
  if (p.target1Hit) {
    return { label: '● T1 hit · SL trailed', cls: 'text-emerald-400' };
  }
  const toSL = p.stopLoss ? ((cur - p.stopLoss) / cur) * 100 : null;
  const toT2 = p.target2  ? ((p.target2 - cur)  / cur) * 100 : null;
  if (toSL != null && toSL <= 2) return { label: '⚠ near stop', cls: 'text-red-400' };
  if (toT2 != null && toT2 <= 2) return { label: '⭐ near T2',   cls: 'text-emerald-400' };
  return { label: 'holding', cls: 'text-slate-600' };
};

/* ══════════════════════════════════════════════════════════════════
   Main PortfolioPanel component
═══════════════════════════════════════════════════════════════════ */
const PortfolioPanel = ({ perf }) => {
  const navigate = useNavigate();
  const { subscribe } = useSocket();
  const { config } = useApp();
  const maxSlots = config?.maxOpenTrades ?? MAX_OPEN_TRADES;
  const [positions, setPositions] = useState([]);
  const [summary,   setSummary]   = useState(null);
  const [equity,    setEquity]    = useState([]);
  const [goLiveGate, setGoLiveGate] = useState(null);

  const positionsRef = useRef([]);
  useEffect(() => { positionsRef.current = positions; }, [positions]);

  const loadLive = useCallback(async () => {
    try {
      const res = await tradesApi.getLive();
      const body = res?.data ?? res;
      setPositions(body?.positions ?? []);
      setSummary(body?.summary ?? null);
    } catch { /* non-critical; falls back to perf prop */ }
  }, []);

  const refreshPrices = useCallback(async () => {
    const syms = [...new Set(positionsRef.current.map((p) => p.symbol))];
    if (!syms.length || !isMarketHours()) return;
    try {
      const priceMap = await quotesApi.get(syms);
      const prices = syms
        .filter((s) => priceMap[s]?.price != null)
        .map((s) => ({ symbol: s, currentPrice: priceMap[s].price }));
      if (prices.length) await pricesApi.update(prices);
    } catch { /* silent — price refresh is best-effort */ }
  }, []);

  useEffect(() => { loadLive(); }, [loadLive]);
  useEffect(() => {
    const id = setInterval(loadLive, POLL_MS);
    return () => clearInterval(id);
  }, [loadLive]);
  useEffect(() => {
    const id = setInterval(async () => { await refreshPrices(); loadLive(); }, PRICE_REFRESH_MS);
    return () => clearInterval(id);
  }, [refreshPrices, loadLive]);
  useEffect(() => subscribe(SOCKET_EVENTS.SCAN_COMPLETE, loadLive),  [subscribe, loadLive]);
  useEffect(() => subscribe(SOCKET_EVENTS.TRADE_TARGET1, loadLive),  [subscribe, loadLive]);

  useEffect(() => {
    performanceApi.getHistory().then((r) => {
      const monthly = (r?.data?.monthly ?? r?.monthly ?? []);
      setEquity(monthly.map((m) => m.capital).filter((c) => c != null));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    intradayApi.getGoLive().then((r) => {
      setGoLiveGate((r?.data ?? r)?.swing ?? null);
    }).catch(() => {});
  }, []);

  /* Derived numbers */
  const capital    = perf?.capital ?? 0;
  const deployed   = summary?.totalDeployed  ?? 0;
  const unrealized = summary?.totalUnrealized ?? 0;
  const realized   = perf?.totalPnl ?? 0;
  const closed     = perf?.totalTrades ?? 0;
  const open       = positions.length;

  const deployedPct  = capital > 0 ? (deployed   / capital)  * 100 : 0;
  const unrealPct    = deployed > 0 ? (unrealized / deployed) * 100 : 0;

  /* Animated P&L values */
  const animatedUnrealized = useCountUp(unrealized);
  const animatedRealized   = useCountUp(realized);

  /* Go-live readiness — the real evidence gate (goLiveGate.js: sample≥30, span≥42d,
     expectancy>0, profit factor≥1.3, drawdown≤10%), not a quick approximation. */
  const goLive = goLiveGate?.pass
    ? { text: '✅ go-live ready', cls: 'bg-emerald-500/15 text-emerald-400' }
    : { text: `⏳ ${goLiveGate?.stats?.sample ?? closed}/30 trades`, cls: 'bg-amber-500/15 text-amber-400' };

  /* Sort worst → best P&L (attention-first order) */
  const sorted = [...positions].sort((a, b) => (a.unrealizedPnlPct ?? 0) - (b.unrealizedPnlPct ?? 0));

  const pnlUp = unrealized >= 0;

  /* Context menu state */
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, position }
  const openCtx = useCallback((e, position) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, position });
  }, []);

  const quickClose = useCallback(async (p) => {
    if (!p.currentPrice) { toast.error('No current price available'); return; }
    try {
      await tradesApi.close(p._id, p.currentPrice, EXIT_REASONS.MANUAL);
      toast.success(`${p.symbol} closed at ${formatCurrency(p.currentPrice, 0)}`);
      loadLive();
    } catch (err) {
      toast.error(err.message);
    }
  }, [loadLive]);

  return (
    <div className="space-y-3">

      {/* ── Row 1: 3-metric hero cards ──────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

        {/* Card A: Book P&L — gradient tint + glow */}
        <div className={`card flex flex-col ${pnlUp ? 'card-bull' : 'card-bear'}`}>
          <p className="text-[10px] uppercase tracking-widest text-slate-500">Book P&amp;L (open)</p>
          <p className={`text-3xl font-mono font-extrabold tabular-nums mt-2 ${pnlUp ? 'text-emerald-400 glow-bull' : 'text-red-400 glow-bear'}`}>
            {pnlUp ? '▲' : '▼'} {formatCurrency(Math.abs(animatedUnrealized), 0)}
          </p>
          <p className={`text-[11px] font-mono mt-0.5 ${pnlUp ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
            {formatPercent(unrealPct)} on ₹{(deployed / 100000).toFixed(1)}L deployed
          </p>
          <div className="flex items-end justify-between mt-auto pt-4">
            <div>
              <p className="text-[9px] uppercase tracking-wider text-slate-600">Realized (closed)</p>
              <p className={`text-sm font-mono font-bold mt-0.5 ${animatedRealized >= 0 ? 'text-emerald-400 glow-bull' : 'text-red-400 glow-bear'}`}>
                {formatCurrency(animatedRealized, 0)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <span className={`chip ${goLive.cls}`}>{goLive.text}</span>
              <Sparkline points={equity} />
            </div>
          </div>
        </div>

        {/* Card B: Risk-o-meter */}
        <div className="card flex items-center justify-center py-6">
          <RiskOmeter positions={positions} capital={capital} />
        </div>

        {/* Card C: Book stats grid */}
        <div className="card grid grid-cols-2 gap-x-4 gap-y-3 content-start">
          <div>
            <p className="text-[9px] uppercase tracking-widest text-slate-600">Open Slots</p>
            <p className="text-2xl font-mono font-extrabold text-slate-100 tabular-nums mt-0.5">
              {open}
              <span className="text-slate-500 text-base font-normal"> / {maxSlots}</span>
            </p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-widest text-slate-600">Deployed</p>
            <p className="text-2xl font-mono font-extrabold text-slate-100 tabular-nums mt-0.5">
              {deployedPct.toFixed(0)}
              <span className="text-slate-500 text-base font-normal">%</span>
            </p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-widest text-slate-600">Risk / Trade</p>
            <p className="text-lg font-mono font-bold text-slate-300 mt-0.5">0.4%</p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-widest text-slate-600">Closed Trades</p>
            <p className="text-lg font-mono font-bold text-slate-300 mt-0.5">{closed}</p>
          </div>
          {capital > 0 && (
            <div className="col-span-2">
              <p className="text-[9px] uppercase tracking-widest text-slate-600">Capital Base</p>
              <p className="text-[13px] font-mono font-semibold text-slate-400 mt-0.5">
                {formatCurrency(capital, 0)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Row 2: Heat map ──────────────────────────────────────────── */}
      <div className="card">
        <HeatMap positions={sorted} maxSlots={maxSlots} />
      </div>

      {/* ── Row 3: Positions book with progress bars ─────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
            Open Positions
            <span className="ml-2 text-slate-500 font-normal">({open})</span>
          </h2>
          <Link to="/positions" className="text-xs text-accent hover:underline hover:text-accent-light">
            Manage →
          </Link>
        </div>

        {open === 0 ? (
          <p className="text-slate-500 text-sm py-8 text-center">
            No open positions — BUY signals auto-open paper trades when the scanner finds setups.
          </p>
        ) : (
          <div className="max-h-[500px] overflow-y-auto space-y-1.5 pr-0.5">
            {sorted.map((p) => {
              const st = positionStatus(p);
              const up = (p.unrealizedPnlPct ?? 0) >= 0;
              return (
                <button
                  key={p._id}
                  onClick={() => navigate(`/stock/${p.symbol}`)}
                  onContextMenu={(e) => openCtx(e, p)}
                  className="w-full rounded-lg border border-slate-700/50 bg-slate-800/30
                             hover:border-slate-600 hover:bg-slate-800/60
                             transition-all px-3 pt-2.5 pb-1.5 text-left"
                >
                  {/* Top row: symbol · price · P&L · status */}
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-slate-100 text-sm w-28 truncate">
                      {p.symbol}
                    </span>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      ₹{p.currentPrice?.toLocaleString('en-IN') ?? '—'}
                    </span>
                    <span
                      className={`font-mono text-sm font-bold tabular-nums ml-auto ${
                        up ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {up ? '▲' : '▼'} {formatPercent(Math.abs(p.unrealizedPnlPct ?? 0))}
                    </span>
                    <span className={`text-[10px] w-36 text-right flex-shrink-0 ${st.cls}`}>
                      {st.label}
                    </span>
                  </div>
                  {/* Progress bar */}
                  <TradeProgressBar trade={p} />
                </button>
              );
            })}
          </div>
        )}

        {/* Live pulse footer */}
        {summary?.updatedAt && (
          <p className="text-[10px] text-slate-700 mt-2 pt-2 border-t border-slate-700/40 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
            Live · updated {timeAgo(summary.updatedAt)}
            <span className="text-slate-700 ml-1">· right-click a row for actions</span>
          </p>
        )}
      </div>

      {/* Context menu — right-click on a position row */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            {
              label: 'Copy symbol',
              icon: '⎘',
              action: () => {
                navigator.clipboard.writeText(ctxMenu.position.symbol);
                toast.success(`${ctxMenu.position.symbol} copied`);
              },
            },
            {
              label: 'Quick close',
              icon: '⚡',
              sub: ctxMenu.position.currentPrice
                ? formatCurrency(ctxMenu.position.currentPrice, 0)
                : undefined,
              disabled: !ctxMenu.position.currentPrice,
              action: () => quickClose(ctxMenu.position),
            },
            { divider: true, key: 'd1' },
            {
              label: 'Go to chart',
              icon: '◉',
              action: () => navigate(`/stock/${ctxMenu.position.symbol}`),
            },
          ]}
        />
      )}
    </div>
  );
};

PortfolioPanel.propTypes = { perf: PropTypes.object };
PortfolioPanel.defaultProps = { perf: null };

export default PortfolioPanel;
