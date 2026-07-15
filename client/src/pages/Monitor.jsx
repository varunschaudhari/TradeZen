/**
 * @file Monitor.jsx
 * @description Scan & database monitoring dashboard. Consolidates 10 views:
 *   (1) stock inventory + scan status, (2) live scan progress, (3) scan history,
 *   (4) database statistics, (5) data health check, (6) scan scheduler & controls,
 *   (7) alerts/events feed, (8) sector-wise scan status, (9) signal-generation
 *   analytics, (10) scanning-performance insights. Live-updates over WebSocket.
 * @author TradeZen Team
 * @created 2026-06-27
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import useSocket from '../hooks/useSocket.js';
import useScanProgress from '../hooks/useScanProgress.js';
import { monitorApi, scanApi } from '../services/api.js';
import { SOCKET_EVENTS, MARKET_MODE_COLORS, SCAN_STAGE_STYLES } from '../utils/constants.js';
import { timeAgo, formatDateTime } from '../utils/formatters.js';

const fmtPrice = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`);
const fmtDur = (ms) => (ms == null ? '—' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
const fmtEta = (ms) => {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};

/* ── Small presentational helpers ─────────────────────────────────────────────── */
const Card = ({ title, action, children, className = '' }) => (
  <div className={`card ${className}`}>
    {(title || action) && (
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-300">{title}</h3>
        {action}
      </div>
    )}
    {children}
  </div>
);
Card.propTypes = { title: PropTypes.node, action: PropTypes.node, children: PropTypes.node, className: PropTypes.string };

