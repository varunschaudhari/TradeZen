/**
 * @file IntradayBadges.jsx
 * @description Shared strategy/direction/exit badges for the intraday lane — used by
 *   IntradayPanel (Positions page) and IntradayTrading (hub page) so the categorical
 *   color assignment (one fixed hue per strategy) stays identical everywhere it appears.
 */

import React from 'react';
import PropTypes from 'prop-types';

export const EXIT_META = {
  TARGET:    { label: 'Target',     cls: 'text-bull' },
  STOPLOSS:  { label: 'Stop',       cls: 'text-bear' },
  SQUAREOFF: { label: 'Square-off', cls: 'text-slate-300' },
  MANUAL:    { label: 'Manual',     cls: 'text-slate-300' },
};

export const STRATEGY_META = {
  ORB:                   { label: 'ORB',      cls: 'bg-amber-900/60 text-amber-300 border-amber-700/50' },
  VWAP_REVERSION:        { label: 'VWAP-Rev', cls: 'bg-violet-900/60 text-violet-300 border-violet-700/50' },
  MOMENTUM_CONTINUATION: { label: 'Momentum', cls: 'bg-cyan-900/60 text-cyan-300 border-cyan-700/50' },
  MANUAL:                { label: 'Manual',   cls: 'bg-sky-900/60 text-sky-300 border-sky-700/50' },
};

export const StrategyBadge = ({ setupType }) => {
  const meta = STRATEGY_META[setupType] ?? { label: setupType ?? '—', cls: 'bg-slate-700/70 text-slate-300 border-slate-600/50' };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide border ${meta.cls}`}>
      {meta.label}
    </span>
  );
};

StrategyBadge.propTypes = { setupType: PropTypes.string };

export const DirectionBadge = ({ direction }) => {
  const isShort = direction === 'SHORT';
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide border ${
        isShort
          ? 'bg-bear/10 text-bear border-bear/40'
          : 'bg-bull/10 text-bull border-bull/40'
      }`}
    >
      {isShort ? 'SHORT' : 'LONG'}
    </span>
  );
};

DirectionBadge.propTypes = { direction: PropTypes.string };
