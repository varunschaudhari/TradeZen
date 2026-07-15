/**
 * @file EquityCurveChart.jsx
 * @description Per-trade equity curve for closed swing trades — cumulative NET P&L after
 *   each exit, in trade sequence (not calendar time, so back-to-back same-day exits don't
 *   crowd the axis). The gap between the curve and its running peak is shaded red — the
 *   drawdown — using a stacked-area trick (invisible base + colored top) so both live on
 *   the same ₹ axis instead of a second scale.
 */

import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { formatCurrency } from '../utils/formatters.js';

const TICK_STYLE = { fill: '#94a3b8', fontSize: 11 };

const EquityTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="bg-surface-card border border-slate-600 rounded-lg px-3 py-2 text-xs shadow-xl space-y-0.5">
      <p className="text-slate-300 font-semibold">{p.symbol} <span className="text-slate-500 font-normal">· {p.dateLabel}</span></p>
      <p className={`font-mono ${p.cum >= 0 ? 'text-bull' : 'text-bear'}`}>Cumulative: {formatCurrency(p.cum)}</p>
      {p.gap > 0.5 && <p className="font-mono text-bear">Drawdown: −{formatCurrency(p.gap)}</p>}
    </div>
  );
};

EquityTooltip.propTypes = { active: PropTypes.bool, payload: PropTypes.array };

const EquityCurveChart = ({ trades }) => {
  const { data, maxDrawdown } = useMemo(() => {
    const ordered = trades
      .filter((t) => t.exitDate)
      .slice()
      .sort((a, b) => new Date(a.exitDate) - new Date(b.exitDate));

    let cum = 0;
    let peak = 0;
    let maxDd = 0;
    const data = ordered.map((t, i) => {
      cum += t.netPnl ?? t.realizedPnl ?? 0;
      peak = Math.max(peak, cum);
      const gap = round2(peak - cum);
      maxDd = Math.max(maxDd, gap);
      return {
        idx: i + 1,
        symbol: t.symbol,
        dateLabel: new Date(t.exitDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        cum: round2(cum),
        gap,
      };
    });
    return { data, maxDrawdown: round2(maxDd) };
  }, [trades]);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-slate-300">Equity Curve</h3>
        {data.length > 0 && (
          <span className="text-[11px] text-slate-500">
            Max drawdown <span className="text-bear font-mono font-semibold">−{formatCurrency(maxDrawdown)}</span>
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Cumulative net P&amp;L after each closed trade, in sequence. The red band is the gap
        between the curve and its running peak — how deep &amp; how long each drawdown ran.
      </p>

      {data.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-8">
          The curve builds up as trades close — nothing to plot yet.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="idx" tick={TICK_STYLE} tickFormatter={(v) => `#${v}`} />
            <YAxis tick={TICK_STYLE} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} width={56} />
            <Tooltip content={<EquityTooltip />} />
            <ReferenceLine y={0} stroke="#475569" />
            {/* Invisible base at the current equity value, then the drawdown gap stacked on
                top reaches exactly to the running peak — one axis, no second scale. */}
            <Area type="monotone" dataKey="cum" stackId="eq" stroke="none" fill="transparent" isAnimationActive={false} />
            <Area
              type="monotone"
              dataKey="gap"
              stackId="eq"
              stroke="none"
              fill="#ef4444"
              fillOpacity={0.16}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="cum"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

EquityCurveChart.propTypes = {
  trades: PropTypes.array.isRequired,
};

export default EquityCurveChart;
