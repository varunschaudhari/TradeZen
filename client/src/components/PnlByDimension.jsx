/**
 * @file PnlByDimension.jsx
 * @description Net P&L grouped by a switchable dimension (sector / exit reason / symbol)
 *   for closed swing trades — diverging bars from a zero baseline. Color encodes POLARITY
 *   (profit vs loss), not the dimension's identity — identity is already the row label, so
 *   a per-group hue here would conflate two different jobs onto one channel (same rule
 *   applied to IntradayTrading's PnlByStrategy).
 */

import React, { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { formatCurrency } from '../utils/formatters.js';

const EXIT_REASON_LABELS = {
  TARGET1: 'Target 1', TARGET2: 'Target 2', STOPLOSS: 'Stop Loss', MANUAL: 'Manual', EARNINGS: 'Earnings',
};

const DIMENSIONS = [
  { key: 'sector', label: 'Sector', keyOf: (t) => t.sector ?? 'Unclassified' },
  { key: 'exitReason', label: 'Exit Reason', keyOf: (t) => EXIT_REASON_LABELS[t.exitReason] ?? t.exitReason ?? 'Unknown' },
  { key: 'symbol', label: 'Symbol', keyOf: (t) => t.symbol },
];

const Chip = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all duration-150 ${
      active
        ? 'bg-accent/20 text-accent border-accent/40'
        : 'bg-surface-elevated/50 text-slate-400 border-slate-700 hover:text-slate-200 hover:border-slate-600'
    }`}
  >
    {children}
  </button>
);

Chip.propTypes = { active: PropTypes.bool, onClick: PropTypes.func.isRequired, children: PropTypes.node.isRequired };

const PnlByDimension = ({ trades }) => {
  const [dimKey, setDimKey] = useState('sector');
  const dim = DIMENSIONS.find((d) => d.key === dimKey) ?? DIMENSIONS[0];

  const rows = useMemo(() => {
    const groups = {};
    trades.forEach((t) => {
      const key = dim.keyOf(t) || 'Unclassified';
      const g = (groups[key] ??= { key, netPnl: 0, n: 0, wins: 0 });
      const net = t.netPnl ?? t.realizedPnl ?? 0;
      g.netPnl += net;
      g.n += 1;
      if (net > 0) g.wins += 1;
    });
    return Object.values(groups).sort((a, b) => Math.abs(b.netPnl) - Math.abs(a.netPnl));
  }, [trades, dim]);

  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.netPnl)));

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-slate-300">Net P&amp;L by Dimension</h3>
        <div className="flex items-center gap-1.5">
          {DIMENSIONS.map((d) => (
            <Chip key={d.key} active={d.key === dimKey} onClick={() => setDimKey(d.key)}>{d.label}</Chip>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-8">No closed trades yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const positive = r.netPnl >= 0;
            const widthPct = Math.round((Math.abs(r.netPnl) / maxAbs) * 50);
            return (
              <div key={r.key} className="flex items-center gap-3">
                <span className="w-28 text-[11px] font-medium text-slate-400 flex-shrink-0 truncate" title={r.key}>
                  {r.key}
                </span>
                <div className="flex-1 h-2.5 rounded-full bg-surface-elevated/60 relative overflow-hidden">
                  <span className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-600" />
                  <div
                    className={`absolute top-0 bottom-0 rounded-full ${positive ? 'bg-bull' : 'bg-bear'} transition-all duration-500`}
                    style={positive ? { left: '50%', width: `${widthPct}%` } : { right: '50%', width: `${widthPct}%` }}
                  />
                </div>
                <span className={`w-24 text-right text-xs font-mono tabular-nums ${positive ? 'text-bull' : 'text-bear'}`}>
                  {formatCurrency(r.netPnl)}
                </span>
                <span className="w-16 text-right text-[11px] text-slate-500">
                  {r.n} trade{r.n === 1 ? '' : 's'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

PnlByDimension.propTypes = {
  trades: PropTypes.array.isRequired,
};

export default PnlByDimension;
