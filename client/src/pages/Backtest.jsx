/**
 * @file Backtest.jsx
 * @description Backtesting page — two modes:
 *   1. Setup Replay — enter a specific entry/SL/T1/T2 and see how similar
 *      historical touches played out over the past 2 years.
 *   2. Walk-Forward — run the full gate/signal engine across watchlist symbols,
 *      compare hold modes and analyse per-signal edge.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { backtestApi, signalsApi } from '../services/api.js';
import { formatCurrency } from '../utils/formatters.js';
import Spinner from '../components/Spinner.jsx';

/* ── Small helpers ────────────────────────────────────────────────────── */

const ASSESS_STYLES = {
  EXCELLENT:        { cls: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40', label: 'EXCELLENT' },
  GOOD:             { cls: 'bg-blue-500/20 text-blue-400 border border-blue-500/40',          label: 'GOOD' },
  DECENT:           { cls: 'bg-amber-500/20 text-amber-400 border border-amber-500/40',       label: 'DECENT' },
  POOR:             { cls: 'bg-red-500/20 text-red-400 border border-red-500/40',             label: 'POOR' },
  INSUFFICIENT_DATA:{ cls: 'bg-slate-700/60 text-slate-400 border border-slate-600',          label: 'INSUFFICIENT DATA' },
};

const fmtR = (r) => (r == null ? '—' : `${r >= 0 ? '+' : ''}${r}R`);
const fmtPct = (p) => (p == null ? '—' : `${p}%`);

/* ── Sub-components ───────────────────────────────────────────────────── */

const KpiCell = ({ label, value, positive, negative }) => (
  <div className="card py-3 text-center">
    <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">{label}</p>
    <p className={`font-mono text-lg font-bold tabular-nums ${
      positive ? 'text-emerald-400' : negative ? 'text-red-400' : 'text-slate-100'
    }`}>
      {value ?? '—'}
    </p>
  </div>
);

const ExitBar = ({ winsT1, winsT2, losses, timeouts }) => {
  const segments = [
    { label: 'T2', n: winsT2 ?? 0, cls: 'bg-emerald-500' },
    { label: 'T1', n: winsT1 ?? 0, cls: 'bg-blue-400' },
    { label: 'SL', n: losses  ?? 0, cls: 'bg-red-500' },
    { label: 'TO', n: timeouts ?? 0, cls: 'bg-slate-600' },
  ].filter((s) => s.n > 0);
  const total = segments.reduce((s, x) => s + x.n, 0);
  if (!total) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Exit breakdown</p>
      <div className="flex h-5 rounded-md overflow-hidden gap-px">
        {segments.map((s) => (
          <div
            key={s.label}
            className={`${s.cls} flex items-center justify-center text-[9px] font-bold text-white/80 transition-all`}
            style={{ flex: s.n }}
            title={`${s.label}: ${s.n}`}
          >
            {s.n >= 2 ? s.label : ''}
          </div>
        ))}
      </div>
      <div className="flex gap-4 mt-1.5 text-xs text-slate-400">
        {segments.map((s) => (
          <span key={s.label}><span className="font-mono">{s.n}</span> {s.label}</span>
        ))}
      </div>
    </div>
  );
};

