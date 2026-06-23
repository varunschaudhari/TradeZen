/**
 * @file MarketStatusBar.jsx
 * @description Top strip: Nifty 50, Bank Nifty, VIX, A/D ratio, market mode, WS status
 */

import React from 'react';
import PropTypes from 'prop-types';
import { formatCurrency } from '../utils/formatters.js';
import { MARKET_MODE_COLORS } from '../utils/constants.js';
import { useApp } from '../context/AppContext.jsx';

const ArrowIcon = ({ up }) => (
  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {up
      ? <path d="M12 5l7 8h-4v6h-6v-6H5l7-8z" />
      : <path d="M12 19l-7-8h4V5h6v6h4l-7 8z" />}
  </svg>
);
ArrowIcon.propTypes = { up: PropTypes.bool };

const Stat = ({ label, value, sub, subColor, subIcon }) => (
  <div className="flex flex-col min-w-[84px]">
    <span className="text-slate-500 text-[10px] uppercase tracking-wider">{label}</span>
    <span className="font-mono font-semibold text-sm text-slate-100 mt-0.5 tabular-nums">{value ?? '—'}</span>
    {sub && (
      <span className={`flex items-center gap-0.5 text-[11px] font-mono ${subColor ?? 'text-slate-400'}`}>
        {subIcon}{sub}
      </span>
    )}
  </div>
);

Stat.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  sub: PropTypes.string,
  subColor: PropTypes.string,
  subIcon: PropTypes.node,
};

const Divider = () => <span className="hidden sm:block w-px h-8 bg-slate-700/60 flex-shrink-0" />;

const MarketStatusBar = ({ market }) => {
  const { isConnected } = useApp();

  /* Loading skeleton */
  if (!market) {
    return (
      <div className="card flex items-center gap-6 animate-pulse py-3">
        {[88, 72, 64, 64, 80].map((w, i) => (
          <div key={i} className="h-9 bg-slate-700/60 rounded" style={{ width: w }} />
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

  /* VIX context tint — elevated volatility reads amber/red */
  const vix = market.vix;
  const vixColor = vix == null ? 'text-slate-400' : vix >= 20 ? 'text-bear' : vix >= 15 ? 'text-wait' : 'text-bull';

  return (
    <div className="card flex items-center justify-between gap-4 py-3 overflow-x-auto">
      {/* Left: market stats */}
      <div className="flex items-center gap-4 sm:gap-5">
        <Stat
          label="Nifty 50"
          value={formatCurrency(market.niftyPrice, 0)}
          sub={
            changePct != null
              ? `${changeSign}${changeAbs?.toFixed(0)} (${changeSign}${changePct?.toFixed(2)}%)`
              : undefined
          }
          subColor={changeColor}
          subIcon={changePct != null ? <ArrowIcon up={changeUp} /> : null}
        />

        <Divider />

        {market.bankNiftyPrice != null && (
          <>
            <Stat label="Bank Nifty" value={formatCurrency(market.bankNiftyPrice, 0)} />
            <Divider />
          </>
        )}

        <Stat label="India VIX" value={market.vix?.toFixed(2)} sub={vix != null ? (vix >= 20 ? 'high' : vix >= 15 ? 'elevated' : 'calm') : undefined} subColor={vixColor} />
        <Divider />
        <Stat label="A/D Ratio" value={market.adRatio?.toFixed(2)} />
      </div>

      {/* Right: market mode + connection */}
      <div className="flex items-center gap-3 flex-shrink-0 pl-2">
        <div className="flex flex-col items-end">
          <span className="text-slate-500 text-[10px] uppercase tracking-wider">Mode</span>
          <span className={`font-bold text-sm uppercase mt-0.5 ${modeColor}`}>
            {market.marketMode ?? '—'}
          </span>
        </div>
        <span className="w-px h-8 bg-slate-700/60" />
        <div
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium ${
            isConnected ? 'bg-bull/10 text-bull' : 'bg-slate-700/40 text-slate-500'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-bull animate-pulse' : 'bg-slate-600'}`} />
          {isConnected ? 'Live' : 'Offline'}
        </div>
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
