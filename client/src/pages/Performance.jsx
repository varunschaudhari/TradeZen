/**
 * @file Performance.jsx
 * @description Performance analytics — win rate, P&L charts, trade history table
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-15
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { performanceApi, tradesApi, watchlistApi } from '../services/api.js';
import PerformanceChart from '../components/PerformanceChart.jsx';
import { formatCurrency, formatPercent, formatDateTime } from '../utils/formatters.js';
import { downloadCSV, fmtDateCSV } from '../utils/csvExport.js';

/* ─── P&L Calendar ────────────────────────────────────────────────────────── */
const CAL_CELL = 12;
const CAL_GAP  = 3;
const CAL_STEP = CAL_CELL + CAL_GAP;

const PnlCalendar = ({ trades }) => {
  const daily = useMemo(() => {
    const map = {};
    trades.forEach((t) => {
      if (!t.exitDate) return;
      const d = new Date(t.exitDate).toISOString().slice(0, 10);
      map[d] = (map[d] ?? 0) + (t.realizedPnl ?? 0);
    });
    return map;
  }, [trades]);

  const { weeks, monthLabels, maxAbs } = useMemo(() => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const start = new Date(today);
    start.setDate(start.getDate() - 52 * 7);
    start.setDate(start.getDate() - start.getDay()); // align to Sunday

    const weeks = [];
    const monthLabels = [];
    let lastMonth = -1;
    const cur = new Date(start);

    while (cur <= today) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        if (d === 0 && cur.getMonth() !== lastMonth) {
          monthLabels.push({
            weekIdx: weeks.length,
            label: cur.toLocaleString('en-IN', { month: 'short' }),
          });
          lastMonth = cur.getMonth();
        }
        const dateStr = cur.toISOString().slice(0, 10);
        week.push({ date: dateStr, pnl: daily[dateStr] ?? null, future: cur > today });
        cur.setDate(cur.getDate() + 1);
      }
      weeks.push(week);
    }

    const vals = Object.values(daily).map(Math.abs);
    return { weeks, monthLabels, maxAbs: vals.length ? Math.max(...vals) : 1 };
  }, [daily]);

  const cellBg = (cell) => {
    if (cell.future || cell.pnl === null) return '#1e293b';
    if (cell.pnl === 0) return '#334155';
    const intensity = Math.min(Math.abs(cell.pnl) / maxAbs, 1);
    const alpha = (0.2 + intensity * 0.8).toFixed(2);
    return cell.pnl > 0 ? `rgba(34,197,94,${alpha})` : `rgba(239,68,68,${alpha})`;
  };

  const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-slate-300 mb-4">P&amp;L Calendar — 52 weeks</h3>
      <div className="overflow-x-auto">
        <div className="min-w-max">
          {/* Month labels */}
          <div className="relative h-4 mb-1" style={{ marginLeft: 22 }}>
            {monthLabels.map(({ weekIdx, label }) => (
              <span
                key={label + weekIdx}
                className="absolute text-[10px] text-slate-500 leading-none"
                style={{ left: weekIdx * CAL_STEP }}
              >
                {label}
              </span>
            ))}
          </div>

          {/* Grid */}
          <div className="flex">
            {/* Day labels */}
            <div className="flex flex-col mr-1" style={{ gap: CAL_GAP }}>
              {DAY_LABELS.map((d, i) => (
                <div
                  key={i}
                  className="text-[9px] text-slate-600 flex items-center justify-end"
                  style={{ height: CAL_CELL, width: 14 }}
                >
                  {i % 2 === 1 ? d : ''}
                </div>
              ))}
            </div>

            {/* Week columns */}
            <div className="flex" style={{ gap: CAL_GAP }}>
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col" style={{ gap: CAL_GAP }}>
                  {week.map((cell, di) => (
                    <div
                      key={di}
                      style={{
                        width: CAL_CELL,
                        height: CAL_CELL,
                        background: cellBg(cell),
                        borderRadius: 2,
                        cursor: 'default',
                      }}
                      title={
                        cell.pnl !== null
                          ? `${cell.date}: ${cell.pnl >= 0 ? '+' : ''}₹${Math.abs(cell.pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
                          : cell.date
                      }
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-1.5 mt-3" style={{ marginLeft: 22 }}>
            <span className="text-[10px] text-slate-600 mr-1">Less</span>
            {[0.2, 0.4, 0.6, 0.8, 1.0].map((a) => (
              <div
                key={a}
                style={{ width: 10, height: 10, borderRadius: 2, background: `rgba(34,197,94,${a})` }}
              />
            ))}
            <span className="text-[10px] text-slate-600 mx-2">Profit — Loss</span>
            {[0.2, 0.4, 0.6, 0.8, 1.0].map((a) => (
              <div
                key={a}
                style={{ width: 10, height: 10, borderRadius: 2, background: `rgba(239,68,68,${a})` }}
              />
            ))}
            <span className="text-[10px] text-slate-600 ml-1">More</span>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ─── Sector Donut ────────────────────────────────────────────────────────── */
const SECTOR_PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444', '#84cc16', '#f97316'];

const SectorDonut = ({ data }) => {
  const sectors = data?.sectors ?? [];
  if (!sectors.length) return null;

  const R = 56, r = 34, cx = 70, cy = 70;
  const totalPct = sectors.reduce((s, d) => s + d.pct, 0) || 100;
  const arcs = [];
  let angle = -90;

  sectors.forEach((sec, i) => {
    const sweep = (sec.pct / totalPct) * 360;
    const end   = angle + sweep;
    const rad   = (deg) => (deg * Math.PI) / 180;
    const x1 = cx + R * Math.cos(rad(angle));
    const y1 = cy + R * Math.sin(rad(angle));
    const x2 = cx + R * Math.cos(rad(end));
    const y2 = cy + R * Math.sin(rad(end));
    const ix1 = cx + r * Math.cos(rad(angle));
    const iy1 = cy + r * Math.sin(rad(angle));
    const ix2 = cx + r * Math.cos(rad(end));
    const iy2 = cy + r * Math.sin(rad(end));
    const large = sweep > 180 ? 1 : 0;
    const path = [
      `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
      `A ${R} ${R} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
      `L ${ix2.toFixed(2)} ${iy2.toFixed(2)}`,
      `A ${r} ${r} 0 ${large} 0 ${ix1.toFixed(2)} ${iy1.toFixed(2)}`,
      'Z',
    ].join(' ');
    arcs.push({ path, color: SECTOR_PALETTE[i % SECTOR_PALETTE.length], sec });
    angle = end;
  });

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-slate-300 mb-3">Sector Concentration — Open Positions</h3>
      {data.hasWarning && (
        <div className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-3 py-1.5 mb-3">
          High concentration — one sector exceeds {data.warningThreshold}% of deployed capital
        </div>
      )}
      <div className="flex flex-wrap gap-6 items-center">
        <svg width="140" height="140" viewBox="0 0 140 140" className="flex-shrink-0">
          {arcs.map((arc, i) => (
            <path key={i} d={arc.path} fill={arc.color} fillOpacity={0.85}>
              <title>{arc.sec.sector}: {arc.sec.pct.toFixed(1)}%</title>
            </path>
          ))}
          <text x="70" y="66" textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="monospace">DEPLOYED</text>
          <text x="70" y="80" textAnchor="middle" fill="#e2e8f0" fontSize="12" fontWeight="700" fontFamily="monospace">
            {data.totalDeployed >= 100000
              ? `₹${(data.totalDeployed / 100000).toFixed(1)}L`
              : `₹${(data.totalDeployed / 1000).toFixed(0)}K`}
          </text>
        </svg>
        <div className="flex flex-col gap-2 min-w-0 flex-1">
          {arcs.map((arc, i) => (
            <div key={i} className="flex items-center gap-2 text-xs min-w-0">
              <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: arc.color }} />
              <span className="text-slate-400 truncate flex-1">{arc.sec.sector}</span>
              <span className="text-slate-300 font-mono font-semibold">{arc.sec.pct.toFixed(1)}%</span>
              <span className="text-slate-500 font-mono text-[10px]">{formatCurrency(arc.sec.deployed)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const COLOR_CARD_MAP = {
  'text-emerald-400': 'card-bull',
  'text-red-400':     'card-bear',
  'text-amber-400':   'card-wait',
  'text-blue-400':    'card-accent',
};

const StatCard = ({ label, value, sub, color }) => {
  const cardVariant = COLOR_CARD_MAP[color] ?? '';
  return (
    <div className={`card text-center ${cardVariant}`}>
      <p className="text-slate-400 text-xs mb-1">{label}</p>
      <p className={`text-2xl font-mono font-bold ${color ?? 'text-slate-100'}`}>{value}</p>
      {sub && <p className="text-slate-500 text-xs mt-1">{sub}</p>}
    </div>
  );
};

const EXIT_LABELS = {
  TARGET1: 'T1 hit',
  TARGET2: 'T2 hit',
  STOPLOSS: 'SL hit',
  MANUAL: 'Manual',
  EARNINGS: 'Earnings',
};

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const Performance = () => {
  const [perf,          setPerf]          = useState(null);
  const [monthlyData,   setMonthlyData]   = useState([]);
  const [capitalData,   setCapitalData]   = useState([]);
  const [benchmarkData, setBenchmarkData] = useState([]);
  const [closedTrades,  setClosedTrades]  = useState([]);
  const [sectorData,    setSectorData]    = useState(null);
  const [watchlist,     setWatchlist]     = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [perfRes, histRes, tradesRes, bmRes, sectorRes, wlRes] = await Promise.all([
        performanceApi.get(),
        performanceApi.getHistory(),
        tradesApi.getAll(),
        performanceApi.getBenchmark().catch(() => null),
        tradesApi.getSectorConcentration().catch(() => null),
        watchlistApi.get().catch(() => null),
      ]);

      setPerf(perfRes.data);

      const history = histRes.data?.monthly ?? [];
      setMonthlyData(history.map((m) => ({ month: m.label, pnl: m.pnl })));
      setCapitalData(history.map((m) => ({ date: m.label, capital: m.capital })));
      setBenchmarkData(bmRes?.data?.months ?? []);

      const all = tradesRes.data ?? [];
      setClosedTrades(
        all.filter((t) => t.status === 'CLOSED').sort((a, b) => new Date(b.exitDate) - new Date(a.exitDate))
      );

      setSectorData(sectorRes?.data ?? null);
      setWatchlist(wlRes?.data ?? []);

      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── CSV export handlers ──────────────────────────────────────────────────── */
  const exportTrades = useCallback(() => {
    const headers = ['Symbol','Entry Date','Exit Date','Entry Price','Exit Price','Shares','Capital Deployed','Realized P&L','P&L %','R:R','Exit Reason'];
    const rows = closedTrades.map((t) => [
      t.symbol,
      fmtDateCSV(t.entryDate ?? t.createdAt),
      fmtDateCSV(t.exitDate),
      t.entryPrice ?? '',
      t.exitPrice ?? '',
      t.shares ?? '',
      t.capitalDeployed ?? '',
      t.realizedPnl ?? '',
      t.realizedPnlPct != null ? `${t.realizedPnlPct.toFixed(2)}%` : '',
      t.riskReward != null ? `${t.riskReward.toFixed(2)}` : '',
      t.exitReason ?? '',
    ]);
    downloadCSV(`tradezen-trades-${new Date().toISOString().slice(0,10)}.csv`, rows, headers);
  }, [closedTrades]);

  const exportMonthly = useCallback(() => {
    const headers = ['Month','P&L (₹)','Trades','Capital (₹)'];
    const rows = monthlyData.map((m, i) => [
      m.month,
      m.pnl ?? '',
      capitalData[i]?.trades ?? '',
      capitalData[i]?.capital ?? '',
    ]);
    downloadCSV(`tradezen-monthly-${new Date().toISOString().slice(0,10)}.csv`, rows, headers);
  }, [monthlyData, capitalData]);

  useEffect(() => { load(); }, [load]);

  /* ── Win rate by sector ─────────────────────────────────────────────────── */
  const sectorStats = useMemo(() => {
    const sectorMap = Object.fromEntries(watchlist.map((w) => [w.symbol, w.sector ?? 'Unknown']));
    const byS = {};
    closedTrades.forEach((t) => {
      const s = sectorMap[t.symbol] ?? 'Unknown';
      if (!byS[s]) byS[s] = { wins: 0, losses: 0 };
      if ((t.realizedPnl ?? 0) > 0) byS[s].wins++;
      else byS[s].losses++;
    });
    return Object.entries(byS)
      .map(([sector, { wins, losses }]) => ({
        sector,
        wins,
        losses,
        total: wins + losses,
        winRate: wins / (wins + losses),
      }))
      .sort((a, b) => b.total - a.total);
  }, [closedTrades, watchlist]);

  /* ── Win rate by day of week ────────────────────────────────────────────── */
  const dayStats = useMemo(() => {
    const byD = {};
    closedTrades.forEach((t) => {
      if (!t.entryDate) return;
      // entryDate is stored in UTC; NSE entries are 9:15–15:30 IST (3:45–10:00 UTC) → same UTC day as IST day
      const d = new Date(t.entryDate).getUTCDay(); // 0=Sun ... 6=Sat
      if (d === 0 || d === 6) return; // skip weekends
      if (!byD[d]) byD[d] = { wins: 0, losses: 0 };
      if ((t.realizedPnl ?? 0) > 0) byD[d].wins++;
      else byD[d].losses++;
    });
    return [1, 2, 3, 4, 5].map((d) => ({
      day: WEEKDAY_LABELS[d - 1],
      wins:    byD[d]?.wins    ?? 0,
      losses:  byD[d]?.losses  ?? 0,
      total:   (byD[d]?.wins ?? 0) + (byD[d]?.losses ?? 0),
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
        <h1 className="text-xl font-bold text-slate-100">Performance</h1>
        <div className="flex items-center gap-2">
          {closedTrades.length > 0 && (
            <button onClick={exportTrades} className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5">
              ↓ Export trades
            </button>
          )}
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

      {/* Charts */}
      <PerformanceChart monthlyData={monthlyData} capitalData={capitalData} benchmarkData={benchmarkData} />

      {/* P&L Calendar + Sector Donut */}
      {closedTrades.length > 0 && <PnlCalendar trades={closedTrades} />}

      {sectorData?.sectors?.length > 0 && (
        <SectorDonut data={sectorData} />
      )}

      {/* Win rate breakdowns — only shown once there are enough closed trades */}
      {closedTrades.length >= 3 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* By sector */}
          {sectorStats.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">Win Rate by Sector</h3>
              <div className="space-y-2.5">
                {sectorStats.map(({ sector, wins, losses, total, winRate }) => (
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

          {/* By day of week */}
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

      {/* Trade history table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-300">
            Trade History ({closedTrades.length} closed)
          </h3>
          {closedTrades.length > 0 && (
            <button onClick={exportTrades} className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1">
              ↓ CSV
            </button>
          )}
        </div>

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
