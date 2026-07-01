/**
 * @file GateAnalytics.jsx
 * @description Gate failure analytics — which of the 8 safety gates are blocking
 * the most setups, why, and whether the rate is worsening week-over-week.
 *
 * Data: aggregated from existing Signal.gateDetails documents — no new data needed.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { gatesApi } from '../services/api.js';
import Spinner from '../components/Spinner.jsx';

/* ── Gate metadata (static, from CLAUDE.md) ─────────────────────────── */

const GATE_META = {
  gate1: {
    num: 1, label: 'Nifty 50 above 20-day EMA', type: 'HARD_BLOCK',
    insight: (rate) => rate > 50
      ? 'Broad market in downtrend — entire watchlist suppressed by this gate'
      : rate > 30
      ? 'Market under pressure — Nifty below EMA on many scan days'
      : null,
  },
  gate2: {
    num: 2, label: 'Stock above weekly 50 EMA', type: 'HARD_BLOCK',
    insight: (rate) => rate > 60
      ? 'Most watchlist stocks are in weekly downtrends — add momentum leaders'
      : null,
  },
  gate3: {
    num: 3, label: 'No earnings within 15 days', type: 'HARD_BLOCK',
    insight: (rate) => rate > 30
      ? 'Earnings season in progress — many setups blocked by event risk'
      : null,
  },
  gate4: {
    num: 4, label: 'RSI between 40–65', type: 'STRONG_FILTER',
    insight: (rate) => rate > 50
      ? 'Watchlist skews overbought or weak — add stocks in the RSI sweet spot'
      : null,
  },
  gate5: {
    num: 5, label: 'Volume ≥ 1.5× 20-day average', type: 'STRONG_FILTER',
    insight: (rate) => rate > 50
      ? 'Low institutional participation — market lacks conviction'
      : null,
  },
  gate6: {
    num: 6, label: 'Risk:Reward ≥ 2:1', type: 'HARD_BLOCK',
    insight: (rate) => rate > 40
      ? 'Setup geometry poor — tight targets or wide stops making RR fail'
      : null,
  },
  gate7: {
    num: 7, label: 'Claude confidence = HIGH', type: 'HARD_BLOCK',
    insight: (rate) => rate > 60
      ? 'Claude is cautious — setups reaching this gate often lack enough signal quality'
      : null,
  },
  gate8: {
    num: 8, label: 'News sentiment not NEGATIVE', type: 'HARD_BLOCK',
    insight: (rate) => rate > 30
      ? 'Adverse news environment — macro/company news suppressing setups'
      : null,
  },
};

