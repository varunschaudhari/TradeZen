/**
 * @file TradeCard.jsx
 * @description Active trade card with full entry/exit levels and quick-action buttons
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import React from 'react';
import PropTypes from 'prop-types';
import { formatCurrency, formatPercent, formatDateTime } from '../utils/formatters.js';
import PositionTracker from './PositionTracker.jsx';

const TradeCard = ({ trade, onMarkT1Hit, onMarkClosed, onMarkSLHit }) => {
  const pnlClass = (trade.unrealizedPnl ?? 0) >= 0 ? 'text-bull' : 'text-bear';

  return (
    <div className="card border border-buy/20 bg-buy/5 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="font-mono font-bold text-lg">{trade.symbol}</span>
        <div className="text-right">
          <div className={`font-mono font-semibold ${pnlClass}`}>
            {formatCurrency(trade.unrealizedPnl)}
          </div>
          <div className={`text-xs ${pnlClass}`}>
            {formatPercent(trade.unrealizedPnlPct)}
          </div>
        </div>
      </div>

      {/* Price tracker bar */}
      <PositionTracker trade={trade} />

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-400">Entry</span>
          <span className="font-mono">{formatCurrency(trade.entryPrice)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Current</span>
          <span className="font-mono">{formatCurrency(trade.currentPrice)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Stop Loss</span>
          <span className="font-mono text-bear">{formatCurrency(trade.stopLoss)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Target 1</span>
          <span className={`font-mono ${trade.target1Hit ? 'text-bull line-through' : 'text-bull'}`}>
            {formatCurrency(trade.target1)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Shares</span>
          <span className="font-mono">{trade.shares}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Deployed</span>
          <span className="font-mono text-xs">{formatCurrency(trade.capitalDeployed)}</span>
        </div>
      </div>

      <div className="text-xs text-slate-500">
        Entered {formatDateTime(trade.entryDate)}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 pt-1">
        {!trade.target1Hit && (
          <button
            onClick={() => onMarkT1Hit(trade._id)}
            className="flex-1 text-xs bg-bull/20 hover:bg-bull/30 text-bull border border-bull/30 rounded-lg py-1.5 transition-colors"
          >
            T1 Hit
          </button>
        )}
        <button
          onClick={() => onMarkSLHit(trade._id)}
          className="flex-1 text-xs bg-bear/20 hover:bg-bear/30 text-bear border border-bear/30 rounded-lg py-1.5 transition-colors"
        >
          SL Hit
        </button>
        <button
          onClick={() => onMarkClosed(trade._id)}
          className="flex-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg py-1.5 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
};

TradeCard.propTypes = {
  trade: PropTypes.shape({
    _id: PropTypes.string.isRequired,
    symbol: PropTypes.string.isRequired,
    entryPrice: PropTypes.number,
    currentPrice: PropTypes.number,
    stopLoss: PropTypes.number,
    target1: PropTypes.number,
    target1Hit: PropTypes.bool,
    shares: PropTypes.number,
    capitalDeployed: PropTypes.number,
    unrealizedPnl: PropTypes.number,
    unrealizedPnlPct: PropTypes.number,
    entryDate: PropTypes.string,
  }).isRequired,
  onMarkT1Hit: PropTypes.func.isRequired,
  onMarkClosed: PropTypes.func.isRequired,
  onMarkSLHit: PropTypes.func.isRequired,
};

export default TradeCard;
