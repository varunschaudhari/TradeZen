/**
 * @file ScanResults.jsx
 * @description "What has scanning been finding" page — the latest scan-cycle snapshot
 *   (funnel, screen-rejection breakdown + a multi-scan rejection trend, score reachability
 *   vs. the BUY threshold), the full enriched stock grid (price/gates/score/verdict/active
 *   signal/stage, searchable + filterable by stage/watchlist/signal, joined with
 *   sector/watchlist/active-signal via the shared monitor inventory), and scan history.
 *   Absorbed from Monitor.jsx (2026-08) — that page now covers only live operational
 *   status; this one owns everything about what a scan actually found. Auto-refreshes on
 *   scan:complete via WebSocket.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import useSocket from '../hooks/useSocket.js';
import { scanApi, monitorApi } from '../services/api.js';
import { SOCKET_EVENTS, MARKET_MODE_COLORS, SCAN_STAGE_STYLES } from '../utils/constants.js';
import { timeAgo, formatDateTime } from '../utils/formatters.js';

const FUNNEL_STAGES = [
  { key: 'universe', label: 'Universe' },
  { key: 'screened', label: 'Screened' },
  { key: 'analyzed', label: 'Analyzed' },
  { key: 'gatePassed', label: 'Passed Gates' },
  { key: 'selected', label: 'To Verdict' },
];

const fmtPrice = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`);
const fmtDur = (ms) => (ms == null ? '—' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

const StageBadge = ({ stage, reason }) => (
  <span
    className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${
      SCAN_STAGE_STYLES[stage] ?? 'bg-slate-700/40 text-slate-300 border-slate-600'
    }`}
  >
    {stage}
    {reason ? ` · ${reason}` : ''}
  </span>
);

StageBadge.propTypes = { stage: PropTypes.string, reason: PropTypes.string };

/* ── Score reachability: how close does the latest scan get to a real BUY? ───────
 * The verdict engine only BUYs at score-confidence HIGH (≥60) — this makes a
 * persistently-empty 60+ band visible per-scan instead of discovered days later.
 * (Moved here from Monitor.jsx — same latest-scan data this page already shows.) */
