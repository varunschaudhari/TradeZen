/**
 * @file MarketStatusBar.jsx
 * @description Top strip: Nifty 50, Bank Nifty, VIX, A/D ratio, market mode, WS status
 */

import React from 'react';
import PropTypes from 'prop-types';
import { formatCurrency } from '../utils/formatters.js';
import { MARKET_MODE_COLORS } from '../utils/constants.js';
import { useApp } from '../context/AppContext.jsx';

const Stat = ({ label, value, sub, subColor }) => (
  <div className="flex flex-col items-center min-w-[72px]">
    <span className="text-slate-500 text-xs uppercase tracking-wide">{label}</span>
    <span className="font-mono font-semibold text-sm text-slate-100 mt-0.5">{value ?? '—'}</span>
    {sub && <span className={`text-xs font-mono ${subColor ?? 'text-slate-400'}`}>{sub}</span>}
  </div>
);

Stat.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  sub: PropTypes.string,
  subColor: PropTypes.string,
};

const MarketStatusBar = ({ market }) => {
  const { isConnected } = useApp();

  /* Loading skeleton */
  if (!market) {
    return (
      <div className="card flex items-center gap-6 animate-pulse py-3">
        {[80, 64, 56, 56, 72].map((w, i) => (
          <div key={i} className="h-8 bg-slate-700 rounded" style={{ width: w }} />
        ))}
      </div>
    );
  }

  /* API returns flat fields: niftyPrice, niftyChange, niftyChangePct, bankNiftyPrice, vix, adRatio, marketMode */
  const changePct  = market.niftyChangePct;
  const changeAbs  = market.niftyChange;
  const changeUp   = (changePct ?? 0) >= 0;
  const changeColor = changeUp ? 'text-bull' : 'text-bear';
  const changeSign  = changeUp ? '+' : '';
  const modeColor   = MARKET_MODE_COLORS[market.marketMode] ?? 'text-slate-400';

  return (
    <div className="card flex flex-wrap items-center justify-between gap-4 py-3">
      {/* Left: market stats */}
      <div className="flex flex-wrap items-center gap-5">
        <Stat
          label="Nifty 50"
          value={formatCurrency(market.niftyPrice, 0)}
          sub={
            changePct != null
              ? `${changeSign}${changeAbs?.toFixed(0)} (${changeSign}${changePct?.toFixed(2)}%)`
              : undefined
          }
          subColor={changeColor}
        />

        {market.bankNiftyPrice != null && (
          <Stat label="Bank Nifty" value={formatCurrency(market.bankNiftyPrice, 0)} />
        )}

        <Stat label="VIX" value={market.vix?.toFixed(2)} />
        <Stat label="A/D Ratio" value={market.adRatio?.toFixed(2)} />

        <div className="flex flex-col items-center min-w-[64px]">
          <span className="text-slate-500 text-xs uppercase tracking-wide">Mode</span>
          <span className={`font-bold text-sm uppercase mt-0.5 ${modeColor}`}>
            {market.marketMode ?? '—'}
          </span>
        </div>
      </div>

      {/* Right: connection indicator */}
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={`h-2 w-2 rounded-full flex-shrink-0 ${
            isConnected ? 'bg-bull animate-pulse' : 'bg-slate-600'
          }`}
        />
        <span className={`text-xs ${isConnected ? 'text-bull' : 'text-slate-500'}`}>
          {isConnected ? 'Live' : 'Offline'}
        </span>
      </div>
    </div>
  );
};

MarketStatusBar.propTypes = {
  market: PropTypes.shape({
    niftyPrice:     PropTypes.number,
    niftyChange:    PropTypes.number,
    niftyChangePct: PropTypes.number,
    bankNiftyPrice: PropTypes.number,
    vix:            PropTypes.number,
    adRatio:        PropTypes.number,
    marketMode:     PropTypes.string,
  }),
};

MarketStatusBar.defaultProps = { market: null };

export default MarketStatusBar;
