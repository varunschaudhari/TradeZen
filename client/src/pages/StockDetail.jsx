/**
 * @file StockDetail.jsx
 * @description Stock detail page (/stock/:symbol).
 *   Section 1 — symbol header + price + fundamentals
 *   Section 2 — trade setup hero: SVG price ruler + level rows + Log Trade
 *   Section 3 — candlestick chart
 *   Section 4 — technical indicators
 *   Section 5 — support/resistance + Fibonacci
 *   Section 6 — gate breakdown (collapsible)
 *   Section 7 — Claude reasoning + key risks (collapsible)
 *   Section 8 — Simons score (collapsible)
 *   Section 9 — news
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import CandlestickChart from '../components/CandlestickChart.jsx';
import MeterBar from '../components/MeterBar.jsx';
import NewsWidget from '../components/NewsWidget.jsx';
import LogTradeModal from '../components/LogTradeModal.jsx';
import useCandleData from '../hooks/useCandleData.js';
import { stockApi } from '../services/api.js';
import { GATE_NAMES, GATE_DESCRIPTIONS } from '../utils/constants.js';
import { formatCurrency, formatPercent, formatIndianNumber } from '../utils/formatters.js';

/* ── tiny helpers ───────────────────────────────────────────────────────────── */
const fmt  = (v, d = 2) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(d));
const pct  = (a, b) => (a != null && b != null && b !== 0 ? ((a - b) / b) * 100 : null);
const sign = (n) => (n >= 0 ? '+' : '');
const pctColor = (n) => (n == null ? 'text-slate-500' : n >= 0 ? 'text-bull' : 'text-bear');

/* ── Metric tile ────────────────────────────────────────────────────────────── */
const Metric = ({ label, value, color = 'text-slate-100', sub }) => (
  <div className="flex flex-col">
    <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
    <span className={`font-mono text-sm font-semibold tabular-nums mt-0.5 ${color}`}>{value ?? '—'}</span>
    {sub && <span className="text-[10px] text-slate-500">{sub}</span>}
  </div>
);

/* ── Section wrapper ────────────────────────────────────────────────────────── */
const Section = ({ title, action, children }) => (
  <div className="card">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-slate-300">{title}</h3>
      {action}
    </div>
    {children}
  </div>
);

/* ── Trend badge ────────────────────────────────────────────────────────────── */
const TREND_STYLES = { BULLISH: 'text-bull', BEARISH: 'text-bear', SIDEWAYS: 'text-slate-400' };

/* ── Days until earnings ────────────────────────────────────────────────────── */
const daysFromTs = (ts) => {
  if (!ts) return null;
  return Math.round((ts * 1000 - Date.now()) / 86_400_000);
};

/* ── SVG Price Ruler ────────────────────────────────────────────────────────── */
/**
 * Vertical ruler showing SL → Entry → T1 → T2 with the current price overlaid.
 * Color zones: red (risk), light-green (first profit leg), vivid-green (second leg).
 */