const SCORE_BUCKET_COLOR = { '<50': 'text-slate-500', '50-59': 'text-wait', '60-69': 'text-bull', '70+': 'text-buy' };
const ScoreDistributionCard = ({ dist }) => {
  if (!dist?.available) {
    return (
      <div className="card">
        <p className="text-xs text-slate-500 mb-3">Score Reachability</p>
        <p className="text-slate-500 text-sm">No gate-qualified stocks in the latest scan yet.</p>
      </div>
    );
  }
  const { byScoreBucket, byVerdict, qualifiedCount, topScores } = dist;
  return (
    <div className="card">
      <p className="text-xs text-slate-500 mb-3">Score Reachability</p>
      <div className="grid grid-cols-4 gap-2 mb-3">
        {Object.entries(byScoreBucket).map(([bucket, count]) => (
          <div key={bucket} className="bg-surface-elevated/40 rounded-lg px-3 py-2.5 border border-slate-700/50">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">{bucket}</p>
            <p className={`text-xl font-mono font-bold tabular-nums ${SCORE_BUCKET_COLOR[bucket] ?? 'text-slate-100'}`}>{count}</p>
          </div>
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
    </div>
  );
};
ScoreDistributionCard.propTypes = { dist: PropTypes.object };

/* ── Scan History (moved from Monitor.jsx — same scanApi.getHistory() this page now owns) */
const ScanHistory = ({ history }) => (
  <div className="card overflow-x-auto">
    <p className="text-xs text-slate-500 mb-3">Scan History</p>
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
  </div>
);
ScanHistory.propTypes = { history: PropTypes.array };

const ScanResults = () => {
  const [scan, setScan] = useState(null);
  const [overview, setOverview] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stageFilter, setStageFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [signalsOnly, setSignalsOnly] = useState(false);
  const { subscribe } = useSocket();

  const fetchLatest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [scanRes, overviewRes, inventoryRes, historyRes] = await Promise.all([
        scanApi.getLatest(),
        monitorApi.getOverview(),
        monitorApi.getInventory(),
        scanApi.getHistory(),
      ]);
      setScan(scanRes.data ?? null);
      setOverview(overviewRes.data ?? null);
      setInventory(inventoryRes.data ?? null);
      setHistory(historyRes.data ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLatest();
  }, [fetchLatest]);

  // Refresh when a scan cycle finishes
  useEffect(() => {
    const unsub = subscribe(SOCKET_EVENTS.SCAN_COMPLETE, () => fetchLatest());
    return () => unsub();
  }, [subscribe, fetchLatest]);

  // Stock rows: the enriched inventory (this scan's stocks + watchlist symbols not
  // scanned this cycle, with sector/watchlist/active-signal joined in) rather than just
  // scan.stocks — same underlying scan, richer per-row context. inventory rows don't carry
  // the SCREEN-stage rejection `reason` string, so that's joined back in from scan.stocks.
  const stocks = useMemo(() => {
    const reasonBySymbol = new Map((scan?.stocks ?? []).map((s) => [s.symbol, s.reason]));
    return [...(inventory?.stocks ?? [])]
      .map((s) => ({ ...s, reason: reasonBySymbol.get(s.symbol) ?? null }))
      .sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0));
  }, [inventory, scan]);

  // Counts per drop stage (for the filter pills) — un-scanned watchlist rows bucket
  // under a synthetic NOT_SCANNED stage.
  const stageCounts = useMemo(() => {
    const counts = {};
    for (const s of stocks) counts[s.droppedAtStage ?? 'NOT_SCANNED'] = (counts[s.droppedAtStage ?? 'NOT_SCANNED'] ?? 0) + 1;
    return counts;
  }, [stocks]);

  const visibleStocks = useMemo(() => {
    const q = query.trim().toUpperCase();
    return stocks.filter((s) => {
      if (stageFilter !== 'ALL' && (s.droppedAtStage ?? 'NOT_SCANNED') !== stageFilter) return false;
      if (watchlistOnly && !s.inWatchlist) return false;
      if (signalsOnly && !s.signal) return false;
      if (q && !s.symbol.includes(q)) return false;
      return true;
    });
  }, [stocks, stageFilter, watchlistOnly, signalsOnly, query]);

  return (
    <div className="min-h-screen bg-surface p-4 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Scan Results</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {scan ? `Last scan: ${timeAgo(scan.createdAt)}` : 'No scans recorded yet'}
          </p>
        </div>
        <button onClick={fetchLatest} className="btn-primary text-xs px-3 py-1">
          Refresh
        </button>
      </div>

      {error && (
        <div className="card border-red-500/30 bg-red-500/10 text-red-400 text-sm">{error}</div>
      )}

      {loading && <div className="card animate-pulse h-24" />}

      {!loading && !scan && (
        <div className="card text-center py-16">
          <p className="text-4xl mb-3">🔍</p>
          <p className="text-slate-400 font-medium">No scan snapshots yet</p>
          <p className="text-slate-500 text-sm mt-1">Run a scan to populate the funnel and stock grid.</p>
        </div>
      )}

      {!loading && scan && (
        <>
          {/* Market context strip */}
          <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span>
              <span className="text-slate-500">Mode: </span>
              <span className={`font-bold ${MARKET_MODE_COLORS[scan.marketMode] ?? 'text-slate-300'}`}>
                {scan.marketMode}
              </span>
            </span>
            <span>
              <span className="text-slate-500">A/D Ratio: </span>
              <span className="font-mono text-slate-200">{scan.adRatio ?? '—'}</span>
            </span>
            <span>
              <span className="text-slate-500">Nifty: </span>
              <span className="font-mono text-slate-200">{fmtPrice(scan.niftyPrice)}</span>
            </span>
            <span>
              <span className="text-slate-500">Signals: </span>
              <span className="font-mono text-buy">{scan.signalsSaved ?? 0}</span>
            </span>
            <span>
              <span className="text-slate-500">Verdicts run: </span>
              <span className="font-mono text-slate-200">{scan.claudeCalls ?? 0}</span>
            </span>
            <span>
              <span className="text-slate-500">Cost: </span>
              <span className="font-mono text-slate-200">₹{scan.totalCostInr ?? 0}</span>
            </span>
          </div>

          {/* Funnel */}
          <div className="card">
            <p className="text-xs text-slate-500 mb-3">Funnel</p>
            <div className="flex flex-wrap items-center gap-2">
              {FUNNEL_STAGES.map((stage, i) => (
                <React.Fragment key={stage.key}>
                  <div className="flex flex-col items-center bg-surface-elevated rounded-lg px-4 py-2 min-w-[88px]">
                    <span className="text-2xl font-mono font-bold text-blue-400">
                      {scan.funnel?.[stage.key] ?? '—'}
                    </span>
                    <span className="text-[11px] text-slate-500 mt-0.5">{stage.label}</span>
                  </div>
                  {i < FUNNEL_STAGES.length - 1 && <span className="text-slate-600">→</span>}
                </React.Fragment>
              ))}
            </div>

            {/* Screen rejection breakdown */}
            {scan.screenRejections && Object.keys(scan.screenRejections).length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-slate-500 mb-2">Screen rejections (pre-analysis)</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(scan.screenRejections)
                    .filter(([, n]) => n > 0)
                    .map(([reason, n]) => (
                      <span
                        key={reason}
                        className="text-[11px] px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400"
                      >
                        {reason}: <span className="text-slate-200 font-mono">{n}</span>
                      </span>
                    ))}
                </div>
              </div>
            )}

            {/* Rejection trend, last N scans — a rollup of the same screenRejections
                field above; kept as a separate block since it answers a different
                question (this scan vs. a recent pattern). */}
            {overview?.analytics?.topDropReasons?.length > 0 && (
              <div className="mt-4 border-t border-slate-700/60 pt-3">
                <p className="text-xs text-slate-500 mb-2">
                  Rejection trend (last {overview.analytics.window} scans)
                </p>
                <div className="flex flex-wrap gap-2">
                  {overview.analytics.topDropReasons.map((r) => (
                    <span
                      key={r.reason}
                      className="text-[11px] px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400"
                    >
                      {r.reason}: <span className="text-slate-200 font-mono">{r.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Score reachability — how close this scan got to a real BUY */}
          <ScoreDistributionCard dist={overview?.scoreDistribution} />

          {/* Scanned stocks table */}
          <div className="card overflow-x-auto">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <p className="text-xs text-slate-500">Scanned stocks ({stocks.length})</p>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search symbol…"
                className="input text-xs py-1 px-2 w-36"
              />
              <div className="flex flex-wrap gap-1.5 ml-auto">
                {['ALL', 'SIGNAL', 'CLAUDE', 'RANKED_OUT', 'GATES', 'ANALYZE_CAP', 'SCREEN', 'NOT_SCANNED'].map(
                  (stg) => {
                    const count = stg === 'ALL' ? stocks.length : (stageCounts[stg] ?? 0);
                    if (stg !== 'ALL' && count === 0) return null;
                    return (
                      <button
                        key={stg}
                        onClick={() => setStageFilter(stg)}
                        className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                          stageFilter === stg
                            ? 'bg-blue-600 text-white border-blue-500'
                            : 'bg-surface-card text-slate-400 border-slate-700 hover:text-slate-200'
                        }`}
                      >
                        {stg} <span className="opacity-60">{count}</span>
                      </button>
                    );
                  }
                )}
                <span className="w-px bg-slate-700 mx-0.5" />
                <button
                  onClick={() => setWatchlistOnly((v) => !v)}
                  className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                    watchlistOnly
                      ? 'bg-accent text-white border-accent'
                      : 'bg-surface-card text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  ★ WATCHLIST
                </button>
                <button
                  onClick={() => setSignalsOnly((v) => !v)}
                  className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                    signalsOnly
                      ? 'bg-accent text-white border-accent'
                      : 'bg-surface-card text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  SIGNALS
                </button>
              </div>
            </div>
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-[11px] text-slate-500 border-b border-slate-700">
                  <th className="pb-2 pr-3">Symbol</th>
                  <th className="pb-2 pr-3">Sector</th>
                  <th className="pb-2 pr-3 text-right">Price</th>
                  <th className="pb-2 pr-3 text-right">Gates</th>
                  <th className="pb-2 pr-3 text-right">Score</th>
                  <th className="pb-2 pr-3">Verdict</th>
                  <th className="pb-2 pr-3">Signal</th>
                  <th className="pb-2">Stage</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {visibleStocks.map((s) => (
                  <tr key={s.symbol} className="border-b border-slate-800 last:border-0">
                    <td className="py-2 pr-3 font-medium text-slate-200">
                      {s.symbol}
                      {s.inWatchlist && <span className="ml-1 text-[9px] text-accent" title="In watchlist">★</span>}
                    </td>
                    <td className="py-2 pr-3 text-slate-400 text-xs">{s.sector ?? '—'}</td>
                    <td className="py-2 pr-3 text-right font-mono text-slate-300">{fmtPrice(s.currentPrice)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-slate-300">
                      {s.gatesPassed == null ? '—' : `${s.gatesPassed}/8`}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-slate-300">
                      {s.compositeScore ?? '—'}
                    </td>
                    <td className="py-2 pr-3 text-slate-300">{s.scanVerdict ?? '—'}</td>
                    <td className="py-2 pr-3">
                      {s.signal ? (
                        <span className={`text-xs font-semibold badge-${s.signal.verdict?.toLowerCase()}`}>
                          {s.signal.verdict}
                        </span>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2">
                      <StageBadge stage={s.droppedAtStage ?? 'NOT_SCANNED'} reason={s.reason} />
                    </td>
                    <td className="py-2 text-right">
                      <Link to={`/analysis/${s.symbol}`} className="text-[11px] text-accent hover:underline">Analyze</Link>
                    </td>
                  </tr>
                ))}
                {visibleStocks.length === 0 && (
                  <tr><td colSpan={9} className="py-6 text-center text-slate-500 text-sm">No stocks match.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Scan history */}
          <ScanHistory history={history} />
        </>
      )}
    </div>
  );
};

export default ScanResults;
