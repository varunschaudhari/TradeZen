/**
 * @file StockDetail.jsx
 * @description Dedicated stock detail page (/stock/:symbol) — live price, fundamentals
 *   (P/E, market cap, sector, 52w range), candlestick chart, technical indicators,
 *   support/resistance + Fibonacci, the latest signal + gate breakdown, and news.
 * @author SwingTrader AI Team
 * @created 2026-06-23
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

/* ── Small presentational helpers ─────────────────────────────────────────── */
const Metric = ({ label, value, color = 'text-slate-100', sub }) => (
  <div className="flex flex-col">
    <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
    <span className={`font-mono text-sm font-semibold tabular-nums ${color}`}>{value ?? '—'}</span>
    {sub && <span className="text-[10px] text-slate-500">{sub}</span>}
  </div>
);

const Section = ({ title, action, children }) => (
  <div className="card">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-slate-300">{title}</h3>
      {action}
    </div>
    {children}
  </div>
);

const TREND_STYLES = {
  BULLISH: 'text-bull',
  BEARISH: 'text-bear',
  SIDEWAYS: 'text-slate-400',
};

const fmt = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d));

const daysFromTimestamp = (ts) => {
  if (!ts) return null;
  const ms = ts * 1000 - Date.now();
  return Math.round(ms / (1000 * 60 * 60 * 24));
};

