/**
 * @file RiskAttribution.jsx
 * @description Where the P&L actually comes from — equity curve with drawdown,
 *   R-multiple distribution, P&L by sector/exit-reason/symbol, sector concentration,
 *   and win-rate breakdowns by sector and entry day.
 * @author SwingTrader AI Team
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { tradesApi } from '../services/api.js';
import EquityCurveChart from '../components/EquityCurveChart.jsx';
import RMultipleBreakdown from '../components/RMultipleBreakdown.jsx';
import PnlByDimension from '../components/PnlByDimension.jsx';
import SectorDonut from '../components/SectorDonut.jsx';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const RiskAttribution = () => {
  const [closedTrades, setClosedTrades] = useState([]);
  const [sectorData, setSectorData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tradesRes, sectorRes] = await Promise.all([
        tradesApi.getAll({ status: 'CLOSED' }),
        tradesApi.getSectorConcentration().catch(() => null),
      ]);
      setClosedTrades(tradesRes.data ?? []);
      setSectorData(sectorRes?.data ?? null);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── Win rate by sector — uses each trade's own sector field, recorded at open time ── */
  const sectorStats = useMemo(() => {
    const byS = {};
    closedTrades.forEach((t) => {
      const s = t.sector ?? 'Unclassified';
      if (!byS[s]) byS[s] = { wins: 0, losses: 0 };
      if ((t.realizedPnl ?? 0) > 0) byS[s].wins++;
      else byS[s].losses++;
    });
    return Object.entries(byS)
      .map(([sector, { wins, losses }]) => ({
        sector, wins, losses, total: wins + losses, winRate: wins / (wins + losses),
      }))
      .sort((a, b) => b.total - a.total);
  }, [closedTrades]);

  /* ── Win rate by entry day of week ──────────────────────────────────────── */
  const dayStats = useMemo(() => {
    const byD = {};
    closedTrades.forEach((t) => {
      if (!t.entryDate) return;
      const d = new Date(t.entryDate).getUTCDay(); // NSE entries fall on the same UTC day as IST
      if (d === 0 || d === 6) return;
      if (!byD[d]) byD[d] = { wins: 0, losses: 0 };
      if ((t.realizedPnl ?? 0) > 0) byD[d].wins++;
      else byD[d].losses++;
    });
    return [1, 2, 3, 4, 5].map((d) => ({
      day: WEEKDAY_LABELS[d - 1],
      wins: byD[d]?.wins ?? 0,
      losses: byD[d]?.losses ?? 0,
      total: (byD[d]?.wins ?? 0) + (byD[d]?.losses ?? 0),
      winRate: byD[d] ? byD[d].wins / (byD[d].wins + byD[d].losses) : null,
    }));
  }, [closedTrades]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface p-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-100">Risk &amp; Attribution</h1>
        <button onClick={load} className="btn-primary text-xs px-3 py-1">Refresh</button>
      </div>

      {error && <div className="card border-red-500/30 bg-red-500/10 text-red-400">{error}</div>}

      {closedTrades.length === 0 ? (
        <div className="card text-center py-14">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-slate-400 font-medium">No closed trades yet</p>
          <p className="text-slate-500 text-sm mt-1 max-w-md mx-auto">
            Equity curve, R-multiples, and P&amp;L attribution build up here once trades start closing.
          </p>
        </div>
      ) : (
        <>
          <EquityCurveChart trades={closedTrades} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RMultipleBreakdown trades={closedTrades} />
            <PnlByDimension trades={closedTrades} />
          </div>

          {sectorData?.sectors?.length > 0 && <SectorDonut data={sectorData} />}

          {closedTrades.length >= 3 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {sectorStats.length > 0 && (
                <div className="card">
                  <h3 className="text-sm font-semibold text-slate-300 mb-3">Win Rate by Sector</h3>
                  <div className="space-y-2.5">
                    {sectorStats.map(({ sector, wins, losses, winRate }) => (
                      <div key={sector}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-slate-300 font-medium truncate max-w-[140px]">{sector}</span>
                          <span className="flex items-center gap-2 text-slate-500 shrink-0">
                            <span className="font-mono text-slate-400">{wins}W / {losses}L</span>
                            <span className={`font-semibold font-mono ${winRate >= 0.5 ? 'text-bull' : 'text-bear'}`}>
                              {(winRate * 100).toFixed(0)}%
                            </span>
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-700/60 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${winRate >= 0.5 ? 'bg-bull' : 'bg-bear'}`}
                            style={{ width: `${winRate * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="card">
                <h3 className="text-sm font-semibold text-slate-300 mb-3">Win Rate by Entry Day</h3>
                <div className="space-y-2.5">
                  {dayStats.map(({ day, wins, losses, total, winRate }) => (
                    <div key={day}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-slate-300 font-medium w-8">{day}</span>
                        <span className="flex items-center gap-2 text-slate-500 shrink-0">
                          {total === 0 ? (
                            <span className="text-slate-600 font-mono">no data</span>
                          ) : (
                            <>
                              <span className="font-mono text-slate-400">{wins}W / {losses}L</span>
                              <span className={`font-semibold font-mono ${winRate >= 0.5 ? 'text-bull' : 'text-bear'}`}>
                                {(winRate * 100).toFixed(0)}%
                              </span>
                            </>
                          )}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-700/60 overflow-hidden">
                        {total > 0 && (
                          <div
                            className={`h-full rounded-full transition-all ${winRate >= 0.5 ? 'bg-bull' : 'bg-bear'}`}
                            style={{ width: `${(winRate ?? 0) * 100}%` }}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default RiskAttribution;
