/**
 * @file Performance.jsx
 * @description Performance overview — headline stats, monthly P&L, capital growth vs
 *   Nifty, and the P&L calendar. Deeper reports live on their own pages: Trade Ledger
 *   (/trade-ledger), Risk & Attribution (/risk-attribution), Go-Live Evidence (/go-live-evidence).
 * @author SwingTrader AI Team
 */

import React, { useState, useEffect, useCallback } from 'react';
import { performanceApi, tradesApi } from '../services/api.js';
import PerformanceChart from '../components/PerformanceChart.jsx';
import PnlCalendar from '../components/PnlCalendar.jsx';
import DailyPnlCard from '../components/DailyPnlCard.jsx';
import StatCard from '../components/StatCard.jsx';
import { formatCurrency, formatPercent } from '../utils/formatters.js';
import { downloadCSV } from '../utils/csvExport.js';

const Performance = () => {
  const [perf,          setPerf]          = useState(null);
  const [monthlyData,   setMonthlyData]   = useState([]);
  const [capitalData,   setCapitalData]   = useState([]);
  const [benchmarkData, setBenchmarkData] = useState([]);
  const [closedTrades,  setClosedTrades]  = useState([]);
  const [dailyPnl,      setDailyPnl]      = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [perfRes, histRes, tradesRes, bmRes, dailyRes] = await Promise.all([
        performanceApi.get(),
        performanceApi.getHistory(),
        tradesApi.getAll({ status: 'CLOSED' }),
        performanceApi.getBenchmark().catch(() => null),
        performanceApi.getDaily().catch(() => null),
      ]);

      setPerf(perfRes.data);

      const history = histRes.data?.monthly ?? [];
      setMonthlyData(history.map((m) => ({ month: m.label, pnl: m.pnl })));
      setCapitalData(history.map((m) => ({ date: m.label, capital: m.capital })));
      setBenchmarkData(bmRes?.data?.months ?? []);

      setClosedTrades((tradesRes.data ?? []).sort((a, b) => new Date(b.exitDate) - new Date(a.exitDate)));
      setDailyPnl(dailyRes?.data ?? null);

      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const exportMonthly = () => {
    const headers = ['Month', 'P&L (₹)', 'Trades', 'Capital (₹)'];
    const rows = monthlyData.map((m, i) => [
      m.month,
      m.pnl ?? '',
      capitalData[i]?.trades ?? '',
      capitalData[i]?.capital ?? '',
    ]);
    downloadCSV(`tradezen-monthly-${new Date().toISOString().slice(0, 10)}.csv`, rows, headers);
  };

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
        <h1 className="text-xl font-bold text-slate-100">Performance</h1>
        <div className="flex items-center gap-2">
          {monthlyData.length > 0 && (
            <button onClick={exportMonthly} className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5">
              ↓ Export monthly
            </button>
          )}
          <button onClick={load} className="btn-primary text-xs px-3 py-1">Refresh</button>
        </div>
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

      {/* Daily P&L — swing vs intraday, net of costs */}
      <DailyPnlCard report={dailyPnl} />

      {/* Charts */}
      <PerformanceChart monthlyData={monthlyData} capitalData={capitalData} benchmarkData={benchmarkData} />

      {/* P&L Calendar */}
      {closedTrades.length > 0 && <PnlCalendar trades={closedTrades} />}
    </div>
  );
};

export default Performance;