const PriceRuler = ({ current, entryLow, entryHigh, sl, t1, t2, height = 220 }) => {
  const entry = entryHigh ?? entryLow;
  if (!entry || !sl) return null;

  const W = 48;
  const H = height;
  const PAD = 14;
  const CX = W / 2;

  const prices = [sl, entry, t1, t2, current].filter((p) => p != null && p > 0);
  const low  = Math.min(...prices) * 0.994;
  const high = Math.max(...prices) * 1.006;
  const range = high - low || 1;

  const toY = (p) => PAD + (1 - (p - low) / range) * (H - 2 * PAD);

  const ySl    = toY(sl);
  const yEntry = toY(entry);
  const yT1    = t1 ? toY(t1) : null;
  const yT2    = t2 ? toY(t2) : null;
  // Clamp current price within ruler range so the line stays visible
  const yCur   = current != null
    ? toY(Math.min(Math.max(current, low * 1.002), high * 0.998))
    : null;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="flex-shrink-0 select-none"
      aria-label="Trade level ruler"
    >
      {/* Grey background track */}
      <line x1={CX} y1={PAD} x2={CX} y2={H - PAD}
        stroke="#334155" strokeWidth={4} strokeLinecap="round" />

      {/* Risk zone: SL → entry (red) */}
      <line x1={CX} y1={yEntry} x2={CX} y2={ySl}
        stroke="#ef4444" strokeWidth={4} strokeOpacity={0.7} />

      {/* Profit zone 1: entry → T1 (light green) */}
      {yT1 != null && (
        <line x1={CX} y1={yT1} x2={CX} y2={yEntry}
          stroke="#4ade80" strokeWidth={4} strokeOpacity={0.55} />
      )}

      {/* Profit zone 2: T1 → T2 (vivid green) */}
      {yT1 != null && yT2 != null && (
        <line x1={CX} y1={yT2} x2={CX} y2={yT1}
          stroke="#22c55e" strokeWidth={4} strokeOpacity={0.9} />
      )}

      {/* T2 marker */}
      {yT2 != null && (
        <g>
          <line x1={CX - 8} y1={yT2} x2={CX + 8} y2={yT2} stroke="#22c55e" strokeWidth={1.5} />
          <circle cx={CX} cy={yT2} r={4.5} fill="#22c55e" />
        </g>
      )}

      {/* T1 marker */}
      {yT1 != null && (
        <g>
          <line x1={CX - 8} y1={yT1} x2={CX + 8} y2={yT1} stroke="#4ade80" strokeWidth={1.5} />
          <circle cx={CX} cy={yT1} r={4.5} fill="#4ade80" />
        </g>
      )}

      {/* Entry marker */}
      <g>
        <line x1={CX - 8} y1={yEntry} x2={CX + 8} y2={yEntry} stroke="#94a3b8" strokeWidth={1.5} />
        <circle cx={CX} cy={yEntry} r={4.5} fill="#94a3b8" />
      </g>

      {/* SL marker */}
      <g>
        <line x1={CX - 8} y1={ySl} x2={CX + 8} y2={ySl} stroke="#ef4444" strokeWidth={1.5} />
        <circle cx={CX} cy={ySl} r={4.5} fill="#ef4444" />
      </g>

      {/* Current price — white dashed line, drawn on top of everything */}
      {yCur != null && (
        <g>
          <line x1={3} y1={yCur} x2={W - 3} y2={yCur}
            stroke="white" strokeWidth={1.5} strokeDasharray="3 2" opacity={0.9} />
          <circle cx={CX} cy={yCur} r={3} fill="white" opacity={0.95} />
        </g>
      )}
    </svg>
  );
};

/* ── Level row ──────────────────────────────────────────────────────────────── */
const LevelRow = ({ label, priceFmt, pctVal, color = 'text-slate-100', dotClass }) => {
  const pc = pctVal;
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-700/40 last:border-0">
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotClass}`} />
      <span className="text-xs text-slate-500 w-[72px] flex-shrink-0">{label}</span>
      <span className={`font-mono text-sm font-semibold tabular-nums flex-1 ${color}`}>
        {priceFmt ?? '—'}
      </span>
      {pc != null && (
        <span className={`text-xs font-mono tabular-nums ${pctColor(pc)}`}>
          {sign(pc)}{pc.toFixed(1)}%
        </span>
      )}
    </div>
  );
};

/* ── Collapsible accordion ──────────────────────────────────────────────────── */
const Accordion = ({ title, badge, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-slate-300 truncate">{title}</h3>
          {badge}
        </div>
        <svg
          className={`w-4 h-4 text-slate-500 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="mt-4 pt-4 border-t border-slate-700/50">
          {children}
        </div>
      )}
    </div>
  );
};

/* ── Gate item ──────────────────────────────────────────────────────────────── */
const HARD_BLOCK = new Set(['gate1', 'gate2', 'gate3', 'gate6', 'gate7', 'gate8']);

const GateItem = ({ gateKey, passed, reason }) => (
  <div
    className="flex items-start gap-2 py-2 border-b border-slate-700/30 last:border-0 text-xs"
    title={GATE_DESCRIPTIONS[gateKey]}
  >
    <span className={`mt-0.5 font-bold flex-shrink-0 ${passed ? 'text-bull' : 'text-bear'}`}>
      {passed ? '✓' : '✗'}
    </span>
    <span className="text-slate-500 font-mono text-[10px] flex-shrink-0 pt-0.5">
      {gateKey.replace('gate', 'G')}
    </span>
    <span className={`flex-1 leading-snug ${passed ? 'text-slate-300' : 'text-slate-400'}`}>
      {GATE_NAMES[gateKey]}
    </span>
    <div className="flex items-center gap-1.5 flex-shrink-0">
      {HARD_BLOCK.has(gateKey) && !passed && (
        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-bear/20 text-bear uppercase tracking-wide">
          block
        </span>
      )}
      {!passed && reason && (
        <span className="text-slate-500 text-right max-w-[120px]">{reason}</span>
      )}
    </div>
  </div>
);