const StockDetail = () => {
  const { symbol } = useParams();
  const navigate = useNavigate();
  const sym = (symbol ?? '').toUpperCase();

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const [interval, setInterval] = useState('1d'); // daily is the swing-relevant default
  const period = interval === '1d' ? '1y' : '60d';
  const { candles, loading: chartLoading } = useCandleData(sym, period, interval);

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

  const ind = detail?.indicators ?? {};
  const signal = detail?.signal ?? null;
  const dayUp = (detail?.dayChangePct ?? 0) >= 0;
  const earningsDays = daysFromTimestamp(detail?.earningsTimestamp);

  /* Prefill for the Log Trade modal — prefer the signal, fall back to suggested levels */
  const prefill = {
    symbol: sym,
    entryZone: { low: signal?.entryZone?.low ?? detail?.suggestedEntry },
    stopLoss: signal?.stopLoss ?? detail?.suggestedStopLoss,
    target1: signal?.target1 ?? detail?.suggestedTarget1,
    target2: signal?.target2 ?? detail?.suggestedTarget2,
    shares: signal?.shares,
  };

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
          <button onClick={() => setShowLog(true)} className="btn-success text-sm">+ Log Trade</button>
        </div>
      </div>

      {error && (
        <div className="card border-bear/30 bg-bear/10 text-bear text-sm">
          Couldn&rsquo;t load {sym}: {error}
        </div>
      )}

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="card">
        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-7 w-40 bg-slate-700/60 rounded" />
            <div className="h-4 w-64 bg-slate-700/60 rounded" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold font-mono text-slate-100 tracking-tight">{sym}</h1>
                  {detail?.weeklyTrend && (
                    <span className={`chip bg-surface-elevated/60 ${TREND_STYLES[detail.weeklyTrend] ?? 'text-slate-400'}`}>
                      {detail.weeklyTrend} weekly
                    </span>
                  )}
                  {signal && <span className={`badge-${signal.verdict?.toLowerCase()}`}>{signal.verdict}</span>}
                </div>
                <p className="text-sm text-slate-500 mt-1">
                  {detail?.companyName ?? '—'}
                  {detail?.sector && <span className="text-slate-600"> · {detail.sector}</span>}
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-mono font-bold text-slate-100 tabular-nums">
                  {formatCurrency(detail?.currentPrice)}
                </p>
                {detail?.dayChangePct != null && (
                  <p className={`text-sm font-mono ${dayUp ? 'text-bull' : 'text-bear'}`}>
                    {dayUp ? '▲' : '▼'} {formatPercent(detail.dayChangePct)} today
                  </p>
                )}
              </div>
            </div>

            {/* Fundamentals strip */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-y-4 gap-x-3 mt-5 pt-4 border-t border-slate-700/60">
              <Metric label="P/E (TTM)" value={fmt(detail?.peRatio, 1)} />
              <Metric label="Fwd P/E" value={fmt(detail?.forwardPe, 1)} />
              <Metric label="Market Cap" value={detail?.marketCap ? `₹${formatIndianNumber(detail.marketCap)}` : '—'} />
              <Metric label="Beta" value={fmt(detail?.beta, 2)} />
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

      {/* ── Main grid ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Left: chart + indicators (2 cols) */}
        <div className="xl:col-span-2 space-y-5">
          <CandlestickChart
            symbol={sym}
            candles={candles}
            loading={chartLoading}
            height={340}
            supportLevels={detail?.supportLevels}
            resistanceLevels={detail?.resistanceLevels}
            signal={signal}
            interval={interval}
            onIntervalChange={setInterval}
          />

          <Section title="Technical indicators">
            {/* Visual gauges for the signals a trader reads first */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3 mb-4">
              <MeterBar
                label="RSI (14)"
                value={ind.rsi14}
                valueText={fmt(ind.rsi14, 1)}
                min={0}
                max={100}
                band={[40, 65]}
                tone={ind.rsi14 == null ? 'neutral' : ind.rsi14 > 65 ? 'bad' : ind.rsi14 < 40 ? 'warn' : 'good'}
              />
              <MeterBar
                label="Bollinger %B"
                value={ind.bbPctB}
                valueText={fmt(ind.bbPctB, 2)}
                min={0}
                max={1}
                band={[0.2, 0.8]}
                tone={ind.bbPctB == null ? 'neutral' : ind.bbPctB > 0.85 ? 'bad' : ind.bbPctB < 0.2 ? 'warn' : 'good'}
              />
              <MeterBar
                label="Volume ratio"
                value={ind.volRatio}
                valueText={fmt(ind.volRatio, 2) + '×'}
                min={0}
                max={3}
                band={[1.5, 3]}
                tone={(ind.volRatio ?? 0) >= 1.5 ? 'good' : (ind.volRatio ?? 0) >= 1 ? 'neutral' : 'warn'}
              />
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-y-4 gap-x-3 border-t border-slate-700/50 pt-4">
              <Metric label="MACD" value={fmt(ind.macd)} />
              <Metric label="MACD signal" value={fmt(ind.macdSignal)} />
              <Metric label="MACD hist" value={fmt(ind.macdHist)}
                color={(ind.macdHist ?? 0) >= 0 ? 'text-bull' : 'text-bear'} />
              <Metric label="EMA 20" value={formatCurrency(ind.ema20, 0)} />
              <Metric label="EMA 50" value={formatCurrency(ind.ema50, 0)} />
              <Metric label="EMA 200" value={formatCurrency(ind.ema200, 0)} />
              <Metric label="ATR (14)" value={fmt(ind.atr14)} />
              {ind.candlePattern && <Metric label="Candle" value={ind.candlePattern} />}
            </div>
          </Section>

          {/* Support / Resistance + Fibonacci */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Section title="Support / Resistance">
              <div className="space-y-1.5 text-sm">
                {(detail?.resistanceLevels ?? []).slice(0, 3).map((r, i) => (
                  <div key={`r${i}`} className="flex justify-between">
                    <span className="text-bear">R{i + 1} <span className="text-slate-500">({r.strength})</span></span>
                    <span className="font-mono">{formatCurrency(r.price, 0)}</span>
                  </div>
                ))}
                {(detail?.supportLevels ?? []).slice(0, 3).map((s, i) => (
                  <div key={`s${i}`} className="flex justify-between">
                    <span className="text-bull">S{i + 1} <span className="text-slate-500">({s.strength})</span></span>
                    <span className="font-mono">{formatCurrency(s.price, 0)}</span>
                  </div>
                ))}
                {!detail?.supportLevels?.length && !detail?.resistanceLevels?.length && (
                  <p className="text-slate-500 text-xs">No levels detected.</p>
                )}
              </div>
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
                      <span className="font-mono">{formatCurrency(val, 0)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-500 text-xs">No Fibonacci levels available.</p>
              )}
            </Section>
          </div>
        </div>

        {/* Right: signal + Simons + news */}
        <div className="space-y-5">
          {/* Simons score section (from latest signal) */}
          {signal?.simonsScore != null && (
            <Section title="Simons composite score">
              <div className="space-y-3">
                <div className="flex items-end justify-between">
                  <span className="text-3xl font-mono font-bold text-accent">
                    {Math.round(signal.simonsScore)}
                  </span>
                  <span className="text-xs text-slate-500">out of 100</span>
                </div>
                {Array.isArray(signal.simonsBreakdown) && signal.simonsBreakdown.length > 0 && (
                  <div className="border-t border-slate-700/60 pt-2 space-y-1">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Contributions</p>
                    <div className="space-y-1 text-xs">
                      {signal.simonsBreakdown.map((sb, i) => (
                        <div key={i} className="flex justify-between">
                          <span className="text-slate-400">{sb.label}</span>
                          <span className={`font-mono ${sb.points > 0 ? 'text-bull' : 'text-bear'}`}>
                            {sb.points > 0 ? '+' : ''}{sb.points}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Section>
          )}

          {signal ? (
            <Section title="Latest signal">
              {signal.verdict === 'BUY' && (
                <div className="grid grid-cols-2 gap-y-3 gap-x-2 mb-3 rounded-lg bg-surface-base/40 border border-slate-700/50 p-3">
                  <Metric label="Entry" value={`${formatCurrency(signal.entryZone?.low, 0)}–${formatCurrency(signal.entryZone?.high, 0)}`} />
                  <Metric label="Stop" value={formatCurrency(signal.stopLoss, 0)} color="text-bear" />
                  <Metric label="Target 1" value={formatCurrency(signal.target1, 0)} color="text-bull" />
                  <Metric label="Target 2" value={formatCurrency(signal.target2, 0)} color="text-bull" />
                  <Metric label="R:R" value={signal.riskReward ? `${signal.riskReward.toFixed(1)}:1` : '—'} color="text-accent-light" />
                  <Metric label="Confidence" value={signal.confidence ?? '—'} />
                </div>
              )}

              {/* Gate breakdown */}
              <div className="space-y-1 mb-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                  Gates {signal.gatesPassed ?? 0}/8
                </p>
                {Object.entries(GATE_NAMES).map(([key, name]) => {
                  const g = signal.gateDetails?.[key];
                  const passed = g?.passed ?? false;
                  return (
                    <div key={key} className="flex items-start gap-2 text-xs" title={g?.reason || GATE_DESCRIPTIONS[key]}>
                      <span className={passed ? 'text-bull' : 'text-bear'}>{passed ? '✓' : '✗'}</span>
                      <span className={`${passed ? 'text-slate-300' : 'text-slate-500'} cursor-help decoration-dotted underline-offset-2 hover:underline`}>
                        {name}
                      </span>
                      {!passed && g?.reason && <span className="text-slate-500 ml-auto text-right">{g.reason}</span>}
                    </div>
                  );
                })}
              </div>

              {signal.simonOverride && (
                <div className="border-t border-accent/30 bg-accent/5 pt-2 -mx-3 px-3 py-2 mt-2 rounded">
                  <p className="text-[11px] uppercase tracking-wide text-accent mb-1">✨ Simons override</p>
                  <p className="text-xs text-slate-300 leading-relaxed">{signal.simonOverride.reason}</p>
                </div>
              )}

              {/* Python suggested vs Claude chosen comparison */}
              {!signal.entryZone && detail?.suggestedEntry && (
                <div className="border-t border-slate-700/60 pt-2 mt-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Python suggested levels</p>
                  <div className="grid grid-cols-2 gap-y-1.5 gap-x-2 text-xs">
                    <div className="flex justify-between"><span className="text-slate-400">Entry</span> <span className="font-mono text-slate-300">{formatCurrency(detail.suggestedEntry, 0)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-400">Stop</span> <span className="font-mono text-bear">{formatCurrency(detail.suggestedStopLoss, 0)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-400">T1</span> <span className="font-mono text-bull">{formatCurrency(detail.suggestedTarget1, 0)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-400">T2</span> <span className="font-mono text-bull">{formatCurrency(detail.suggestedTarget2, 0)}</span></div>
                  </div>
                </div>
              )}

              {signal.reasoning && (
                <div className="border-t border-slate-700/60 pt-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Claude&rsquo;s reasoning</p>
                  <p className="text-xs text-slate-300 leading-relaxed">{signal.reasoning}</p>
                </div>
              )}

              {Array.isArray(signal.keyRisks) && signal.keyRisks.length > 0 && (
                <div className="border-t border-slate-700/60 pt-2 mt-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Key risks</p>
                  <ul className="text-xs text-slate-400 space-y-1 list-disc list-inside">
                    {signal.keyRisks.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
            </Section>
          ) : (
            !loading && (
              <Section title="Latest signal">
                <p className="text-slate-500 text-sm">
                  No signal on record for {sym}. The scanner only saves signals that clear the gates and Claude.
                </p>
                <p className="text-slate-500 text-xs mt-2">
                  Suggested levels (analysis): entry {formatCurrency(detail?.suggestedEntry, 0)} ·
                  stop {formatCurrency(detail?.suggestedStopLoss, 0)} ·
                  T1 {formatCurrency(detail?.suggestedTarget1, 0)}
                </p>
              </Section>
            )
          )}

          <NewsWidget symbol={sym} />
        </div>
      </div>

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