const PERIODS = [
  { label: '7d',  days: 7  },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

/* ── Helpers ─────────────────────────────────────────────────────────── */

const pct = (n) => (n == null ? '—' : `${n}%`);

const fmtDelta = (d) => {
  if (d == null) return null;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d}%`;
};

function failRateColor(rate) {
  if (rate >= 70) return 'text-red-400';
  if (rate >= 40) return 'text-amber-400';
  if (rate >= 20) return 'text-slate-300';
  return 'text-emerald-400';
}

function failBarColor(rate) {
  if (rate >= 70) return 'bg-red-500';
  if (rate >= 40) return 'bg-amber-500';
  if (rate >= 20) return 'bg-slate-400';
  return 'bg-emerald-500';
}

function trendChip(direction, delta) {
  if (direction === 'WORSE')  return { cls: 'bg-red-500/15 text-red-400',     icon: '↑', label: fmtDelta(delta) };
  if (direction === 'BETTER') return { cls: 'bg-emerald-500/15 text-emerald-400', icon: '↓', label: fmtDelta(delta) };
  return { cls: 'bg-slate-700/60 text-slate-500', icon: '→', label: 'stable' };
}

/* ── Insight banner above the table ─────────────────────────────────── */

function buildInsights(gates) {
  const insights = [];
  for (const g of gates) {
    const meta = GATE_META[g.id];
    if (!meta || !g.failRate) continue;
    const msg = meta.insight(g.failRate);
    if (msg) insights.push({ gateNum: meta.num, label: meta.label, msg, failRate: g.failRate });
  }
  return insights.sort((a, b) => b.failRate - a.failRate).slice(0, 3);
}

/* ── Main component ──────────────────────────────────────────────────── */

export default function GateAnalytics() {
  const [days,    setDays]    = useState(30);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = useCallback(async (d) => {
    setLoading(true);
    setError(null);
    try {
      const res = await gatesApi.getAnalytics(d);
      setData(res);
    } catch (err) {
      setError(err.message ?? 'Failed to load gate analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(days); }, [load, days]);

  /* ── Render ── */
  return (
    <div className="p-4 md:p-6 space-y-5 max-w-4xl mx-auto">

      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-slate-100">Gate Failure Analytics</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Which of the 8 safety gates are blocking setups — and why.
          </p>
        </div>

        {/* Period selector */}
        <div className="seg-group flex-shrink-0">
          {PERIODS.map(({ label, days: d }) => (
            <button key={d} onClick={() => setDays(d)} className={`seg ${days === d ? 'seg-active' : ''}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="card flex items-center gap-4 py-8">
          <Spinner size={22} />
          <span className="text-slate-400 text-sm">Aggregating gate data…</span>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="card border-red-500/20 bg-red-500/5 text-red-400 text-sm px-4 py-3">
          {error}
        </div>
      )}

      {data && !loading && (() => {
        const insights = buildInsights(data.gates);
        const hardBlocks = data.gates.filter((g) => GATE_META[g.id]?.type === 'HARD_BLOCK');
        const topBlocker = [...data.gates].sort((a, b) => b.failRate - a.failRate)[0];

        return (
          <>
            {/* Summary strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="card py-3 text-center">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Signals scanned</p>
                <p className="font-mono text-xl font-bold text-slate-100">{data.totalSignals.toLocaleString()}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{data.period}</p>
              </div>
              <div className="card py-3 text-center card-bull">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">BUY signals</p>
                <p className="font-mono text-xl font-bold text-emerald-400">{data.verdicts?.BUY ?? 0}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {data.totalSignals > 0
                    ? `${((data.verdicts?.BUY ?? 0) / data.totalSignals * 100).toFixed(1)}% hit rate`
                    : '—'}
                </p>
              </div>
              <div className="card py-3 text-center card-wait">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">WAIT signals</p>
                <p className="font-mono text-xl font-bold text-amber-400">{data.verdicts?.WAIT ?? 0}</p>
              </div>
              <div className="card py-3 text-center card-bear">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Top blocker</p>
                <p className="font-mono text-base font-bold text-red-400">
                  {topBlocker ? `G${GATE_META[topBlocker.id]?.num}` : '—'}
                </p>
                <p className="text-[10px] text-red-400/80 mt-0.5">
                  {topBlocker ? `${topBlocker.failRate}% fail` : '—'}
                </p>
              </div>
            </div>

            {/* Insight banners */}
            {insights.length > 0 && (
              <div className="space-y-2">
                {insights.map((ins) => (
                  <div
                    key={ins.gateNum}
                    className="flex items-start gap-3 px-4 py-3 rounded-xl border border-amber-500/20 bg-amber-500/5"
                  >
                    <span className="text-amber-400 text-base flex-shrink-0 mt-0.5">⚠</span>
                    <div>
                      <span className="text-xs font-semibold text-amber-400">G{ins.gateNum}</span>
                      <span className="text-xs text-amber-400/70 ml-2">failing {ins.failRate}%</span>
                      <p className="text-xs text-slate-300 mt-0.5">{ins.msg}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Gate table */}
            <div className="card overflow-hidden p-0">
              <div className="px-4 py-3 border-b border-slate-700/60 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-200">Gate-by-Gate Breakdown</h2>
                <p className="text-[10px] text-slate-500">↑↓ trend = vs. prior 7d</p>
              </div>

              <div className="divide-y divide-slate-700/30">
                {data.gates.map((g) => {
                  const meta = GATE_META[g.id] ?? {};
                  const trend = trendChip(g.trend?.direction, g.trend?.delta);
                  const isHard = meta.type === 'HARD_BLOCK';
                  const barWidth = `${g.failRate}%`;

                  return (
                    <div key={g.id} className="px-4 py-4 hover:bg-surface-elevated/20 transition-colors">
                      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">

                        {/* Gate number + label */}
                        <div className="flex items-center gap-2 min-w-[220px] flex-1">
                          <span className={`font-mono text-xs font-bold w-6 flex-shrink-0 ${isHard ? 'text-red-400' : 'text-amber-400'}`}>
                            G{meta.num}
                          </span>
                          <div>
                            <p className="text-sm text-slate-200 leading-tight">{meta.label}</p>
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide mt-0.5 ${
                              isHard
                                ? 'bg-red-500/15 text-red-400'
                                : 'bg-amber-500/15 text-amber-400'
                            }`}>
                              {isHard ? 'hard block' : 'filter'}
                            </span>
                          </div>
                        </div>

                        {/* Fail rate + bar */}
                        <div className="flex-1 min-w-[160px]">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className={`font-mono text-sm font-bold tabular-nums ${failRateColor(g.failRate)}`}>
                              {pct(g.failRate)} fail
                            </span>
                            <span className="text-xs text-slate-500 font-mono">
                              {g.failed.toLocaleString()} / {g.evaluated.toLocaleString()} evals
                            </span>
                          </div>
                          {/* Progress bar */}
                          <div className="h-1.5 rounded-full bg-slate-700/60 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${failBarColor(g.failRate)}`}
                              style={{ width: barWidth }}
                            />
                          </div>
                          {g.notEvaluated > 0 && (
                            <p className="text-[10px] text-slate-600 mt-0.5">
                              {g.notEvaluated.toLocaleString()} signals not evaluated (gate didn&apos;t run)
                            </p>
                          )}
                        </div>

                        {/* Trend chip */}
                        <div className="flex-shrink-0 flex flex-col items-end gap-1">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold tabular-nums ${trend.cls}`}>
                            {trend.icon} {trend.label}
                          </span>
                          {g.trend?.last7dFailRate != null && (
                            <span className="text-[9px] text-slate-600 font-mono">
                              {g.trend.last7dFailRate}% last 7d
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Top failure reasons */}
                      {g.topReasons?.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          {g.topReasons.map((r, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-elevated/60 border border-slate-700/50 text-[11px] text-slate-400"
                            >
                              <span className="text-slate-600 font-mono text-[9px]">#{i + 1}</span>
                              {r.reason}
                              <span className="text-slate-600 font-mono text-[10px]">×{r.count}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top blocked symbols */}
            {data.topSymbols?.length > 0 && (
              <div className="card space-y-3">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-sm font-semibold text-slate-200">Most Blocked Symbols</h2>
                  <span className="text-xs text-slate-500">total gate failures in period</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 stagger-grid">
                  {data.topSymbols.map((sym) => {
                    const gateEntries = Object.entries(sym.gates ?? {})
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 3);
                    return (
                      <div
                        key={sym.symbol}
                        className="flex items-start gap-3 px-3 py-2.5 rounded-lg border border-slate-700/40 hover:border-slate-600/60 hover:bg-surface-elevated/20 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-100 text-sm">{sym.symbol}</span>
                            <span className="text-[10px] text-slate-500 font-mono">{sym.failures} failures</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {gateEntries.map(([gk, cnt]) => {
                              const m = GATE_META[gk];
                              return m ? (
                                <span
                                  key={gk}
                                  className="chip bg-slate-700/50 text-slate-400 text-[9px]"
                                  title={`${m.label} · failed ${cnt}×`}
                                >
                                  G{m.num} ×{cnt}
                                </span>
                              ) : null;
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Empty data state */}
            {data.totalSignals === 0 && (
              <div className="card flex flex-col items-center justify-center py-14 text-center gap-3">
                <span className="text-4xl opacity-20">📊</span>
                <p className="text-slate-400 text-sm">No signals found in the last {data.period}</p>
                <p className="text-xs text-slate-600">
                  Gate analytics appear once the scanner has run and saved Signal documents.
                </p>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
