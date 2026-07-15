/**
 * @file PerformanceChart.jsx
 * @description Monthly P&L bar chart (green/red per month) + capital growth line chart.
 */

import React from 'react';
import PropTypes from 'prop-types';
import {
  BarChart, Bar, Cell,
  LineChart, Line,
  XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { formatCurrency } from '../utils/formatters.js';

/* ── Tooltip components ─────────────────────────────────────────────────────── */
const PnlTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value ?? 0;
  return (
    <div className="bg-surface-card border border-slate-600 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-slate-400 mb-1">{label}</p>
      <p className={`font-mono font-semibold ${value >= 0 ? 'text-bull' : 'text-bear'}`}>
        {value >= 0 ? '+' : ''}{formatCurrency(value)}
      </p>
    </div>
  );
};

PnlTooltip.propTypes = {
  active:  PropTypes.bool,
  payload: PropTypes.array,
  label:   PropTypes.string,
};

const CapitalTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-card border border-slate-600 rounded-lg px-3 py-2 text-xs shadow-xl space-y-1">
      <p className="text-slate-400 mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="font-mono font-semibold" style={{ color: p.color }}>
          {p.name}: {formatCurrency(p.value)}
        </p>
      ))}
    </div>
  );
};

CapitalTooltip.propTypes = {
  active:  PropTypes.bool,
  payload: PropTypes.array,
  label:   PropTypes.string,
};

/* ── Chart tick styling ─────────────────────────────────────────────────────── */
const TICK_STYLE = { fill: '#94a3b8', fontSize: 11 };

const PerformanceChart = ({ monthlyData = [], capitalData = [], benchmarkData = [] }) => {
  // Merge capitalData + benchmarkData into one series for the combined chart
  const combinedData = capitalData.map((pt) => {
    const bm = benchmarkData.find((b) => b.label === pt.date);
    return { date: pt.date, Portfolio: pt.capital, ...(bm?.niftyCapital != null ? { 'Nifty 50': bm.niftyCapital } : {}) };
  });
  const hasNifty = combinedData.some((d) => d['Nifty 50'] != null);

  return (
    <div className="space-y-6">
      {/* Monthly P&L — bars colored per sign */}
      <div className="card">
        <h3 className="text-sm font-semibold text-slate-300 mb-4">Monthly P&amp;L</h3>
        {monthlyData.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-8">
            No closed trades yet — P&amp;L will appear here after your first exit.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlyData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="month" tick={TICK_STYLE} />
              <YAxis
                tick={TICK_STYLE}
                tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                width={56}
              />
              <Tooltip content={<PnlTooltip />} cursor={{ fill: 'rgba(148,163,184,0.05)' }} />
              <ReferenceLine y={0} stroke="#475569" />
              <Bar dataKey="pnl" radius={[3, 3, 0, 0]} maxBarSize={48}>
                {monthlyData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.pnl >= 0 ? '#22c55e' : '#ef4444'}
                    fillOpacity={0.85}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Capital growth vs Nifty 50 benchmark */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-300">Capital Growth vs Nifty 50</h3>
          {hasNifty && (
            <div className="flex items-center gap-4 text-[11px]">
              <span className="flex items-center gap-1.5 text-blue-400">
                <span className="inline-block w-5 h-0.5 bg-blue-400 rounded" />Portfolio
              </span>
              <span className="flex items-center gap-1.5 text-amber-400">
                <span className="inline-block w-5 h-0.5 bg-amber-400 rounded border-dashed border border-amber-400" />Nifty 50
              </span>
            </div>
          )}
        </div>
        {combinedData.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-8">
            Cumulative capital curve will appear here after your first closed trade.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={combinedData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tick={TICK_STYLE} />
              <YAxis
                tick={TICK_STYLE}
                tickFormatter={(v) => `₹${(v / 100000).toFixed(1)}L`}
                width={60}
              />
              <Tooltip content={<CapitalTooltip />} />
              <Line
                type="monotone"
                dataKey="Portfolio"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 3, fill: '#3b82f6', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
              {hasNifty && (
                <Line
                  type="monotone"
                  dataKey="Nifty 50"
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

PerformanceChart.propTypes = {
  monthlyData: PropTypes.arrayOf(
    PropTypes.shape({ month: PropTypes.string, pnl: PropTypes.number })
  ),
  capitalData: PropTypes.arrayOf(
    PropTypes.shape({ date: PropTypes.string, capital: PropTypes.number })
  ),
  benchmarkData: PropTypes.arrayOf(
    PropTypes.shape({ label: PropTypes.string, portfolioCapital: PropTypes.number, niftyCapital: PropTypes.number })
  ),
};

export default PerformanceChart;
