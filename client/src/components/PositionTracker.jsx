/**
 * @file PositionTracker.jsx
 * @description Visual progress bar from Stop Loss → Entry → Target 1 → Target 2
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { formatCurrency } from '../utils/formatters.js';

const PositionTracker = ({ trade }) => {
  const { stopLoss, entryPrice, target1, target2, currentPrice } = trade;

  const pct = useMemo(() => {
    const low = stopLoss;
    const high = target2 ?? target1;
    if (!low || !high || high <= low) return null;
    return Math.min(100, Math.max(0, ((currentPrice - low) / (high - low)) * 100));
  }, [stopLoss, target1, target2, currentPrice]);

  const entryPct = useMemo(() => {
    const low = stopLoss;
    const high = target2 ?? target1;
    if (!low || !high || high <= low) return null;
    return ((entryPrice - low) / (high - low)) * 100;
  }, [stopLoss, entryPrice, target1, target2]);

  const t1Pct = useMemo(() => {
    const low = stopLoss;
    const high = target2 ?? target1;
    if (!low || !high || !target1 || high <= low) return null;
    return ((target1 - low) / (high - low)) * 100;
  }, [stopLoss, target1, target2]);

  if (pct === null) {
    return <div className="h-2 bg-slate-700 rounded-full" />;
  }

  const barColor = currentPrice < entryPrice ? 'bg-bear' : 'bg-bull';

  return (
    <div className="space-y-1">
      <div className="relative h-2 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
        {/* Entry marker */}
        {entryPct != null && (
          <div
            className="absolute top-0 h-full w-0.5 bg-slate-300"
            style={{ left: `${entryPct}%` }}
          />
        )}
        {/* T1 marker */}
        {t1Pct != null && (
          <div
            className="absolute top-0 h-full w-0.5 bg-bull/60"
            style={{ left: `${t1Pct}%` }}
          />
        )}
        {/* T2 right-edge cap — visible even when fill hasn't reached T2 */}
        {target2 && (
          <div className="absolute top-0 right-0 h-full w-1 bg-bull" />
        )}
      </div>
      <div className="flex justify-between text-xs font-mono">
        <span className="text-bear">{formatCurrency(stopLoss)}</span>
        <span className="text-slate-400">|{formatCurrency(entryPrice)}|</span>
        {target2 && t1Pct != null && (
          <span className="text-bull/60">{formatCurrency(target1)}</span>
        )}
        <span className="text-bull">{formatCurrency(target2 ?? target1)}</span>
      </div>
    </div>
  );
};

PositionTracker.propTypes = {
  trade: PropTypes.shape({
    stopLoss: PropTypes.number,
    entryPrice: PropTypes.number,
    target1: PropTypes.number,
    target2: PropTypes.number,
    currentPrice: PropTypes.number,
  }).isRequired,
};

export default PositionTracker;
