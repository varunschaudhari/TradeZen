/**
 * @file Performance.jsx
 * @description Performance analytics — win rate, P&L charts, trade history table
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-15
 */

import React, { useState, useEffect, useCallback } from 'react';
import { performanceApi, tradesApi } from '../services/api.js';
import PerformanceChart from '../components/PerformanceChart.jsx';
import { formatCurrency, formatPercent, formatDateTime } from '../utils/formatters.js';

const StatCard = ({ label, value, sub, color }) => (
  <div className="card text-center">
    <p className="text-slate-400 text-xs mb-1">{label}</p>
    <p className={`text-2xl font-mono font-bold ${color ?? 'text-slate-100'}`}>{value}</p>
    {sub && <p className="text-slate-500 text-xs mt-1">{sub}</p>}
  </div>
);

const EXIT_LABELS = {
  TARGET1: 'T1 hit',
  TARGET2: 'T2 hit',
  STOPLOSS: 'SL hit',
  MANUAL: 'Manual',
  EARNINGS: 'Earnings',
};

const Performance = () => {
  const [perf, setPerf] = useState(null);
  const [monthlyData, setMonthlyData] = useState([]);
  const [capitalData, setCapitalData] = useState([]);
  const [closedTrades, setClosedTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [perfRes, histRes, tradesRes] = await Promise.all([
        performanceApi.get(),
        performanceApi.getHistory(),
        tradesApi.getAll(),
      ]);

      setPerf(perfRes.data);

      const history = histRes.data?.monthly ?? [];
      // Map to chart format expected by PerformanceChart
      setMonthlyData(history.map((m) => ({ month: m.label, pnl: m.pnl })));
      setCapitalData(history.map((m) => ({ date: m.label, capital: m.capital })));

      // Filter and sort closed trades newest-first
      const all = tradesRes.data ?? [];
      setClosedTrades(
        all.filter((t) => t.status === 'CLOSED').sort((a, b) => new Date(b.exitDate) - new Date(a.exitDate))
      );

      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-100">Performance</h1>
        <button onClick={load} className="btn-primary text-xs px-3 py-1">Refresh</button>
      </div>

      {error && (
        <div className="card border-red-500/30 bg-red-500/10 text-red-400">{error}</div>
      )}

      {/* Honest-status banner — paper/research tool, edge not yet validated */}
      <div className="card border-l-4 border-l-wait bg-wait/[0.06] flex items-start gap-3 text-sm">
        <span className="text-wait text-lg leading-none mt-0.5">⚠</span>
        <div>
          <p className="font-semibold text-slate-200">Paper mode · edge not yet validated</p>
          <p className="text-slate-400 mt-0.5">
            {(perf?.totalTrades ?? 0) < 20
              ? `Only ${perf?.totalTrades ?? 0} closed trade${(perf?.totalTrades ?? 0) === 1 ? '' : 's'} — these stats are not yet statistically meaningful. `
              : ''}
            Backtesting found no robust, cost-surviving edge in price signals, and confidence/scores
            aren&rsquo;t yet calibrated. Treat this as a research record — not proof of profitability —
            until the weekly calibration review and the go-live gate pass.
          </p>
        </div>
      </div>

      {/* Key stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Win Rate"
          value={perf ? `${perf.winRate.toFixed(1)}%` : '—'}
          sub={`${perf?.winningTrades ?? 0}W / ${perf?.losingTrades ?? 0}L`}
          color={(perf?.winRate ?? 0) >= 50 ? 'text-bull' : 'text-bear'}
        />
        <StatCard
          label="Total P&L"
          value={perf ? formatCurrency(perf.totalPnl) : '—'}
          sub={perf ? formatPercent(perf.totalPnlPct) : null}
          color={(perf?.totalPnl ?? 0) >= 0 ? 'text-bull' : 'text-bear'}
        />
        <StatCard
          label="Avg R:R"
          value={perf ? `${perf.avgRR.toFixed(1)}:1` : '—'}
          color="text-blue-400"
        />
        <StatCard
          label="Max Drawdown"
          value={perf ? formatPercent(perf.maxDrawdown) : '—'}
          color="text-bear"
        />
      </div>

      {/* Secondary stats */}
      {perf && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Open Positions" value={perf.openPositions} />
          <StatCard
            label="Capital Deployed"
            value={formatCurrency(perf.totalDeployed)}
            sub={`of ${formatCurrency(perf.capital)}`}
          />
          <StatCard
            label="Unrealized P&L"
            value={formatCurrency(perf.unrealizedPnl)}
            color={(perf.unrealizedPnl ?? 0) >= 0 ? 'text-bull' : 'text-bear'}
          />
          <StatCard
            label="Claude API Cost"
            value={`₹${perf.claudeApiCostTotal?.toFixed(2) ?? '0.00'}`}
            color="text-purple-400"
          />
        </div>
      )}

      {/* Charts */}
      <PerformanceChart monthlyData={monthlyData} capitalData={capitalData} />

      {/* Trade history table */}
      <div className="card">
        <h3 className="text-sm font-semibold text-slate-300 mb-4">
          Trade History ({closedTrades.length} closed)
        </h3>

        {closedTrades.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-4xl mb-3">📈</p>
            <p className="text-slate-400 font-medium">No closed trades yet</p>
            <p className="text-slate-500 text-sm mt-1 max-w-md mx-auto">
              Logged trades show up here once closed. As this paper record grows, the stats above
              and the weekly calibration review become statistically meaningful — that&rsquo;s the
              data the system needs to actually improve.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700">
                  <th className="pb-2 pr-4">Symbol</th>
                  <th className="pb-2 pr-4">Entry</th>
                  <th className="pb-2 pr-4">Exit</th>
                  <th className="pb-2 pr-4">Shares</th>
                  <th className="pb-2 pr-4">P&L</th>
                  <th className="pb-2 pr-4">P&L %</th>
                  <th className="pb-2 pr-4">R:R</th>
                  <th className="pb-2 pr-4">Reason</th>
                  <th className="pb-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {closedTrades.map((t) => {
                  const pnl = t.realizedPnl ?? 0;
                  const color = pnl >= 0 ? 'text-bull' : 'text-bear';
                  return (
                    <tr key={t._id} className="border-b border-slate-800 hover:bg-slate-800/40">
                      <td className="py-2 pr-4 font-mono font-semibold">{t.symbol}</td>
                      <td className="py-2 pr-4 font-mono">{formatCurrency(t.entryPrice)}</td>
                      <td className="py-2 pr-4 font-mono">{formatCurrency(t.exitPrice)}</td>
                      <td className="py-2 pr-4">{t.shares}</td>
                      <td className={`py-2 pr-4 font-mono font-semibold ${color}`}>
                        {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
                      </td>
                      <td className={`py-2 pr-4 ${color}`}>
                        {formatPercent(t.realizedPnlPct ?? 0)}
                      </td>
                      <td className="py-2 pr-4 text-blue-400">
                        {t.riskReward ? `${t.riskReward.toFixed(1)}:1` : '—'}
                      </td>
                      <td className="py-2 pr-4">
                        <span
                          className={`px-1.5 py-0.5 rounded text-xs ${
                            t.exitReason === 'TARGET1' || t.exitReason === 'TARGET2'
                              ? 'bg-bull/20 text-bull'
                              : t.exitReason === 'STOPLOSS'
                              ? 'bg-bear/20 text-bear'
                              : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          {EXIT_LABELS[t.exitReason] ?? t.exitReason ?? '—'}
                        </span>
                      </td>
                      <td className="py-2 text-slate-500">
                        {t.exitDate ? formatDateTime(t.exitDate) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Performance;
