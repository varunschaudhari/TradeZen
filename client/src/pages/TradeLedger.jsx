/**
 * @file TradeLedger.jsx
 * @description Full closed-trade ledger — filterable, sortable, exportable. The literal
 *   "where do I see closed trades" report, split out of Performance.jsx so it isn't buried
 *   under six other cards' worth of scroll.
 * @author SwingTrader AI Team
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { tradesApi } from '../services/api.js';
import { formatCurrency, formatPercent, formatDateTime } from '../utils/formatters.js';
import { downloadCSV, fmtDateCSV } from '../utils/csvExport.js';

const EXIT_LABELS = {
  TARGET1: 'T1 hit',
  TARGET2: 'T2 hit',
  STOPLOSS: 'SL hit',
  MANUAL: 'Manual',
  EARNINGS: 'Earnings',
  TIME_EXIT: 'Time exit (21d)',
};

const TradeLedger = () => {
  const [closedTrades, setClosedTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState({ symbol: '', exitReason: '', from: '', to: '' });
  const [sort, setSort] = useState({ key: 'exitDate', dir: 'desc' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await tradesApi.getAll({ status: 'CLOSED' });
      setClosedTrades(res.data ?? []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));

  const displayedTrades = useMemo(() => {
    const { symbol, exitReason, from, to } = filter;
    const fromMs = from ? new Date(from).getTime() : null;
    const toMs = to ? new Date(to).setHours(23, 59, 59, 999) : null;
    const filtered = closedTrades.filter((t) => {
      if (symbol && !t.symbol?.toLowerCase().includes(symbol.toLowerCase())) return false;
      if (exitReason && t.exitReason !== exitReason) return false;
      const exitMs = t.exitDate ? new Date(t.exitDate).getTime() : null;
      if (fromMs != null && (exitMs == null || exitMs < fromMs)) return false;
      if (toMs != null && (exitMs == null || exitMs > toMs)) return false;
      return true;
    });
    const val = (t) => {
      switch (sort.key) {
        case 'netPnl': return t.netPnl ?? t.realizedPnl ?? 0;
        case 'pnlPct': return t.realizedPnlPct ?? 0;
        case 'hold':
          return t.entryDate && t.exitDate ? new Date(t.exitDate) - new Date(t.entryDate) : 0;
        case 'exitDate':
        default:
          return t.exitDate ? new Date(t.exitDate).getTime() : 0;
      }
    };
    const dirMult = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => (val(a) - val(b)) * dirMult);
  }, [closedTrades, filter, sort]);

  const activeFilterCount =
    (filter.symbol ? 1 : 0) + (filter.exitReason ? 1 : 0) + (filter.from ? 1 : 0) + (filter.to ? 1 : 0);

  const exportTrades = () => {
    const headers = ['Symbol', 'Entry Date', 'Exit Date', 'Entry Price', 'Exit Price', 'Shares', 'Capital Deployed', 'Gross P&L', 'Est Costs', 'Net P&L', 'P&L %', 'R:R', 'Exit Reason'];
    const rows = displayedTrades.map((t) => [
      t.symbol,
      fmtDateCSV(t.entryDate ?? t.createdAt),
      fmtDateCSV(t.exitDate),
      t.entryPrice ?? '',
      t.exitPrice ?? '',
      t.shares ?? '',
      t.capitalDeployed ?? '',
      t.realizedPnl ?? '',
      t.estCosts ?? '',
      t.netPnl ?? '',
      t.realizedPnlPct != null ? `${t.realizedPnlPct.toFixed(2)}%` : '',
      t.riskReward != null ? `${t.riskReward.toFixed(2)}` : '',
      t.exitReason ?? '',
    ]);
    downloadCSV(`tradezen-trades-${new Date().toISOString().slice(0, 10)}.csv`, rows, headers);
  };

  const SortHeader = ({ sortKey, children, className = '' }) => (
    <th
      className={`pb-2 pr-4 cursor-pointer select-none hover:text-slate-200 ${className}`}
      onClick={() => toggleSort(sortKey)}
    >
      {children}
      {sort.key === sortKey && <span className="ml-1 text-accent">{sort.dir === 'desc' ? '↓' : '↑'}</span>}
    </th>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
      </div>
    );
  }

  const netStrip = (() => {
    if (displayedTrades.length === 0) return null;
    const gross = displayedTrades.reduce((s, t) => s + (t.realizedPnl ?? 0), 0);
    const costs = displayedTrades.reduce((s, t) => s + (t.estCosts ?? 0), 0);
    const net = displayedTrades.reduce((s, t) => s + (t.netPnl ?? t.realizedPnl ?? 0), 0);
    const netWins = displayedTrades.filter((t) => (t.netPnl ?? t.realizedPnl ?? 0) > 0);
    const grossWinSum = netWins.reduce((s, t) => s + (t.netPnl ?? t.realizedPnl ?? 0), 0);
    const grossLossSum = Math.abs(
      displayedTrades.filter((t) => (t.netPnl ?? t.realizedPnl ?? 0) <= 0)
        .reduce((s, t) => s + (t.netPnl ?? t.realizedPnl ?? 0), 0)
    );
    const profitFactor = grossLossSum > 0 ? grossWinSum / grossLossSum : null;
    const holdDays = displayedTrades
      .filter((t) => t.entryDate && t.exitDate)
      .map((t) => Math.max(0, (new Date(t.exitDate) - new Date(t.entryDate)) / 86_400_000));
    const avgHold = holdDays.length ? holdDays.reduce((s, d) => s + d, 0) / holdDays.length : null;
    return { gross, costs, net, profitFactor, avgHold };
  })();

  return (
    <div className="min-h-screen bg-surface p-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-100">Trade Ledger</h1>
        <div className="flex items-center gap-2">
          {closedTrades.length > 0 && (
            <button onClick={exportTrades} className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5">
              ↓ Export
            </button>
          )}
          <button onClick={load} className="btn-primary text-xs px-3 py-1">Refresh</button>
        </div>
      </div>

      {error && <div className="card border-red-500/30 bg-red-500/10 text-red-400">{error}</div>}

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-300">
            {displayedTrades.length}{activeFilterCount > 0 ? ` of ${closedTrades.length}` : ''} closed trades
          </h3>
        </div>

        {closedTrades.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4 bg-surface-elevated/40 border border-slate-700/50 rounded-lg p-2.5">
            <input
              type="text"
              placeholder="Search symbol…"
              value={filter.symbol}
              onChange={(e) => setFilter((f) => ({ ...f, symbol: e.target.value }))}
              className="input w-36 !py-1.5 text-xs"
            />
            <select
              value={filter.exitReason}
              onChange={(e) => setFilter((f) => ({ ...f, exitReason: e.target.value }))}
              className="input !py-1.5 text-xs w-auto"
            >
              <option value="">All exit reasons</option>
              {Object.entries(EXIT_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <input
              type="date"
              value={filter.from}
              onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))}
              className="input !py-1.5 text-xs w-auto"
            />
            <span className="text-slate-600 text-xs">to</span>
            <input
              type="date"
              value={filter.to}
              onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))}
              className="input !py-1.5 text-xs w-auto"
            />
            {activeFilterCount > 0 && (
              <button
                onClick={() => setFilter({ symbol: '', exitReason: '', from: '', to: '' })}
                className="ml-auto text-xs text-slate-500 hover:text-slate-300 underline underline-offset-2"
              >
                Clear filters ({activeFilterCount})
              </button>
            )}
          </div>
        )}

        {netStrip && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4 bg-surface-elevated border border-slate-700/60 rounded-lg p-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Gross P&amp;L</p>
              <p className={`font-mono font-semibold text-sm ${netStrip.gross >= 0 ? 'text-bull' : 'text-bear'}`}>
                {formatCurrency(netStrip.gross)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Est Costs</p>
              <p className="font-mono font-semibold text-sm text-slate-300">− {formatCurrency(netStrip.costs)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Net P&amp;L</p>
              <p className={`font-mono font-semibold text-sm ${netStrip.net >= 0 ? 'text-bull' : 'text-bear'}`}>
                {formatCurrency(netStrip.net)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Profit Factor (net)</p>
              <p className={`font-mono font-semibold text-sm ${netStrip.profitFactor == null || netStrip.profitFactor >= 1.3 ? 'text-bull' : 'text-wait'}`}>
                {netStrip.profitFactor != null ? netStrip.profitFactor.toFixed(2) : '∞'}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Avg Hold</p>
              <p className="font-mono font-semibold text-sm text-slate-100">
                {netStrip.avgHold != null ? `${netStrip.avgHold.toFixed(1)}d` : '—'}
              </p>
            </div>
          </div>
        )}

        {closedTrades.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-4xl mb-3">📈</p>
            <p className="text-slate-400 font-medium">No closed trades yet</p>
            <p className="text-slate-500 text-sm mt-1 max-w-md mx-auto">
              Logged trades show up here once closed. As this paper record grows, the stats
              become statistically meaningful — that&rsquo;s the data the system needs to actually improve.
            </p>
          </div>
        ) : displayedTrades.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-4xl mb-3">🔍</p>
            <p className="text-slate-400 font-medium">No trades match these filters</p>
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
                  <th className="pb-2 pr-4">Gross P&L</th>
                  <th className="pb-2 pr-4">Costs</th>
                  <SortHeader sortKey="netPnl">Net P&L</SortHeader>
                  <SortHeader sortKey="pnlPct">P&L %</SortHeader>
                  <th className="pb-2 pr-4">R:R</th>
                  <SortHeader sortKey="hold">Hold</SortHeader>
                  <th className="pb-2 pr-4">Reason</th>
                  <SortHeader sortKey="exitDate" className="pb-2">Date</SortHeader>
                </tr>
              </thead>
              <tbody>
                {displayedTrades.map((t) => {
                  const pnl = t.realizedPnl ?? 0;
                  const net = t.netPnl ?? pnl;
                  const color = pnl >= 0 ? 'text-bull' : 'text-bear';
                  const netColor = net >= 0 ? 'text-bull' : 'text-bear';
                  const holdDays =
                    t.entryDate && t.exitDate
                      ? Math.max(0, (new Date(t.exitDate) - new Date(t.entryDate)) / 86_400_000)
                      : null;
                  return (
                    <tr key={t._id} className="border-b border-slate-800 hover:bg-slate-800/40">
                      <td className="py-2 pr-4 font-mono font-semibold">{t.symbol}</td>
                      <td className="py-2 pr-4 font-mono">{formatCurrency(t.entryPrice)}</td>
                      <td className="py-2 pr-4 font-mono">{formatCurrency(t.exitPrice)}</td>
                      <td className="py-2 pr-4">{t.shares}</td>
                      <td className={`py-2 pr-4 font-mono ${color}`}>
                        {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
                      </td>
                      <td className="py-2 pr-4 font-mono text-slate-500">
                        {t.estCosts != null ? formatCurrency(t.estCosts) : '—'}
                      </td>
                      <td className={`py-2 pr-4 font-mono font-semibold ${netColor}`}>
                        {net >= 0 ? '+' : ''}{formatCurrency(net)}
                      </td>
                      <td className={`py-2 pr-4 ${color}`}>
                        {formatPercent(t.realizedPnlPct ?? 0)}
                      </td>
                      <td className="py-2 pr-4 text-blue-400">
                        {t.riskReward ? `${t.riskReward.toFixed(1)}:1` : '—'}
                      </td>
                      <td className="py-2 pr-4 text-slate-400">
                        {holdDays != null ? `${holdDays.toFixed(holdDays < 10 ? 1 : 0)}d` : '—'}
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

export default TradeLedger;
