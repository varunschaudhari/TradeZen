/**
 * @file PositionsTable.jsx
 * @description Compact table view of open positions — same data and handlers as
 *   TradeCard's grid, just denser for scanning many positions at once.
 */

import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { ACTION_STYLES } from './TradeCard.jsx';
import { formatCurrency, formatPercent } from '../utils/formatters.js';

const PositionsTable = ({ trades, onMarkT1Hit, onMarkSLHit, onMarkClosed, onQuickClose, slWarnings }) => {
  const [pendingCloseId, setPendingCloseId] = useState(null);

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-xs text-left">
        <thead>
          <tr className="text-slate-400 border-b border-slate-700">
            <th className="pb-2 pr-4">Symbol</th>
            <th className="pb-2 pr-4">Sector</th>
            <th className="pb-2 pr-4">Entry</th>
            <th className="pb-2 pr-4">Current</th>
            <th className="pb-2 pr-4">Stop</th>
            <th className="pb-2 pr-4">Target 1</th>
            <th className="pb-2 pr-4">Shares</th>
            <th className="pb-2 pr-4">Deployed</th>
            <th className="pb-2 pr-4">Unrealized P&L</th>
            <th className="pb-2 pr-4">P&L %</th>
            <th className="pb-2 pr-4">R</th>
            <th className="pb-2 pr-4">Days</th>
            <th className="pb-2 pr-4">Action</th>
            <th className="pb-2">Manage</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const pnlClass = (t.unrealizedPnl ?? 0) >= 0 ? 'text-bull' : 'text-bear';
            const live = t.live;
            const actionStyle = live ? (ACTION_STYLES[live.action] ?? ACTION_STYLES.HOLD) : null;
            const hasPrice = t.currentPrice != null && t.currentPrice > 0;
            const daysIn = t.entryDate ? Math.floor((Date.now() - new Date(t.entryDate).getTime()) / 86_400_000) : null;
            const flagged = slWarnings?.has(String(t._id));
            return (
              <tr key={t._id} className={`border-b border-slate-800 hover:bg-slate-800/40 ${flagged ? 'bg-bear/5' : ''}`}>
                <td className="py-2 pr-4 font-mono font-semibold text-slate-100">{t.symbol}</td>
                <td className="py-2 pr-4 text-slate-500 truncate max-w-[110px]">{t.sector ?? '—'}</td>
                <td className="py-2 pr-4 font-mono">{formatCurrency(t.entryPrice)}</td>
                <td className="py-2 pr-4 font-mono">{formatCurrency(t.currentPrice)}</td>
                <td className="py-2 pr-4 font-mono text-bear">{formatCurrency(t.stopLoss)}</td>
                <td className="py-2 pr-4 font-mono text-bull">
                  {t.target1Hit ? <span className="text-slate-500 line-through">{formatCurrency(t.target1)}</span> : formatCurrency(t.target1)}
                </td>
                <td className="py-2 pr-4">{t.shares}</td>
                <td className="py-2 pr-4 font-mono text-slate-400">{formatCurrency(t.capitalDeployed)}</td>
                <td className={`py-2 pr-4 font-mono font-semibold ${pnlClass}`}>{formatCurrency(t.unrealizedPnl)}</td>
                <td className={`py-2 pr-4 font-mono ${pnlClass}`}>{formatPercent(t.unrealizedPnlPct)}</td>
                <td className="py-2 pr-4 font-mono text-blue-400">{live?.rMultiple != null ? `${live.rMultiple}R` : '—'}</td>
                <td className="py-2 pr-4 text-slate-400">{daysIn == null ? '—' : daysIn === 0 ? 'today' : `${daysIn}d`}</td>
                <td className="py-2 pr-4">
                  {actionStyle ? (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${actionStyle.box}`} title={live?.reason}>
                      {actionStyle.label}
                    </span>
                  ) : '—'}
                </td>
                <td className="py-2">
                  {pendingCloseId === t._id ? (
                    <span className="inline-flex gap-1">
                      <button
                        onClick={() => { onQuickClose(t._id, t.currentPrice); setPendingCloseId(null); }}
                        className="px-2 py-0.5 rounded text-[11px] bg-bull/20 hover:bg-bull/30 text-bull border border-bull/40"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => setPendingCloseId(null)}
                        className="px-2 py-0.5 rounded text-[11px] bg-slate-700 hover:bg-slate-600 text-slate-300"
                      >
                        ✗
                      </button>
                    </span>
                  ) : (
                    <span className="inline-flex gap-1 whitespace-nowrap">
                      {!t.target1Hit && (
                        <button
                          onClick={() => onMarkT1Hit(t._id)}
                          className="px-1.5 py-0.5 rounded text-[11px] bg-bull/15 hover:bg-bull/25 text-bull border border-bull/30"
                        >
                          T1
                        </button>
                      )}
                      <button
                        onClick={() => onMarkSLHit(t._id)}
                        className="px-1.5 py-0.5 rounded text-[11px] bg-bear/15 hover:bg-bear/25 text-bear border border-bear/30"
                      >
                        SL
                      </button>
                      <button
                        onClick={() => (hasPrice ? setPendingCloseId(t._id) : onMarkClosed(t._id))}
                        className="px-1.5 py-0.5 rounded text-[11px] bg-slate-700 hover:bg-slate-600 text-slate-300"
                      >
                        Close
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

PositionsTable.propTypes = {
  trades: PropTypes.array.isRequired,
  onMarkT1Hit: PropTypes.func.isRequired,
  onMarkSLHit: PropTypes.func.isRequired,
  onMarkClosed: PropTypes.func.isRequired,
  onQuickClose: PropTypes.func.isRequired,
  slWarnings: PropTypes.instanceOf(Set),
};

export default PositionsTable;
