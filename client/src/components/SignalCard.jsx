/**
 * @file SignalCard.jsx
 * @description Signal card showing verdict, indicators, gate count, and trade levels
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { formatCurrency, formatPercent, timeAgo } from '../utils/formatters.js';
import { VERDICT_BG, GATE_NAMES } from '../utils/constants.js';

const GateRow = ({ name, passed, reason }) => (
  <div className="flex items-start gap-2 text-xs">
    <span className={`mt-0.5 flex-shrink-0 ${passed ? 'text-bull' : 'text-bear'}`}>
      {passed ? '✓' : '✗'}
    </span>
    <span className={`${passed ? 'text-slate-300' : 'text-slate-500 line-through'}`}>{name}</span>
    {!passed && reason && <span className="text-slate-500 ml-auto text-right">{reason}</span>}
  </div>
);

GateRow.propTypes = {
  name: PropTypes.string.isRequired,
  passed: PropTypes.bool.isRequired,
  reason: PropTypes.string,
};

GateRow.defaultProps = { reason: '' };

const SignalCard = ({ signal }) => {
  const [showGates, setShowGates] = useState(false);
  const bgClass = VERDICT_BG[signal.verdict] ?? 'bg-surface-card border-slate-700';
  const isBuy = signal.verdict === 'BUY';
  const isWait = signal.verdict === 'WAIT';

  return (
    <div className={`card border ${bgClass} animate-fade-in`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="font-mono font-bold text-lg">{signal.symbol}</span>
          {signal.indicators?.rsi && (
            <span className="ml-2 text-xs text-slate-400">RSI {signal.indicators.rsi.toFixed(1)}</span>
          )}
        </div>
        <span className={`badge-${signal.verdict?.toLowerCase()}`}>{signal.verdict}</span>
      </div>

      {/* BUY — full entry/exit details */}
      {isBuy && (
        <div className="space-y-1.5 text-sm mb-3">
          <div className="flex justify-between">
            <span className="text-slate-400">Entry Zone</span>
            <span className="font-mono text-xs">
              {formatCurrency(signal.entryZone?.low)} – {formatCurrency(signal.entryZone?.high)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Stop Loss</span>
            <span className="font-mono text-bear">{formatCurrency(signal.stopLoss)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Target 1</span>
            <span className="font-mono text-bull">{formatCurrency(signal.target1)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Target 2</span>
            <span className="font-mono text-bull">{formatCurrency(signal.target2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">R:R</span>
            <span className="font-mono font-semibold">{signal.riskReward?.toFixed(1)}:1</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Shares × Capital</span>
            <span className="font-mono text-xs">
              {signal.shares} × {formatCurrency(signal.capitalDeployed)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Max Loss</span>
            <span className="font-mono text-bear text-xs">{formatCurrency(signal.maxLoss)}</span>
          </div>
        </div>
      )}

      {/* WAIT — show condition only */}
      {isWait && signal.waitCondition && (
        <p className="text-xs text-wait mb-3">
          <span className="font-semibold">Wait for: </span>{signal.waitCondition}
        </p>
      )}

      {/* Reasoning snippet */}
      {signal.reasoning && (
        <p className="text-xs text-slate-400 mb-3 line-clamp-2 italic">"{signal.reasoning}"</p>
      )}

      {/* Gate toggle */}
      <button
        onClick={() => setShowGates((v) => !v)}
        className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
      >
        {signal.gatesPassed}/8 gates {showGates ? '▲' : '▼'}
      </button>

      {showGates && signal.gateDetails && (
        <div className="mt-2 space-y-1 border-t border-slate-700 pt-2">
          {Object.entries(GATE_NAMES).map(([key, name]) => (
            <GateRow
              key={key}
              name={name}
              passed={signal.gateDetails[key]?.passed ?? false}
              reason={signal.gateDetails[key]?.reason}
            />
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 pt-2 border-t border-slate-700 flex items-center justify-between text-xs text-slate-500">
        <span className="capitalize">{signal.confidence?.toLowerCase()} confidence</span>
        <span>{timeAgo(signal.createdAt)}</span>
      </div>
    </div>
  );
};

SignalCard.propTypes = {
  signal: PropTypes.shape({
    _id: PropTypes.string,
    symbol: PropTypes.string,
    verdict: PropTypes.string,
    confidence: PropTypes.string,
    entryZone: PropTypes.shape({ low: PropTypes.number, high: PropTypes.number }),
    stopLoss: PropTypes.number,
    target1: PropTypes.number,
    target2: PropTypes.number,
    riskReward: PropTypes.number,
    shares: PropTypes.number,
    capitalDeployed: PropTypes.number,
    maxLoss: PropTypes.number,
    gatesPassed: PropTypes.number,
    gateDetails: PropTypes.object,
    indicators: PropTypes.object,
    reasoning: PropTypes.string,
    waitCondition: PropTypes.string,
    createdAt: PropTypes.string,
  }).isRequired,
};

export default SignalCard;