/* ── Main page ──────────────────────────────────────────────────────────────── */
const StockDetail = () => {
  const { symbol }   = useParams();
  const navigate     = useNavigate();
  const sym          = (symbol ?? '').toUpperCase();

  const [detail,   setDetail]   = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [showLog,  setShowLog]  = useState(false);
  const [chartInterval, setChartInterval] = useState('1d');
  const period  = chartInterval === '1d' ? '1y' : '60d';
  const { candles, loading: chartLoading } = useCandleData(sym, period, chartInterval);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await stockApi.getDetail(sym);
      setDetail(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [sym]);

  useEffect(() => { load(); }, [load]);

  const signal      = detail?.signal ?? null;
  const ind         = detail?.indicators ?? {};
  const dayUp       = (detail?.dayChangePct ?? 0) >= 0;
  const earningsDays = daysFromTs(detail?.earningsTimestamp);
  const current     = detail?.currentPrice ?? null;

  // Claude first, Python fallback
  const hasSignal   = !!signal;
  const entryLow    = signal?.entryZone?.low  ?? detail?.suggestedEntry ?? null;
  const entryHigh   = signal?.entryZone?.high ?? detail?.suggestedEntry ?? null;
  const sl          = signal?.stopLoss        ?? detail?.suggestedStopLoss ?? null;
  const t1          = signal?.target1         ?? detail?.suggestedTarget1 ?? null;
  const t2          = signal?.target2         ?? detail?.suggestedTarget2 ?? null;
  const rr          = signal?.riskReward ?? null;
  const gatesPassed = signal?.gatesPassed ?? 0;

  // Format the entry zone: range if low ≠ high, single price otherwise
  const entryFmt = entryLow != null && entryHigh != null && Math.abs(entryHigh - entryLow) > 0.5
    ? `${formatCurrency(entryLow, 0)} – ${formatCurrency(entryHigh, 0)}`
    : formatCurrency(entryLow ?? entryHigh, 0);

  // Prefill for LogTradeModal
  const prefill = {
    symbol: sym,
    entryZone: { low: entryLow },
    stopLoss: sl,
    target1: t1,
    target2: t2,
    shares: signal?.shares,
  };

  const hasLevels = entryLow != null || sl != null;

  return (
    <div className="min-h-screen bg-surface p-4 sm:p-6 space-y-5 max-w-[1600px] mx-auto">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <div className="flex items-center gap-2">
          <button onClick={load} className="btn-ghost text-sm">Refresh</button>
          <Link to={`/analysis/${sym}`} className="btn-primary text-sm">📊 Analyze</Link>
        </div>
      </div>

      {error && (
        <div className="card border-bear/30 bg-bear/10 text-bear text-sm">
          Couldn&rsquo;t load {sym}: {error}
        </div>
      )}

      {/* ── 1. Symbol header ─────────────────────────────────────────────── */}
      <div className="card">
        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-7 w-40 bg-slate-700/60 rounded" />
            <div className="h-4 w-64 bg-slate-700/60 rounded" />
            <div className="h-3 w-full bg-slate-700/60 rounded mt-4" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              {/* Left: symbol + badges */}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold font-mono text-slate-100 tracking-tight">{sym}</h1>
                  {detail?.weeklyTrend && (
                    <span className={`chip bg-surface-elevated/60 text-xs ${TREND_STYLES[detail.weeklyTrend] ?? 'text-slate-400'}`}>
                      {detail.weeklyTrend} weekly
                    </span>
                  )}
                  {signal && (
                    <span className={`badge-${signal.verdict?.toLowerCase()}`}>
                      {signal.verdict}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 mt-1">
                  {detail?.companyName ?? '—'}
                  {detail?.sector && <span className="text-slate-600"> · {detail.sector}</span>}
                </p>
              </div>

              {/* Right: live price */}
              <div className="text-right">
                <p className="text-3xl font-mono font-bold text-slate-100 tabular-nums">
                  {formatCurrency(current)}
                </p>
                {detail?.dayChangePct != null && (
                  <p className={`text-sm font-mono mt-0.5 ${dayUp ? 'text-bull' : 'text-bear'}`}>
                    {dayUp ? '▲' : '▼'} {formatPercent(Math.abs(detail.dayChangePct))} today
                  </p>
                )}
              </div>
            </div>

            {/* Fundamentals strip */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-y-4 gap-x-3 mt-5 pt-4 border-t border-slate-700/60">
              <Metric label="P/E (TTM)"   value={fmt(detail?.peRatio, 1)} />
              <Metric label="Fwd P/E"     value={fmt(detail?.forwardPe, 1)} />
              <Metric label="Market Cap"  value={detail?.marketCap ? `₹${formatIndianNumber(detail.marketCap)}` : '—'} />
              <Metric label="Beta"        value={fmt(detail?.beta, 2)} />
              <Metric
                label="52W Range"
                value={detail?.low52w && detail?.high52w
                  ? `${formatCurrency(detail.low52w, 0)}–${formatCurrency(detail.high52w, 0)}`
                  : '—'}
              />
              <Metric
                label="Earnings"
                value={earningsDays != null ? (earningsDays >= 0 ? `${earningsDays}d` : 'Passed') : '—'}
                color={earningsDays != null && earningsDays >= 0 && earningsDays <= 15 ? 'text-wait' : 'text-slate-100'}
                sub={earningsDays != null && earningsDays >= 0 && earningsDays <= 15 ? 'within buffer' : undefined}
              />
            </div>
          </>
        )}
      </div>

      {/* ── 2. Trade Setup hero ───────────────────────────────────────────── */}
      <div className="card">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-300">Trade Setup</h3>
            {!hasLevels && !loading && (
              <span className="text-[10px] text-slate-500 bg-slate-700/50 px-2 py-0.5 rounded">
                No levels yet
              </span>
            )}
          </div>
          <button
            onClick={() => setShowLog(true)}
            className="btn-success text-sm py-1"
          >
            + Log Trade
          </button>
        </div>

        {loading ? (
          <div className="animate-pulse space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 bg-slate-700/50 rounded" />
            ))}
          </div>
        ) : hasLevels ? (
          <div className="flex gap-4 sm:gap-6">
            {/* Visual price ruler */}
            <PriceRuler
              current={current}
              entryLow={entryLow}
              entryHigh={entryHigh}
              sl={sl}
              t1={t1}
              t2={t2}
            />

            {/* Level rows + metadata */}
            <div className="flex-1 min-w-0">
              {/* Current price row */}
              {current != null && (
                <div className="flex items-center gap-3 py-2.5 border-b border-slate-700/40">
                  <span className="w-2.5 h-2.5 rounded-full bg-white flex-shrink-0" />
                  <span className="text-xs text-slate-500 w-[72px] flex-shrink-0">Current</span>
                  <span className="font-mono text-sm font-semibold tabular-nums text-slate-100 flex-1">
                    {formatCurrency(current, 0)}
                  </span>
                  <span className={`text-xs font-mono ${dayUp ? 'text-bull' : 'text-bear'}`}>
                    {dayUp ? '▲' : '▼'} {formatPercent(Math.abs(detail?.dayChangePct ?? 0))}
                  </span>
                </div>
              )}

              <LevelRow
                label="Entry"
                priceFmt={entryFmt}
                pctVal={pct(entryLow, current)}
                color="text-slate-100"
                dotClass="bg-slate-400"
              />
              <LevelRow
                label="Stop Loss"
                priceFmt={formatCurrency(sl, 0)}
                pctVal={pct(sl, current)}
                color="text-bear"
                dotClass="bg-bear"
              />
              <LevelRow
                label="Target 1"
                priceFmt={formatCurrency(t1, 0)}
                pctVal={pct(t1, current)}
                color="text-bull"
                dotClass="bg-emerald-400"
              />
              <LevelRow
                label="Target 2"
                priceFmt={formatCurrency(t2, 0)}
                pctVal={pct(t2, current)}
                color="text-bull"
                dotClass="bg-bull"
              />

              {/* Metadata grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-3 pt-3 mt-1 border-t border-slate-700/50">
                <Metric
                  label="R:R"
                  value={rr != null ? `${rr.toFixed(1)} : 1` : '—'}
                  color={rr != null && rr >= 2 ? 'text-bull' : 'text-wait'}
                />
                <Metric
                  label="Confidence"
                  value={signal?.confidence ?? '—'}
                  color={
                    signal?.confidence === 'HIGH' ? 'text-bull' :
                    signal?.confidence === 'MEDIUM' ? 'text-wait' : 'text-bear'
                  }
                />
                <Metric
                  label="Shares"
                  value={signal?.shares ?? '—'}
                />
                <Metric
                  label="Max loss"
                  value={signal?.maxLoss != null ? formatCurrency(signal.maxLoss, 0) : '—'}
                  color="text-bear"
                />
              </div>

              {/* Source label */}
              <p className="text-[10px] text-slate-600 mt-3">
                {hasSignal
                  ? `Scan signal · ${signal.gatesPassed ?? 0}/8 gates passed · ${
                      signal.createdAt
                        ? new Date(signal.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                        : ''
                    }`
                  : 'Python suggested levels — no scan signal on record for this stock'}
              </p>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center">
            <p className="text-slate-500 text-sm">No levels available yet.</p>
            <p className="text-slate-600 text-xs mt-1">
              Run a scan or click Analyze to generate entry / SL / target levels for {sym}.
            </p>
          </div>
        )}
      </div>

      {/* ── 3. Candlestick chart ─────────────────────────────────────────── */}
      <CandlestickChart
        symbol={sym}
        candles={candles}
        loading={chartLoading}
        height={340}
        supportLevels={detail?.supportLevels}
        resistanceLevels={detail?.resistanceLevels}
        signal={signal}
        interval={chartInterval}
        onIntervalChange={setChartInterval}
      />

      {/* ── 4. Technical indicators ──────────────────────────────────────── */}
      <Section title="Technical indicators">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3 mb-4">
          <MeterBar
            label="RSI (14)"
            value={ind.rsi14}
            valueText={fmt(ind.rsi14, 1)}
            min={0} max={100} band={[40, 65]}
            tone={ind.rsi14 == null ? 'neutral' : ind.rsi14 > 65 ? 'bad' : ind.rsi14 < 40 ? 'warn' : 'good'}
          />
          <MeterBar
            label="Bollinger %B"
            value={ind.bbPctB}
            valueText={fmt(ind.bbPctB, 2)}
            min={0} max={1} band={[0.2, 0.8]}
            tone={ind.bbPctB == null ? 'neutral' : ind.bbPctB > 0.85 ? 'bad' : ind.bbPctB < 0.2 ? 'warn' : 'good'}
          />
          <MeterBar
            label="Volume ratio"
            value={ind.volRatio}
            valueText={fmt(ind.volRatio, 2) + '×'}
            min={0} max={3} band={[1.5, 3]}
            tone={(ind.volRatio ?? 0) >= 1.5 ? 'good' : (ind.volRatio ?? 0) >= 1 ? 'neutral' : 'warn'}
          />
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 gap-y-4 gap-x-3 border-t border-slate-700/50 pt-4">
          <Metric label="MACD"        value={fmt(ind.macd)} />
          <Metric label="MACD signal" value={fmt(ind.macdSignal)} />
          <Metric label="MACD hist"   value={fmt(ind.macdHist)}
            color={(ind.macdHist ?? 0) >= 0 ? 'text-bull' : 'text-bear'} />
          <Metric label="EMA 20"      value={formatCurrency(ind.ema20, 0)} />
          <Metric label="EMA 50"      value={formatCurrency(ind.ema50, 0)} />
          <Metric label="EMA 200"     value={formatCurrency(ind.ema200, 0)} />
          <Metric label="ATR (14)"    value={fmt(ind.atr14)} />
          {ind.candlePattern && <Metric label="Candle" value={ind.candlePattern} />}
        </div>
      </Section>

      {/* ── 5. S/R + Fibonacci ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Section title="Support / Resistance">
          {detail?.resistanceLevels?.length || detail?.supportLevels?.length ? (
            <div className="space-y-1.5 text-sm">
              {(detail.resistanceLevels ?? []).slice(0, 3).map((r, i) => (
                <div key={`r${i}`} className="flex justify-between">
                  <span className="text-bear">R{i + 1}
                    <span className="text-slate-500 ml-1 text-xs">({r.strength})</span>
                  </span>
                  <span className="font-mono tabular-nums">{formatCurrency(r.price, 0)}</span>
                </div>
              ))}
              {(detail.supportLevels ?? []).slice(0, 3).map((s, i) => (
                <div key={`s${i}`} className="flex justify-between">
                  <span className="text-bull">S{i + 1}
                    <span className="text-slate-500 ml-1 text-xs">({s.strength})</span>
                  </span>
                  <span className="font-mono tabular-nums">{formatCurrency(s.price, 0)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 text-xs">No levels detected.</p>
          )}
        </Section>

        <Section title="Fibonacci retracement">
          {detail?.fibonacci ? (
            <div className="space-y-1.5 text-sm">
              {[
                ['23.6%', detail.fibonacci.fib236],
                ['38.2%', detail.fibonacci.fib382],
                ['50.0%', detail.fibonacci.fib50],
                ['61.8%', detail.fibonacci.fib618],
                ['78.6%', detail.fibonacci.fib786],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-slate-400">{label}</span>
                  <span className="font-mono tabular-nums">{formatCurrency(val, 0)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 text-xs">No Fibonacci levels available.</p>
          )}
        </Section>
      </div>

      {/* ── 6. Gate breakdown (collapsible) ─────────────────────────────── */}
      {signal && (
        <Accordion
          title="Gate breakdown"
          badge={
            <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${
              gatesPassed >= 7
                ? 'bg-bull/15 text-bull'
                : gatesPassed >= 5
                ? 'bg-wait/15 text-wait'
                : 'bg-bear/15 text-bear'
            }`}>
              {gatesPassed}/8 passed
            </span>
          }
        >
          <div>
            {Object.entries(GATE_NAMES).map(([key, _]) => {
              const g = signal.gateDetails?.[key];
              return (
                <GateItem
                  key={key}
                  gateKey={key}
                  passed={g?.passed ?? false}
                  reason={g?.reason}
                />
              );
            })}
          </div>
        </Accordion>
      )}

      {/* ── 7. Signal reasoning + key risks (collapsible) ───────────────── */}
      {signal?.reasoning && (
        <Accordion title="Signal reasoning">
          <div className="space-y-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Analysis</p>
              <p className="text-sm text-slate-300 leading-relaxed">{signal.reasoning}</p>
            </div>

            {signal.entryTrigger && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Entry trigger</p>
                <p className="text-sm text-slate-300 leading-relaxed">{signal.entryTrigger}</p>
              </div>
            )}

            {Array.isArray(signal.keyRisks) && signal.keyRisks.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Key risks</p>
                <ul className="space-y-1.5">
                  {signal.keyRisks.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-400">
                      <span className="text-bear mt-0.5 flex-shrink-0">▸</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {signal.simonOverride && (
              <div className="border border-accent/30 bg-accent/5 rounded-lg p-3">
                <p className="text-[11px] uppercase tracking-wide text-accent mb-1">✨ Simons override</p>
                <p className="text-sm text-slate-300 leading-relaxed">{signal.simonOverride.reason}</p>
              </div>
            )}
          </div>
        </Accordion>
      )}

      {/* ── 8. Simons composite score (collapsible) ──────────────────────── */}
      {signal?.simonsScore != null && (
        <Accordion
          title="Simons composite score"
          badge={
            <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${
              signal.simonsScore >= 75 ? 'bg-bull/15 text-bull' :
              signal.simonsScore >= 55 ? 'bg-wait/15 text-wait' : 'bg-bear/15 text-bear'
            }`}>
              {Math.round(signal.simonsScore)}/100
            </span>
          }
        >
          <div className="space-y-3">
            {/* Score bar */}
            <div className="w-full h-2 bg-slate-700/50 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  signal.simonsScore >= 75 ? 'bg-bull' :
                  signal.simonsScore >= 55 ? 'bg-wait' : 'bg-bear'
                }`}
                style={{ width: `${Math.min(signal.simonsScore, 100)}%` }}
              />
            </div>

            {Array.isArray(signal.simonsBreakdown) && signal.simonsBreakdown.length > 0 && (
              <div className="space-y-1 pt-1">
                {signal.simonsBreakdown.map((sb, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="text-slate-400">{sb.label}</span>
                    <span className={`font-mono ${sb.points > 0 ? 'text-bull' : sb.points < 0 ? 'text-bear' : 'text-slate-500'}`}>
                      {sb.points > 0 ? '+' : ''}{sb.points}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Accordion>
      )}

      {/* ── 9. News ──────────────────────────────────────────────────────── */}
      <NewsWidget symbol={sym} />

      {/* ── Log Trade modal ──────────────────────────────────────────────── */}
      {showLog && (
        <LogTradeModal
          prefill={prefill}
          onClose={() => setShowLog(false)}
          onSuccess={() => setShowLog(false)}
        />
      )}
    </div>
  );
};

export default StockDetail;
