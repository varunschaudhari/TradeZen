/**
 * @file ScanResults.jsx
 * @description Scan visibility page — shows the latest scan-cycle snapshot: the funnel
 *   (universe → screened → analyzed → gates → selected), screen-rejection breakdown, and
 *   a grid of every analyzed stock with its price, gates, composite score, verdict, and the
 *   stage it dropped out at. Auto-refreshes on scan:complete via WebSocket.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import useSocket from '../hooks/useSocket.js';
import { scanApi } from '../services/api.js';
import { SOCKET_EVENTS, MARKET_MODE_COLORS, SCAN_STAGE_STYLES } from '../utils/constants.js';
import { timeAgo } from '../utils/formatters.js';

const FUNNEL_STAGES = [
  { key: 'universe', label: 'Universe' },
  { key: 'screened', label: 'Screened' },
  { key: 'analyzed', label: 'Analyzed' },
  { key: 'gatePassed', label: 'Passed Gates' },
  { key: 'selected', label: 'To Claude' },
];

const fmtPrice = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`);

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

const ScanResults = () => {
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stageFilter, setStageFilter] = useState('ALL');
  const { subscribe } = useSocket();

  const fetchLatest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await scanApi.getLatest();
      setScan(res.data ?? null);
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

  // Sort scanned stocks: analyzed (higher score) first, screened-out last
  const stocks = useMemo(
    () => [...(scan?.stocks ?? [])].sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0)),
    [scan]
  );

  // Counts per drop stage (for the filter pills)
  const stageCounts = useMemo(() => {
    const counts = {};
    for (const s of stocks) counts[s.droppedAtStage] = (counts[s.droppedAtStage] ?? 0) + 1;
    return counts;
  }, [stocks]);

  const visibleStocks = useMemo(
    () => (stageFilter === 'ALL' ? stocks : stocks.filter((s) => s.droppedAtStage === stageFilter)),
    [stocks, stageFilter]
  );

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
              <span className="text-slate-500">Claude calls: </span>
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
          </div>

          {/* Scanned stocks table */}
          <div className="card overflow-x-auto">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <p className="text-xs text-slate-500">Scanned stocks ({stocks.length})</p>
              <div className="flex flex-wrap gap-1.5 ml-auto">
                {['ALL', 'SIGNAL', 'CLAUDE', 'RANKED_OUT', 'GATES', 'ANALYZE_CAP', 'SCREEN'].map(
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
              </div>
            </div>
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-[11px] text-slate-500 border-b border-slate-700">
                  <th className="pb-2 pr-3">Symbol</th>
                  <th className="pb-2 pr-3 text-right">Price</th>
                  <th className="pb-2 pr-3 text-right">Gates</th>
                  <th className="pb-2 pr-3 text-right">Score</th>
                  <th className="pb-2 pr-3">Verdict</th>
                  <th className="pb-2">Stage</th>
                </tr>
              </thead>
              <tbody>
                {visibleStocks.map((s) => (
                  <tr key={s.symbol} className="border-b border-slate-800 last:border-0">
                    <td className="py-2 pr-3 font-medium text-slate-200">{s.symbol}</td>
                    <td className="py-2 pr-3 text-right font-mono text-slate-300">{fmtPrice(s.currentPrice)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-slate-300">
                      {s.gatesPassed == null ? '—' : `${s.gatesPassed}/8`}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-slate-300">
                      {s.compositeScore ?? '—'}
                    </td>
                    <td className="py-2 pr-3 text-slate-300">{s.verdict ?? '—'}</td>
                    <td className="py-2">
                      <StageBadge stage={s.droppedAtStage} reason={s.reason} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default ScanResults;