const Stat = ({ label, value, color = 'text-slate-100', sub }) => (
  <div className="bg-surface-elevated/40 rounded-lg px-3 py-2.5 border border-slate-700/50">
    <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
    <p className={`text-xl font-mono font-bold tabular-nums ${color}`}>{value}</p>
    {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
  </div>
);
Stat.propTypes = { label: PropTypes.string, value: PropTypes.node, color: PropTypes.string, sub: PropTypes.node };

const SEVERITY_STYLES = {
  success: { dot: 'bg-bull', text: 'text-bull' },
  info: { dot: 'bg-blue-400', text: 'text-slate-300' },
  warn: { dot: 'bg-wait', text: 'text-wait' },
  error: { dot: 'bg-bear', text: 'text-bear' },
};

const PHASES = [
  { key: 'market', label: 'Market' },
  { key: 'discovery', label: 'Discovery' },
  { key: 'analysis', label: 'Scoring' },
  { key: 'claude', label: 'AI' },
  { key: 'monitor', label: 'Monitor' },
  { key: 'done', label: 'Done' },
];

/* ── Feature 2 + 6: Live progress + controls ──────────────────────────────────── */
const ScanProgressBar = ({ progress }) => {
  if (!progress) return null;
  const running = progress.status === 'running';
  const phaseIdx = PHASES.findIndex((p) => p.key === progress.phase);

  return (
    <div className="space-y-3">
      {/* Phase stepper */}
      <div className="flex items-center gap-1.5">
        {PHASES.map((p, i) => {
          const active = i === phaseIdx;
          const done = phaseIdx > i || progress.status === 'complete';
          return (
            <React.Fragment key={p.key}>
              <div className="flex flex-col items-center">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    active ? 'bg-accent animate-pulse' : done ? 'bg-bull' : 'bg-slate-600'
                  }`}
                />
                <span className={`text-[10px] mt-1 ${active ? 'text-accent' : 'text-slate-500'}`}>{p.label}</span>
              </div>
              {i < PHASES.length - 1 && (
                <span className={`flex-1 h-px ${phaseIdx > i ? 'bg-bull/50' : 'bg-slate-700'}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Status note (what the scan is doing right now) */}
      {running && progress.note && (
        <p className="text-xs text-accent flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          {progress.note}
        </p>
      )}

      {/* Progress bar (counted phases: scoring + AI) */}
      {progress.total > 0 && (
        <div>
          <div className="flex justify-between text-[11px] text-slate-400 mb-1">
            <span>
              {progress.processed}/{progress.total} {progress.phase === 'claude' ? 'AI-analyzed' : 'scored'}
              {running && progress.currentSymbol ? ` · ${progress.currentSymbol}` : ''}
            </span>
            <span>
              {progress.pct}%{running && progress.etaMs != null ? ` · ETA ${fmtEta(progress.etaMs)}` : ''}
            </span>
          </div>
          <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-2 bg-gradient-to-r from-accent to-accent-light rounded-full transition-all duration-300"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Live counters */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <span className="text-slate-500">
          Status: <span className={running ? 'text-accent font-semibold' : 'text-slate-300'}>{progress.status}</span>
        </span>
        <span className="text-slate-500">Signals: <span className="text-buy font-mono">{progress.signalsFound}</span></span>
        <span className="text-slate-500">BUY: <span className="text-bull font-mono">{progress.buySignals}</span></span>
        <span className="text-slate-500">Errors: <span className={`font-mono ${progress.errors ? 'text-bear' : 'text-slate-300'}`}>{progress.errors}</span></span>
        <span className="text-slate-500">Elapsed: <span className="text-slate-300 font-mono">{fmtDur(progress.elapsedMs)}</span></span>
      </div>
    </div>
  );
};
ScanProgressBar.propTypes = { progress: PropTypes.object };

/* ── Feature 1: Stock inventory ───────────────────────────────────────────────── */
const StageBadge = ({ stage }) =>
  stage ? (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border ${SCAN_STAGE_STYLES[stage] ?? 'bg-slate-700/40 text-slate-300 border-slate-600'}`}>
      {stage}
    </span>
  ) : (
    <span className="text-[10px] text-slate-600">not scanned</span>
  );
StageBadge.propTypes = { stage: PropTypes.string };

const InventoryTable = ({ inventory }) => {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('ALL'); // ALL | SCANNED | NOT_SCANNED | WATCHLIST | SIGNALS

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    return (inventory?.stocks ?? []).filter((s) => {
      if (q && !s.symbol.includes(q)) return false;
      if (filter === 'SCANNED') return s.scanned;
      if (filter === 'NOT_SCANNED') return !s.scanned;
      if (filter === 'WATCHLIST') return s.inWatchlist;
      if (filter === 'SIGNALS') return !!s.signal;
      return true;
    });
  }, [inventory, query, filter]);

  const filters = ['ALL', 'SCANNED', 'NOT_SCANNED', 'WATCHLIST', 'SIGNALS'];

  return (
    <Card
      title={`Stock Inventory (${inventory?.total ?? 0})`}
      action={
        <span className="text-[11px] text-slate-500">
          {inventory?.scannedCount ?? 0} scanned · {inventory?.notScannedCount ?? 0} pending
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search symbol…"
          className="input text-xs py-1 px-2 w-40"
        />
        <div className="flex flex-wrap gap-1.5 ml-auto">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                filter === f
                  ? 'bg-accent text-white border-accent'
                  : 'bg-surface-card text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="sticky top-0 bg-surface-card">
            <tr className="text-left text-[11px] text-slate-500 border-b border-slate-700">
              <th className="pb-2 pr-3">Symbol</th>
              <th className="pb-2 pr-3">Sector</th>
              <th className="pb-2 pr-3 text-right">Price</th>
              <th className="pb-2 pr-3 text-right">Gates</th>
              <th className="pb-2 pr-3 text-right">Score</th>
              <th className="pb-2 pr-3">Stage</th>
              <th className="pb-2 pr-3">Signal</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.symbol} className="border-b border-slate-800 last:border-0 hover:bg-surface-elevated/30">
                <td className="py-1.5 pr-3 font-medium text-slate-200">
                  {s.symbol}
                  {s.inWatchlist && <span className="ml-1 text-[9px] text-accent" title="In watchlist">★</span>}
                </td>
                <td className="py-1.5 pr-3 text-slate-400 text-xs">{s.sector}</td>
                <td className="py-1.5 pr-3 text-right font-mono text-slate-300">{fmtPrice(s.currentPrice)}</td>
                <td className="py-1.5 pr-3 text-right font-mono text-slate-300">
                  {s.gatesPassed == null ? '—' : `${s.gatesPassed}/8`}
                </td>
                <td className="py-1.5 pr-3 text-right font-mono text-slate-300">{s.compositeScore ?? '—'}</td>
                <td className="py-1.5 pr-3"><StageBadge stage={s.droppedAtStage} /></td>
                <td className="py-1.5 pr-3">
                  {s.signal ? (
                    <span className={`text-xs font-semibold badge-${s.signal.verdict?.toLowerCase()}`}>
                      {s.signal.verdict}
                    </span>
                  ) : (
                    <span className="text-slate-600 text-xs">—</span>
                  )}
                </td>
                <td className="py-1.5 text-right">
                  <Link to={`/analysis/${s.symbol}`} className="text-[11px] text-accent hover:underline">Analyze</Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="py-6 text-center text-slate-500 text-sm">No stocks match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
InventoryTable.propTypes = { inventory: PropTypes.object };

/* ── Feature 8: Sector status ─────────────────────────────────────────────────── */
const SectorStatus = ({ sectors }) => {
  const max = Math.max(1, ...(sectors ?? []).map((s) => s.scanned));
  return (
    <Card title="Sector-wise Scan Status">
      {sectors?.length ? (
        <div className="space-y-2">
          {sectors.map((s) => (
            <div key={s.sector} className="flex items-center gap-2 text-xs">
              <span className="w-20 text-slate-400 truncate">{s.sector}</span>
              <div className="flex-1 h-4 bg-slate-700/50 rounded overflow-hidden relative">
                <div className="h-4 bg-accent/40 rounded" style={{ width: `${(s.scanned / max) * 100}%` }} />
                <span className="absolute inset-0 flex items-center px-2 text-[10px] text-slate-200">
                  {s.scanned} scanned · {s.analyzed} analyzed · {s.signals} signals
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-slate-500 text-sm">No scan data yet.</p>
      )}
    </Card>
  );
};
SectorStatus.propTypes = { sectors: PropTypes.array };

/* ── Feature 5: Health ────────────────────────────────────────────────────────── */
const HEALTH_COLORS = { HEALTHY: 'text-bull', DEGRADED: 'text-wait', UNHEALTHY: 'text-bear' };
const HealthCard = ({ health }) => {
  if (!health) return null;
  return (
    <Card title="Data Health Check">
      <div className="flex items-center gap-4 mb-3">
        <div className="text-center">
          <p className={`text-3xl font-mono font-bold ${HEALTH_COLORS[health.rating] ?? 'text-slate-300'}`}>{health.score}</p>
          <p className={`text-[11px] font-semibold ${HEALTH_COLORS[health.rating] ?? 'text-slate-400'}`}>{health.rating}</p>
        </div>
        <div className="flex-1 grid grid-cols-2 gap-2 text-xs">
          <div><span className="text-slate-500">Last scan: </span><span className="text-slate-300">{health.lastScanAgeMin == null ? '—' : `${health.lastScanAgeMin}m ago`}</span></div>
          <div><span className="text-slate-500">Error rate: </span><span className={health.errorRate > 3 ? 'text-wait' : 'text-slate-300'}>{health.errorRate}%</span></div>
          <div><span className="text-slate-500">Low-liq rejected: </span><span className="text-slate-300">{health.lowLiquidityRejected}</span></div>
          <div><span className="text-slate-500">Data errors: </span><span className="text-slate-300">{health.dataErrorStocks?.length ?? 0}</span></div>
        </div>
      </div>
      {health.issues?.length > 0 && (
        <div className="space-y-1 border-t border-slate-700/60 pt-2">
          {health.issues.map((iss, i) => {
            const sev = SEVERITY_STYLES[iss.severity] ?? SEVERITY_STYLES.info;
            return (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${sev.dot}`} />
                <span className={sev.text}>{iss.message}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};
HealthCard.propTypes = { health: PropTypes.object };

/* ── Feature 9 + 10: Analytics + performance ──────────────────────────────────── */
const AnalyticsCard = ({ analytics }) => {
  if (!analytics?.available) {
    return <Card title="Signal & Scan Analytics"><p className="text-slate-500 text-sm">{analytics?.message ?? 'No data yet'}</p></Card>;
  }
  const { signalGen, performance, topDropReasons } = analytics;
  return (
    <Card title={`Analytics (last ${analytics.window} scans)`}>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Stat label="Signals/scan" value={signalGen.avgSignalsPerScan} color="text-buy" />
        <Stat label="BUY conv." value={`${signalGen.buyConversionPct}%`} color="text-bull" />
        <Stat label="Verdicts run" value={signalGen.claudeCalls} color="text-accent" />
        <Stat label="Avg duration" value={fmtDur(performance.avgDurationMs)} />
        <Stat label="Fastest" value={fmtDur(performance.fastestMs)} color="text-bull" />
        <Stat label="Slowest" value={fmtDur(performance.slowestMs)} color="text-wait" />
      </div>
      <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
        <span>Verdict cost (window): <span className="text-slate-200 font-mono">₹{performance.totalCostInr}</span> <span className="text-slate-600">(deterministic verdicts are free)</span></span>
      </div>
      {topDropReasons?.length > 0 && (
        <div className="border-t border-slate-700/60 pt-2">
          <p className="text-[11px] text-slate-500 mb-1.5">Top screen-rejection reasons</p>
          <div className="flex flex-wrap gap-1.5">
            {topDropReasons.map((r) => (
              <span key={r.reason} className="text-[11px] px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400">
                {r.reason}: <span className="text-slate-200 font-mono">{r.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};
AnalyticsCard.propTypes = { analytics: PropTypes.object };

/* ── Score reachability: how close does the latest scan get to a real BUY? ───────
 * The verdict engine only BUYs at score-confidence HIGH (≥60) — this makes a
 * persistently-empty 60+ band visible per-scan instead of discovered days later. */
const SCORE_BUCKET_COLOR = { '<50': 'text-slate-500', '50-59': 'text-wait', '60-69': 'text-bull', '70+': 'text-buy' };
const ScoreDistributionCard = ({ dist }) => {
  if (!dist?.available) {
    return (
      <Card title="Score Reachability (latest scan)">
        <p className="text-slate-500 text-sm">No gate-qualified stocks in the latest scan yet.</p>
      </Card>
    );
  }
  const { byScoreBucket, byVerdict, qualifiedCount, topScores } = dist;
  return (
    <Card title="Score Reachability (latest scan)">
      <div className="grid grid-cols-4 gap-2 mb-3">
        {Object.entries(byScoreBucket).map(([bucket, count]) => (
          <Stat key={bucket} label={bucket} value={count} color={SCORE_BUCKET_COLOR[bucket]} />
        ))}
      </div>
      <div className="flex items-center gap-3 text-xs text-slate-400 mb-3">
        <span>{qualifiedCount} gate-qualified →</span>
        <span className="text-buy font-mono">{byVerdict.BUY} BUY</span>
        <span className="text-wait font-mono">{byVerdict.WAIT} WAIT</span>
        <span className="text-slate-500 font-mono">{byVerdict.SKIP} SKIP</span>
        {byVerdict.BUY === 0 && qualifiedCount > 0 && (
          <span className="text-wait">— no score reached the HIGH band this scan</span>
        )}
      </div>
      {topScores?.length > 0 && (
        <div className="border-t border-slate-700/60 pt-2">
          <p className="text-[11px] text-slate-500 mb-1.5">Top scores this scan</p>
          <div className="flex flex-wrap gap-1.5">
            {topScores.map((s) => (
              <span key={s.symbol} className="text-[11px] px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400">
                {s.symbol}: <span className="text-slate-200 font-mono">{s.score}</span>
                <span className={s.verdict === 'BUY' ? 'text-buy' : s.verdict === 'WAIT' ? 'text-wait' : 'text-slate-500'}> {s.verdict}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};
ScoreDistributionCard.propTypes = { dist: PropTypes.object };

/* ── Feature 7: Events feed ───────────────────────────────────────────────────── */
const EventsFeed = ({ events }) => (
  <Card title="Alerts & Events">
    <div className="space-y-1.5 max-h-80 overflow-y-auto">
      {events?.length ? (
        events.map((e) => {
          const sev = SEVERITY_STYLES[e.severity] ?? SEVERITY_STYLES.info;
          return (
            <div key={e.id} className="flex items-start gap-2 text-xs">
              <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${sev.dot}`} />
              <span className={`flex-1 ${sev.text}`}>{e.message}</span>
              <span className="text-slate-600 whitespace-nowrap">{timeAgo(e.at)}</span>
            </div>
          );
        })
      ) : (
        <p className="text-slate-500 text-sm">No events yet.</p>
      )}
    </div>
  </Card>
);
EventsFeed.propTypes = { events: PropTypes.array };

/* ── Feature 3: Scan history ──────────────────────────────────────────────────── */
const ScanHistory = ({ history }) => (
  <Card title="Scan History">
    <div className="overflow-x-auto max-h-80 overflow-y-auto">
      <table className="w-full text-xs min-w-[420px]">
        <thead className="sticky top-0 bg-surface-card">
          <tr className="text-left text-[11px] text-slate-500 border-b border-slate-700">
            <th className="pb-2 pr-3">When</th>
            <th className="pb-2 pr-3">Mode</th>
            <th className="pb-2 pr-3 text-right">Analyzed</th>
            <th className="pb-2 pr-3 text-right">Signals</th>
            <th className="pb-2 pr-3 text-right">BUY</th>
            <th className="pb-2 text-right">Duration</th>
          </tr>
        </thead>
        <tbody>
          {history?.length ? (
            history.map((s) => (
              <tr key={s._id} className="border-b border-slate-800 last:border-0">
                <td className="py-1.5 pr-3 text-slate-300" title={formatDateTime(s.createdAt)}>{timeAgo(s.createdAt)}</td>
                <td className={`py-1.5 pr-3 font-medium ${MARKET_MODE_COLORS[s.marketMode] ?? 'text-slate-400'}`}>{s.marketMode ?? '—'}</td>
                <td className="py-1.5 pr-3 text-right font-mono text-slate-300">{s.funnel?.analyzed ?? '—'}</td>
                <td className="py-1.5 pr-3 text-right font-mono text-slate-300">{s.signalsSaved ?? 0}</td>
                <td className="py-1.5 pr-3 text-right font-mono text-buy">{s.buySignals ?? 0}</td>
                <td className="py-1.5 text-right font-mono text-slate-400">{fmtDur(s.durationMs)}</td>
              </tr>
            ))
          ) : (
            <tr><td colSpan={6} className="py-6 text-center text-slate-500">No scans yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  </Card>
);
ScanHistory.propTypes = { history: PropTypes.array };

/* ── Decision calibration — is the score/confidence actually predictive? ───────── */
const CAL_VERDICT = {
  true: { box: 'bg-bull/10 border-bull/40', text: 'text-bull', label: '✅ CALIBRATED' },
  false: { box: 'bg-bear/10 border-bear/40', text: 'text-bear', label: '❌ NOT CALIBRATED' },
  null: { box: 'bg-wait/10 border-wait/40', text: 'text-wait', label: '⚠️ INSUFFICIENT DATA' },
};

const BucketTable = ({ title, buckets }) => {
  const rows = Object.entries(buckets ?? {});
  if (!rows.length) return null;
  return (
    <div>
      <p className="text-[11px] text-slate-500 uppercase mb-1">{title}</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] text-slate-500 border-b border-slate-700">
            <th className="pb-1 pr-2">Bucket</th>
            <th className="pb-1 pr-2 text-right">n</th>
            <th className="pb-1 pr-2 text-right">resolved</th>
            <th className="pb-1 text-right">hit rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-slate-800 last:border-0">
              <td className="py-1 pr-2 font-mono text-slate-300">{k}</td>
              <td className="py-1 pr-2 text-right text-slate-400">{v.n}</td>
              <td className="py-1 pr-2 text-right text-slate-400">{v.resolvedPct}%</td>
              <td className={`py-1 text-right font-mono ${v.enough ? 'text-slate-200' : 'text-slate-600'}`}>
                {v.hitRate == null ? '—' : `${v.hitRate}%`}{!v.enough && v.hitRate != null ? ' *' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
BucketTable.propTypes = { title: PropTypes.string, buckets: PropTypes.object };

const CalibrationPanel = ({ calibration, loading, onRefresh }) => {
  const refreshBtn = (
    <button onClick={onRefresh} disabled={loading} className="btn-ghost text-[11px] px-2 py-1 disabled:opacity-50">
      {loading ? 'Computing…' : 'Recompute'}
    </button>
  );
  if (loading && !calibration) {
    return <Card title="Decision Calibration" action={refreshBtn}><div className="animate-pulse h-20 bg-slate-800/40 rounded" /></Card>;
  }
  if (!calibration) {
    return <Card title="Decision Calibration" action={refreshBtn}><p className="text-sm text-slate-500">Not computed yet — click Recompute.</p></Card>;
  }
  const v = calibration.verdict ?? {};
  const vs = CAL_VERDICT[String(v.calibrated)] ?? CAL_VERDICT.null;
  const sc = calibration.signalCalibration ?? {};
  const tb = calibration.tradeBased ?? {};
  const resolvedPct = sc.signalsConsidered ? Math.round((sc.resolved / sc.signalsConsidered) * 100) : 0;

  return (
    <Card
      title="Decision Calibration — is the score/confidence predictive?"
      action={refreshBtn}
    >
      <div className="space-y-3">
        <div className={`rounded-lg border p-3 ${vs.box}`}>
          <p className={`text-sm font-bold ${vs.text}`}>{vs.label}</p>
          <p className="text-xs text-slate-300 mt-1">{v.message}</p>
        </div>

        {/* Resolution status — the key context */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-surface-elevated/40 rounded p-2 border border-slate-700/50">
            <p className="text-[10px] text-slate-500 uppercase">Resolved</p>
            <p className="text-lg font-mono font-bold text-slate-200">{sc.resolved ?? 0}<span className="text-xs text-slate-500">/{sc.signalsConsidered ?? 0}</span></p>
            <p className="text-[10px] text-slate-600">{resolvedPct}%</p>
          </div>
          <div className="bg-surface-elevated/40 rounded p-2 border border-slate-700/50">
            <p className="text-[10px] text-slate-500 uppercase">Maturing</p>
            <p className="text-lg font-mono font-bold text-wait">{sc.open ?? 0}</p>
            <p className="text-[10px] text-slate-600">need 30d fwd</p>
          </div>
          <div className="bg-surface-elevated/40 rounded p-2 border border-slate-700/50">
            <p className="text-[10px] text-slate-500 uppercase">Closed trades</p>
            <p className="text-lg font-mono font-bold text-slate-200">{tb.closedTrades ?? 0}</p>
            <p className="text-[10px] text-slate-600">win {tb.winRate ?? '—'}%</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <BucketTable title="Hit rate by confidence" buckets={sc.byConfidence} />
          <BucketTable title="Hit rate by score band" buckets={sc.byScore} />
        </div>

        {/* Go-live gate */}
        {tb.goLive && (
          <div className={`rounded p-2 text-xs ${tb.goLive.ready ? 'bg-bull/10 border border-bull/30 text-bull' : 'bg-slate-800/40 border border-slate-700 text-slate-400'}`}>
            <span className="font-semibold">{tb.goLive.ready ? '✅ Go-live ready' : '⏳ Not go-live ready'}</span> — {tb.goLive.message}
          </div>
        )}

        <p className="text-[10px] text-slate-600 italic">
          Hit rate = win/(win+loss) on RESOLVED signals only, {sc.marketAdjusted ? 'market-adjusted (excess over Nifty)' : 'absolute'}.
          <span className="text-slate-500"> * = sample too small to trust.</span> Calibration needs signals aged ≥30 days to resolve.
          {calibration.cached ? ` Cached ${calibration.cacheAgeMin}m ago.` : ''}
        </p>
      </div>
    </Card>
  );
};
CalibrationPanel.propTypes = { calibration: PropTypes.object, loading: PropTypes.bool, onRefresh: PropTypes.func };

/* ── Page ─────────────────────────────────────────────────────────────────────── */
const Monitor = () => {
  const { subscribe } = useSocket();
  const { progress, events } = useScanProgress();
  const [overview, setOverview] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [calibration, setCalibration] = useState(null);
  const [calLoading, setCalLoading] = useState(true);

  // Calibration is heavy (resolves every signal vs forward prices) — load it separately
  // so it never blocks the rest of the page. Server caches it for 30 min.
  const loadCalibration = useCallback(async () => {
    setCalLoading(true);
    try {
      const res = await monitorApi.getCalibration();
      setCalibration(res.data ?? null);
    } catch {
      /* leave previous calibration; panel shows its own state */
    } finally {
      setCalLoading(false);
    }
  }, []);

  useEffect(() => { loadCalibration(); }, [loadCalibration]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [ov, inv, hist] = await Promise.all([
        monitorApi.getOverview(),
        monitorApi.getInventory(),
        scanApi.getHistory(),
      ]);
      setOverview(ov.data ?? null);
      setInventory(inv.data ?? null);
      setHistory(hist.data ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Refresh aggregates whenever a scan finishes.
  useEffect(() => {
    const unsub = subscribe(SOCKET_EVENTS.SCAN_COMPLETE, () => load());
    return () => unsub();
  }, [subscribe, load]);

  const running = progress?.status === 'running';

  const handleScanNow = async () => {
    setScanning(true);
    try {
      await monitorApi.triggerScan();
    } catch (err) {
      setError(err.message);
    } finally {
      setTimeout(() => setScanning(false), 1500);
    }
  };

  const handleToggleScanner = async () => {
    const next = !(overview?.scanner?.enabled);
    try {
      await monitorApi.setScanner(next);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const scanner = overview?.scanner;
  const stats = overview?.stats;

  return (
    <div className="min-h-screen bg-surface p-4 space-y-4">
      {/* Header + controls (Feature 6) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Scan Monitor</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {scanner?.lastScanAt ? `Last scan ${timeAgo(scanner.lastScanAt)}` : 'No scans yet'}
            {scanner?.intervalMinutes ? ` · auto every ${scanner.intervalMinutes}m` : ''}
            {scanner?.nextScanAt && scanner?.enabled ? ` · next ~${timeAgo(scanner.nextScanAt).replace(' ago', '')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleScanner}
            className={`text-xs px-3 py-1.5 rounded border transition-colors ${
              scanner?.enabled
                ? 'bg-bull/10 text-bull border-bull/40'
                : 'bg-slate-700/40 text-slate-400 border-slate-600'
            }`}
            title="Toggle the automatic scanner"
          >
            {scanner?.enabled ? '● Auto-scan ON' : '○ Auto-scan OFF'}
          </button>
          <button
            onClick={handleScanNow}
            disabled={running || scanning}
            className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
          >
            {running ? 'Scanning…' : scanning ? 'Starting…' : '⟳ Scan Now'}
          </button>
          <button onClick={load} className="btn-ghost text-xs px-3 py-1.5">Refresh</button>
        </div>
      </div>

      {error && <div className="card border-bear/30 bg-bear/10 text-bear text-sm">{error}</div>}

      {/* Live progress (Feature 2) */}
      <Card title="Live Scan Progress">
        <ScanProgressBar progress={progress} />
      </Card>

      {loading && <div className="card animate-pulse h-24" />}

      {!loading && (
        <>
          {/* DB statistics (Feature 4) */}
          {stats && (
            <Card title="Database Statistics">
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                <Stat label="Watchlist" value={stats.watchlistCount} />
                <Stat label="Universe" value={stats.universeCount ?? '—'} />
                <Stat label="Active signals" value={stats.activeSignals} color="text-buy" sub={`${stats.activeByVerdict.BUY} BUY · ${stats.activeByVerdict.WAIT} WAIT`} />
                <Stat label="Open trades" value={stats.openTrades} color="text-accent" />
                <Stat label="Closed trades" value={stats.closedTrades} />
                <Stat label="Win rate" value={stats.winRate == null ? '—' : `${stats.winRate}%`} color="text-bull" />
                <Stat label="Scans today" value={stats.scansToday} />
              </div>
              <p className="text-[10px] text-slate-600 mt-2">
                Collections — signals: {stats.collections.signals} · trades: {stats.collections.trades} · scan snapshots: {stats.collections.scanResults}
              </p>
            </Card>
          )}

          <ScoreDistributionCard dist={overview?.scoreDistribution} />

          {/* Analytics + Health (Features 9, 10, 5) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AnalyticsCard analytics={overview?.analytics} />
            <HealthCard health={overview?.health} />
          </div>

          {/* Decision calibration — is the score/confidence predictive? */}
          <CalibrationPanel calibration={calibration} loading={calLoading} onRefresh={loadCalibration} />

          {/* Sector status (Feature 8) */}
          <SectorStatus sectors={overview?.sectors} />

          {/* Inventory (Feature 1) */}
          <InventoryTable inventory={inventory} />

          {/* History + Events (Features 3, 7) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ScanHistory history={history} />
            <EventsFeed events={events} />
          </div>
        </>
      )}
    </div>
  );
};

export default Monitor;