const TradesTable = ({ trades }) => {
  if (!trades?.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs text-slate-300 min-w-[480px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-700/60">
            <th className="text-left pb-2 pr-3">#</th>
            <th className="text-left pb-2 pr-3">Entry date</th>
            <th className="text-right pb-2 pr-3">Entry ₹</th>
            <th className="text-right pb-2 pr-3">Exit ₹</th>
            <th className="text-left pb-2 pr-3">Type</th>
            <th className="text-right pb-2 pr-3">Hold</th>
            <th className="text-right pb-2">R</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/25">
          {trades.map((t) => {
            const win = (t.realizedR ?? 0) > 0;
            const exitCls =
              t.exitType === 'T2'      ? 'bg-emerald-500/20 text-emerald-400' :
              t.exitType === 'T1'      ? 'bg-blue-500/20 text-blue-400'       :
              t.exitType === 'SL'      ? 'bg-red-500/20 text-red-400'         :
              'bg-slate-700/50 text-slate-400';
            return (
              <tr key={t.sequenceNo} className="hover:bg-surface-elevated/20 transition-colors">
                <td className="py-1.5 pr-3 text-slate-500 font-mono">{t.sequenceNo}</td>
                <td className="py-1.5 pr-3 font-mono text-slate-300">
                  {t.entryDate
                    ? new Date(t.entryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
                    : '—'}
                </td>
                <td className="py-1.5 pr-3 text-right font-mono">
                  ₹{t.entryPrice?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </td>
                <td className="py-1.5 pr-3 text-right font-mono">
                  ₹{t.exitPrice?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </td>
                <td className="py-1.5 pr-3">
                  <span className={`chip ${exitCls}`}>{t.exitType}</span>
                </td>
                <td className="py-1.5 pr-3 text-right font-mono text-slate-400">{t.holdingDays}d</td>
                <td className={`py-1.5 text-right font-mono font-semibold ${win ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmtR(t.realizedR)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const SetupResults = ({ result }) => {
  const assess = ASSESS_STYLES[result.performanceAssessment] ?? ASSESS_STYLES.INSUFFICIENT_DATA;
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`px-3 py-1 rounded-lg text-sm font-bold tracking-wide ${assess.cls}`}>
          {assess.label}
        </span>
        <span className="text-slate-400 text-sm">
          {result.symbol} · {result.tradesSimulated} trades · 2y data
        </span>
        {result.cached && <span className="chip bg-slate-700/40 text-slate-500">cached</span>}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCell
          label="Win Rate"
          value={fmtPct(result.winRate)}
          positive={result.winRate >= 55}
          negative={result.winRate < 45}
        />
        <KpiCell
          label="Avg R (realized)"
          value={fmtR(result.avgRealizedRR)}
          positive={result.avgRealizedRR > 0}
          negative={result.avgRealizedRR < 0}
        />
        <KpiCell label="Avg Hold" value={`${result.avgHoldingDays}d`} />
        <KpiCell label="Max Consec. Wins" value={result.maxConsecutiveWins} />
      </div>

      {/* Exit bar */}
      <ExitBar
        winsT1={result.winsAtT1}
        winsT2={result.winsAtT2}
        losses={result.losses}
        timeouts={result.timeouts}
      />

      {/* Breakdown */}
      {result.tradesSimulated > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-slate-400">
          <div>T1 hit rate <span className="text-blue-400 font-mono ml-1">{fmtPct(result.winRateT1)}</span></div>
          <div>T2 hit rate <span className="text-emerald-400 font-mono ml-1">{fmtPct(result.winRateT2)}</span></div>
          <div>Loss rate <span className="text-red-400 font-mono ml-1">{fmtPct(result.lossRate)}</span></div>
          <div>Largest win <span className="text-emerald-400 font-mono ml-1">{fmtR(result.largestWin)}</span></div>
        </div>
      )}

      {/* Trade table */}
      {result.trades?.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Recent trades</p>
          <TradesTable trades={result.trades} />
        </div>
      )}
    </div>
  );
};

/* ── Walk-forward result panels ───────────────────────────────────────── */

const ModeTable = ({ results, modes }) => {
  if (!modes?.length) return null;
  const best = modes.reduce((b, m) => {
    const e = results[m]?.overall?.expectancy ?? -Infinity;
    return e > (results[b]?.overall?.expectancy ?? -Infinity) ? m : b;
  }, modes[0]);

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-200 mb-3">Hold Mode Comparison</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[520px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-700/60">
              <th className="text-left pb-2 pr-4">Mode</th>
              <th className="text-right pb-2 pr-4">Trades</th>
              <th className="text-right pb-2 pr-4">Win %</th>
              <th className="text-right pb-2 pr-4">Avg R (gross)</th>
              <th className="text-right pb-2 pr-4">Avg R (net)</th>
              <th className="text-right pb-2 pr-4">Avg Hold</th>
              <th className="text-right pb-2">Expectancy</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/25">
            {modes.map((m) => {
              const o = results[m]?.overall ?? {};
              const isBest = m === best;
              return (
                <tr key={m} className={`transition-colors ${isBest ? 'bg-emerald-500/5' : 'hover:bg-surface-elevated/20'}`}>
                  <td className="py-2.5 pr-4">
                    <span className="font-mono capitalize text-slate-200">{m}</span>
                    {isBest && <span className="ml-2 chip bg-emerald-500/20 text-emerald-400">best</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono text-slate-300">{o.trades ?? '—'}</td>
                  <td className={`py-2.5 pr-4 text-right font-mono ${(o.winRate ?? 0) >= 55 ? 'text-emerald-400' : 'text-slate-300'}`}>
                    {fmtPct(o.winRate)}
                  </td>
                  <td className={`py-2.5 pr-4 text-right font-mono ${(o.avgR ?? 0) >= 0 ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                    {fmtR(o.avgR)}
                  </td>
                  <td className={`py-2.5 pr-4 text-right font-mono ${(o.avgRNet ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtR(o.avgRNet)}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono text-slate-400">
                    {o.avgHold != null ? `${o.avgHold}d` : '—'}
                  </td>
                  <td className={`py-2.5 text-right font-mono font-semibold ${(o.expectancy ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtR(o.expectancy)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/** What the CURRENT live strategy (decideVerdict, score ≥ HIGH) actually would have
 * bought — vs. `overall`, which spans every gates-qualified candidate regardless of
 * score. The gap between the two, plus the BUY/WAIT/SKIP split, is the score-
 * reachability picture: how often does the composite score actually clear the HIGH bar. */
const LiveStrategyPanel = ({ results, modes }) => {
  const refMode = modes?.includes('adaptive') ? 'adaptive' : modes?.[0];
  const live = results?.[refMode]?.liveStrategy;
  const overall = results?.[refMode]?.overall;
  const byVerdict = results?.[refMode]?.byVerdict ?? {};
  const totalCandidates = (byVerdict.BUY ?? 0) + (byVerdict.WAIT ?? 0) + (byVerdict.SKIP ?? 0);
  if (!live) return null;

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-3">
        <h3 className="text-sm font-semibold text-slate-200">Live Strategy (score ≥ HIGH only)</h3>
        <span className="text-xs text-slate-500">({refMode} mode) — what today's pipeline would actually have bought</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <KpiCell label="BUY trades" value={live.trades} />
        <KpiCell label="Win %" value={fmtPct(live.winRate)} positive={live.winRate >= 55} />
        <KpiCell label="Avg R (net)" value={fmtR(live.avgRNet)} positive={live.avgRNet >= 0} negative={live.avgRNet < 0} />
        <KpiCell label="Expectancy" value={fmtR(live.expectancy)} positive={live.expectancy >= 0} negative={live.expectancy < 0} />
      </div>
      {totalCandidates > 0 && (
        <div className="text-xs text-slate-500 flex items-center gap-3 flex-wrap">
          <span>Of {totalCandidates} gate-qualified candidates:</span>
          <span className="text-emerald-400 font-mono">{byVerdict.BUY ?? 0} BUY</span>
          <span className="text-wait font-mono">{byVerdict.WAIT ?? 0} WAIT</span>
          <span className="text-slate-400 font-mono">{byVerdict.SKIP ?? 0} SKIP</span>
          {overall?.trades > 0 && (
            <span>
              — score-qualified BUYs are {Math.round(((byVerdict.BUY ?? 0) / totalCandidates) * 100)}% of candidates
              (vs. {overall.trades} simulated across every score band)
            </span>
          )}
        </div>
      )}
    </div>
  );
};

const SCORE_BUCKETS = ['<50', '50-59', '60-69', '70+'];

const BucketTable = ({ results, modes }) => {
  const refMode = modes?.includes('adaptive') ? 'adaptive' : modes?.[0];
  const buckets = results?.[refMode]?.byScoreBucket ?? {};
  const byReason = results?.[refMode]?.byExitReason ?? {};

  const best = SCORE_BUCKETS.reduce((b, k) => {
    const wr = buckets[k]?.winRate ?? 0;
    return wr > (buckets[b]?.winRate ?? 0) && (buckets[k]?.trades ?? 0) >= 5 ? k : b;
  }, null);

  return (
    <div className="space-y-5">
      {/* Score bucket table */}
      <div>
        <div className="flex items-baseline gap-2 mb-3">
          <h3 className="text-sm font-semibold text-slate-200">Score Bucket Analysis</h3>
          <span className="text-xs text-slate-500">({refMode} mode) — calibrate the BUY threshold</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[400px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-700/60">
                <th className="text-left pb-2 pr-4">Score</th>
                <th className="text-right pb-2 pr-4">Trades</th>
                <th className="text-right pb-2 pr-4">Win %</th>
                <th className="text-right pb-2 pr-4">Avg R</th>
                <th className="text-right pb-2">Expectancy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/25">
              {SCORE_BUCKETS.map((k) => {
                const b = buckets[k] ?? { trades: 0, winRate: 0, avgR: 0, expectancy: 0 };
                const isBest = k === best;
                return (
                  <tr key={k} className={`transition-colors ${isBest ? 'bg-emerald-500/5' : 'hover:bg-surface-elevated/20'}`}>
                    <td className="py-2 pr-4">
                      <span className="font-mono text-slate-200">{k}</span>
                      {isBest && <span className="ml-2 chip bg-emerald-500/20 text-emerald-400">best</span>}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono text-slate-400">{b.trades}</td>
                    <td className={`py-2 pr-4 text-right font-mono ${b.winRate >= 55 ? 'text-emerald-400' : b.winRate < 45 ? 'text-red-400' : 'text-slate-300'}`}>
                      {b.trades ? fmtPct(b.winRate) : '—'}
                    </td>
                    <td className={`py-2 pr-4 text-right font-mono ${b.avgR >= 0 ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                      {b.trades ? fmtR(b.avgR) : '—'}
                    </td>
                    <td className={`py-2 text-right font-mono font-semibold ${b.expectancy >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {b.trades ? fmtR(b.expectancy) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Exit reason breakdown */}
      {Object.keys(byReason).length > 0 && (
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Exit reasons ({refMode})</p>
          <div className="flex flex-wrap gap-3">
            {['T2', 'TRAIL', 'SL', 'TIME'].map((r) => (
              <div key={r} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${
                r === 'T2' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400' :
                r === 'TRAIL' ? 'border-blue-500/30 bg-blue-500/5 text-blue-400' :
                r === 'SL' ? 'border-red-500/30 bg-red-500/5 text-red-400' :
                'border-slate-700/60 bg-surface-elevated/30 text-slate-400'
              }`}>
                <span className="font-mono font-bold">{byReason[r] ?? 0}</span>
                <span className="text-xs">{r}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const SignalEdgeTable = ({ result }) => {
  if (!result) return null;
  const { base, signals } = result;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h3 className="text-sm font-semibold text-slate-200">Signal Edge Analysis</h3>
        <span className="text-xs text-slate-500">
          {result.trades} total trades · base win rate {fmtPct(base?.winRate)} · base avg R {fmtR(base?.avgR)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[520px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-700/60">
              <th className="text-left pb-2 pr-4">Signal flag</th>
              <th className="text-right pb-2 pr-3">n</th>
              <th className="text-right pb-2 pr-3">Win %</th>
              <th className="text-right pb-2 pr-3">ΔWin %</th>
              <th className="text-right pb-2 pr-3">Avg R</th>
              <th className="text-right pb-2">ΔAvg R (lift)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/20">
            {signals?.map((s) => (
              <tr
                key={s.signal}
                className={`transition-colors hover:bg-surface-elevated/20 ${!s.enough ? 'opacity-40' : ''}`}
                title={!s.enough ? 'Low sample (<30) — treat with caution' : ''}
              >
                <td className="py-1.5 pr-4">
                  <span className="font-mono text-slate-200 text-[11px]">{s.signal}</span>
                  {!s.enough && <span className="ml-1.5 chip bg-slate-700/50 text-slate-500 text-[9px]">low n</span>}
                </td>
                <td className="py-1.5 pr-3 text-right font-mono text-slate-400">{s.n}</td>
                <td className="py-1.5 pr-3 text-right font-mono">{fmtPct(s.winRate)}</td>
                <td className={`py-1.5 pr-3 text-right font-mono ${s.winLift >= 0 ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                  {s.winLift >= 0 ? '+' : ''}{s.winLift}%
                </td>
                <td className="py-1.5 pr-3 text-right font-mono text-slate-400">{s.avgR}R</td>
                <td className={`py-1.5 text-right font-mono font-semibold ${s.rLift >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmtR(s.rLift)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-600">
        Sorted by ΔAvg R (lift). Dimmed rows have &lt;30 samples — treat with caution.
        Positive lift = signal adds edge. Negative = dilutive.
      </p>
    </div>
  );
};

/* ── Elapsed timer displayed during long-running requests ────────────── */

const ElapsedTimer = ({ seconds }) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return (
    <span className="font-mono text-slate-500 text-xs tabular-nums">
      {m > 0 ? `${m}m ` : ''}{String(s).padStart(2, '0')}s
    </span>
  );
};

/* ── Main page ────────────────────────────────────────────────────────── */

const TABS = ['Setup Replay', 'Walk-Forward'];
const WF_MODES = ['fixed', 'linear', 'adaptive'];
const WF_PERIODS = ['1y', '2y'];

export default function Backtest() {
  const [tab, setTab] = useState(0);

  /* ── Setup Replay state ── */
  const [form, setForm] = useState({ symbol: '', entry: '', stopLoss: '', target1: '', target2: '' });
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupResult, setSetupResult]   = useState(null);
  const [setupError,  setSetupError]    = useState(null);
  const [recentSignals, setRecentSignals] = useState([]);
  const [showFill, setShowFill] = useState(false);

  /* ── Walk-Forward state ── */
  const [wfModes,    setWfModes]    = useState(['fixed', 'adaptive']);
  const [wfPeriod,   setWfPeriod]   = useState('2y');
  const [wfLoading,  setWfLoading]  = useState(false);
  const [wfResult,   setWfResult]   = useState(null);
  const [wfError,    setWfError]    = useState(null);
  const [wfElapsed,  setWfElapsed]  = useState(0);

  /* ── Signal Edge state ── */
  const [edgeLoading, setEdgeLoading] = useState(false);
  const [edgeResult,  setEdgeResult]  = useState(null);
  const [edgeError,   setEdgeError]   = useState(null);
  const [edgeElapsed, setEdgeElapsed] = useState(0);

  const wfTimer  = useRef(null);
  const edgeTimer = useRef(null);

  /* Fetch recent BUY signals for quick-fill */
  useEffect(() => {
    signalsApi.getAll({ verdict: 'BUY', limit: 10 })
      .then((res) => setRecentSignals(Array.isArray(res) ? res : res?.signals ?? []))
      .catch(() => {});
  }, []);

  /* Computed RR from form values */
  const rr = useMemo(() => {
    const e = parseFloat(form.entry);
    const sl = parseFloat(form.stopLoss);
    const t2 = parseFloat(form.target2);
    if (e > 0 && sl > 0 && t2 > 0 && e > sl) return ((t2 - e) / (e - sl)).toFixed(1);
    return null;
  }, [form]);

  const formValid =
    form.symbol.trim().length > 0 &&
    parseFloat(form.entry) > 0 &&
    parseFloat(form.stopLoss) > 0 &&
    parseFloat(form.target1) > 0 &&
    parseFloat(form.target2) > 0 &&
    parseFloat(form.entry) > parseFloat(form.stopLoss);

  /* ── Setup Replay run ── */
  const runSetup = useCallback(async () => {
    setSetupLoading(true);
    setSetupError(null);
    setSetupResult(null);
    try {
      const res = await backtestApi.setup({
        symbol:   form.symbol.trim().toUpperCase(),
        entry:    parseFloat(form.entry),
        stopLoss: parseFloat(form.stopLoss),
        target1:  parseFloat(form.target1),
        target2:  parseFloat(form.target2),
      });
      setSetupResult({ ...res.result, cached: res.cached });
    } catch (err) {
      setSetupError(err.message ?? 'Backtest failed');
    } finally {
      setSetupLoading(false);
    }
  }, [form]);

  /* ── Walk-Forward run ── */
  const runWalkFwd = useCallback(async () => {
    setWfLoading(true);
    setWfError(null);
    setWfResult(null);
    setWfElapsed(0);
    wfTimer.current = setInterval(() => setWfElapsed((n) => n + 1), 1000);
    try {
      const res = await backtestApi.run({ useWatchlist: true, modes: wfModes, period: wfPeriod });
      setWfResult(res);
    } catch (err) {
      setWfError(err.message ?? 'Walk-forward failed');
    } finally {
      clearInterval(wfTimer.current);
      setWfLoading(false);
    }
  }, [wfModes, wfPeriod]);

  /* ── Signal Edge run ── */
  const runSignalEdge = useCallback(async () => {
    setEdgeLoading(true);
    setEdgeError(null);
    setEdgeResult(null);
    setEdgeElapsed(0);
    edgeTimer.current = setInterval(() => setEdgeElapsed((n) => n + 1), 1000);
    try {
      const res = await backtestApi.signalEdge({ useWatchlist: true, period: wfPeriod });
      setEdgeResult(res);
    } catch (err) {
      setEdgeError(err.message ?? 'Signal edge analysis failed');
    } finally {
      clearInterval(edgeTimer.current);
      setEdgeLoading(false);
    }
  }, [wfPeriod]);

  useEffect(() => () => { clearInterval(wfTimer.current); clearInterval(edgeTimer.current); }, []);

  const fillFromSignal = (s) => {
    setForm({
      symbol:   s.symbol,
      entry:    String(s.entryZone?.low ?? ''),
      stopLoss: String(s.stopLoss ?? ''),
      target1:  String(s.target1 ?? ''),
      target2:  String(s.target2 ?? ''),
    });
    setShowFill(false);
    setSetupResult(null);
    setSetupError(null);
  };

  const toggleWfMode = (m) => {
    setWfModes((prev) =>
      prev.includes(m) ? (prev.length > 1 ? prev.filter((x) => x !== m) : prev) : [...prev, m]
    );
  };

  /* ── Render ── */
  return (
    <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">

      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-slate-100">Backtesting</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Walk-forward replay on 2y of OHLCV. BUY proxy = Claude-eligible bars (gates ≥ 5).
          News/earnings gates can&apos;t be replayed historically — results reflect price-derived signals only.
        </p>
      </div>

      {/* Tabs */}
      <div className="seg-group">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} className={`seg ${tab === i ? 'seg-active' : ''}`}>
            {t}
          </button>
        ))}
      </div>

      {/* ── Tab 0: Setup Replay ─────────────────────────────────────────── */}
      {tab === 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Form panel */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">Setup Parameters</h2>
              {recentSignals.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setShowFill((v) => !v)}
                    className="btn-ghost text-xs py-1 px-2"
                  >
                    Fill from signal ▾
                  </button>
                  {showFill && (
                    <div className="absolute right-0 top-full mt-1 z-10 glass rounded-xl shadow-2xl min-w-[200px] py-1 max-h-64 overflow-y-auto">
                      {recentSignals.map((s) => (
                        <button
                          key={s._id}
                          onClick={() => fillFromSignal(s)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300 hover:bg-surface-elevated/60 transition-colors text-left"
                        >
                          <span className="font-mono font-bold text-slate-100">{s.symbol}</span>
                          <span className="text-slate-500 text-xs">
                            ₹{s.entryZone?.low?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Symbol</label>
                <input
                  className="input font-mono uppercase"
                  placeholder="e.g. RELIANCE"
                  value={form.symbol}
                  onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value.toUpperCase() }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Entry ₹</label>
                  <input
                    className="input font-mono"
                    type="number"
                    placeholder="e.g. 2750"
                    value={form.entry}
                    onChange={(e) => setForm((f) => ({ ...f, entry: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Stop Loss ₹</label>
                  <input
                    className="input font-mono"
                    type="number"
                    placeholder="e.g. 2650"
                    value={form.stopLoss}
                    onChange={(e) => setForm((f) => ({ ...f, stopLoss: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Target 1 ₹</label>
                  <input
                    className="input font-mono"
                    type="number"
                    placeholder="e.g. 2950"
                    value={form.target1}
                    onChange={(e) => setForm((f) => ({ ...f, target1: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Target 2 ₹</label>
                  <input
                    className="input font-mono"
                    type="number"
                    placeholder="e.g. 3050"
                    value={form.target2}
                    onChange={(e) => setForm((f) => ({ ...f, target2: e.target.value }))}
                  />
                </div>
              </div>

              {rr && (
                <p className="text-xs text-slate-400">
                  Risk:Reward <span className={`font-mono font-semibold ${parseFloat(rr) >= 2 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {rr}:1
                  </span>
                  {parseFloat(rr) < 2 && <span className="text-amber-400/70 ml-2">⚠ below 2:1 minimum</span>}
                </p>
              )}
            </div>

            <button
              onClick={runSetup}
              disabled={!formValid || setupLoading}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {setupLoading ? (
                <>
                  <Spinner size={15} />
                  <span>Replaying… (fetching 2y data)</span>
                </>
              ) : (
                '⏱ Run Setup Replay'
              )}
            </button>

            {setupError && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {setupError}
              </p>
            )}

            <p className="text-[10px] text-slate-600 leading-relaxed">
              Finds every historical bar where price touched the entry level, simulates a trade on
              the NEXT bar&apos;s open, and aggregates outcomes. Results are cached 30 days.
            </p>
          </div>

          {/* Results panel */}
          <div className="card">
            {setupLoading ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <Spinner size={28} />
                <p className="text-sm text-slate-400">Fetching historical data from Python service…</p>
                <p className="text-xs text-slate-600">This takes 10–30 seconds per symbol</p>
              </div>
            ) : setupResult ? (
              <SetupResults result={setupResult} />
            ) : (
              <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
                <span className="text-3xl opacity-30">◷</span>
                <p className="text-slate-400 text-sm">Results appear here after you run the replay</p>
                <p className="text-xs text-slate-600">
                  Tip: use &ldquo;Fill from signal&rdquo; to pre-fill from a BUY signal
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab 1: Walk-Forward ─────────────────────────────────────────── */}
      {tab === 1 && (
        <div className="space-y-5">

          {/* Controls */}
          <div className="card flex flex-wrap items-end gap-5">

            {/* Hold modes */}
            <div className="space-y-1.5">
              <p className="text-xs text-slate-400 uppercase tracking-wide">Hold modes</p>
              <div className="flex gap-2">
                {WF_MODES.map((m) => (
                  <button
                    key={m}
                    onClick={() => toggleWfMode(m)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all capitalize ${
                      wfModes.includes(m)
                        ? 'bg-accent/15 border-accent/40 text-accent'
                        : 'bg-transparent border-slate-700/60 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Period */}
            <div className="space-y-1.5">
              <p className="text-xs text-slate-400 uppercase tracking-wide">Period</p>
              <div className="seg-group">
                {WF_PERIODS.map((p) => (
                  <button key={p} onClick={() => setWfPeriod(p)} className={`seg ${wfPeriod === p ? 'seg-active' : ''}`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Run button */}
            <button
              onClick={runWalkFwd}
              disabled={wfLoading}
              className="btn-primary flex items-center gap-2 ml-auto"
            >
              {wfLoading ? (
                <>
                  <Spinner size={14} />
                  <span>Running… <ElapsedTimer seconds={wfElapsed} /></span>
                </>
              ) : (
                '▶ Run on Watchlist'
              )}
            </button>
          </div>

          {wfError && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
              {wfError}
            </p>
          )}

          {wfLoading && (
            <div className="card flex items-center gap-4 py-6">
              <Spinner size={24} />
              <div>
                <p className="text-sm text-slate-300">Processing watchlist symbols…</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Each symbol fetches 2 years of OHLCV from Python, runs indicators + gates, and simulates trades.
                  Typically 30–120 seconds depending on watchlist size. <ElapsedTimer seconds={wfElapsed} />
                </p>
              </div>
            </div>
          )}

          {wfResult && !wfLoading && (
            <div className="space-y-5">

              {/* Summary chip */}
              <p className="text-xs text-slate-500">
                Analysed <span className="text-slate-300 font-mono">{wfResult.symbols}</span> symbols ·
                period <span className="text-slate-300 font-mono">{wfResult.period}</span> ·
                modes: <span className="text-slate-300 font-mono">{wfResult.modes?.join(', ')}</span>
              </p>

              {/* Live-strategy reality check */}
              <div className="card">
                <LiveStrategyPanel results={wfResult.results} modes={wfResult.modes} />
              </div>

              {/* Mode comparison */}
              <div className="card">
                <ModeTable results={wfResult.results} modes={wfResult.modes} />
              </div>

              {/* Score buckets + exit reasons */}
              <div className="card">
                <BucketTable results={wfResult.results} modes={wfResult.modes} />
              </div>
            </div>
          )}

          {!wfResult && !wfLoading && !wfError && (
            <div className="card flex flex-col items-center justify-center py-14 gap-3 text-center">
              <span className="text-4xl opacity-20">◷</span>
              <p className="text-slate-400 text-sm">Click &ldquo;Run on Watchlist&rdquo; to start the walk-forward backtest</p>
              <p className="text-xs text-slate-600 max-w-md">
                Each bar is scored by the same gates and Simons signals used in live scanning.
                Compare hold modes and identify which score thresholds historically outperform.
              </p>
            </div>
          )}

          {/* Signal Edge section */}
          <div className="card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-200">Signal Edge Analysis</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Per-flag edge: which signals add or subtract R vs. not having them present.
                </p>
              </div>
              <button
                onClick={runSignalEdge}
                disabled={edgeLoading}
                className="btn-ghost flex items-center gap-2 text-sm"
              >
                {edgeLoading ? (
                  <>
                    <Spinner size={13} />
                    <span>Analysing… <ElapsedTimer seconds={edgeElapsed} /></span>
                  </>
                ) : (
                  '⟳ Run Signal Edge'
                )}
              </button>
            </div>

            {edgeError && (
              <p className="text-xs text-red-400">{edgeError}</p>
            )}

            {edgeLoading && (
              <div className="flex items-center gap-3 py-4 text-slate-400 text-sm">
                <Spinner size={18} />
                <span>Running adaptive-mode backtest, extracting per-flag outcomes… <ElapsedTimer seconds={edgeElapsed} /></span>
              </div>
            )}

            {edgeResult && !edgeLoading && (
              <SignalEdgeTable result={edgeResult} />
            )}

            {!edgeResult && !edgeLoading && !edgeError && (
              <p className="text-xs text-slate-600 italic">
                Click &ldquo;Run Signal Edge&rdquo; to see which flags add or subtract expectancy.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
