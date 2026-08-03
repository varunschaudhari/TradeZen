import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

/* ── Market open/close countdown (IST) ─────────────────────────────── */
function getMarketCountdown() {
  const nowIST = new Date(Date.now() + 5.5 * 3600 * 1000);
  const day  = nowIST.getUTCDay(); // 0=Sun 6=Sat
  const mins = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
  const OPEN = 9 * 60 + 15;
  const CLOSE = 15 * 60 + 30;
  const isWeekday = day >= 1 && day <= 5;
  const isOpen = isWeekday && mins >= OPEN && mins < CLOSE;

  if (isOpen) {
    const rem = CLOSE - mins;
    const h = Math.floor(rem / 60), m = rem % 60;
    return { label: h > 0 ? `Closes ${h}h ${m}m` : `Closes ${m}m`, isOpen: true };
  }

  /* Minutes until next market open */
  let minsAhead;
  if (isWeekday && mins < OPEN) {
    minsAhead = OPEN - mins;
  } else {
    /* After close or weekend — find next weekday */
    const minsToMidnight = 24 * 60 - mins;
    let daysSkip = 1;
    let nd = (day + 1) % 7;
    while (nd === 0 || nd === 6) { daysSkip++; nd = (nd + 1) % 7; }
    minsAhead = minsToMidnight + (daysSkip - 1) * 24 * 60 + OPEN;
  }

  const h = Math.floor(minsAhead / 60);
  const m = minsAhead % 60;
  const label = h >= 24
    ? `Opens ${Math.ceil(minsAhead / (24 * 60))}d`
    : h > 0 ? `Opens ${h}h ${m}m` : `Opens ${m}m`;
  return { label, isOpen: false };
}

const PulseItem = ({ label, value, sub, subUp, niftyGlow }) => (
  <div className="flex flex-col min-w-[94px] px-4 border-r border-slate-700/50 last:border-r-0">
    <span className="text-[9px] uppercase tracking-widest text-slate-600 leading-tight whitespace-nowrap">{label}</span>
    <span
      className={`font-mono text-[13px] font-bold tabular-nums leading-snug transition-all ${
        niftyGlow ? 'text-emerald-400 glow-bull' : 'text-slate-100'
      }`}
    >
      {value ?? '—'}
    </span>
    <span className={`font-mono text-[10px] tabular-nums leading-tight ${sub != null ? (subUp ? 'text-emerald-400' : 'text-red-400') : 'invisible'}`}>
      {sub ?? '—'}
    </span>
  </div>
);

PulseItem.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  sub: PropTypes.string,
  subUp: PropTypes.bool,
  niftyGlow: PropTypes.bool,
};

const MarketPulseStrip = ({ market }) => {
  const [countdown, setCountdown] = useState(() => getMarketCountdown());
  useEffect(() => {
    const id = setInterval(() => setCountdown(getMarketCountdown()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!market) {
    return (
      <div className="flex items-center gap-4 rounded-xl glass px-3 py-2.5">
        {[80, 100, 64, 64].map((w, i) => (
          <div key={i} className="skeleton h-8" style={{ width: w }} />
        ))}
      </div>
    );
  }

  const niftyUp    = (market.niftyChangePct ?? 0) >= 0;
  const vix        = market.vix;
  const adRatio    = market.adRatio;
  const holiday    = market.nextHoliday;
  const todayStr   = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const isToday    = holiday?.date === todayStr;
  const isTomorrow = holiday?.daysAway === 1;
  const isSoon     = holiday?.daysAway != null && holiday.daysAway <= 4;

  // Kept in sync with Layout.jsx's sidebar MODE_STYLES — same 4 modes, same hues.
  const modeBg = {
    BULL:    'bg-emerald-500/15 text-emerald-400',
    CAUTION: 'bg-amber-500/15 text-amber-400',
    MIXED:   'bg-orange-500/15 text-orange-400',
    BEAR:    'bg-red-500/15 text-red-400',
  }[market.marketMode] ?? 'bg-slate-700/40 text-slate-400';

  return (
    <div className="flex items-center overflow-x-auto rounded-xl glass px-1 py-2">
      <PulseItem
        label="Nifty 50"
        value={market.niftyPrice?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
        sub={
          market.niftyChangePct != null
            ? `${niftyUp ? '▲' : '▼'} ${Math.abs(market.niftyChangePct).toFixed(2)}%`
            : undefined
        }
        subUp={niftyUp}
        niftyGlow={niftyUp}
      />

      {market.bankNiftyPrice != null && (
        <PulseItem
          label="Bank Nifty"
          value={market.bankNiftyPrice?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
        />
      )}

      <PulseItem
        label="India VIX"
        value={vix?.toFixed(2)}
        sub={vix != null ? (vix >= 20 ? 'HIGH ⚠' : vix >= 15 ? 'ELEVATED' : 'CALM ✓') : undefined}
        subUp={vix != null && vix < 15}
      />

      <PulseItem
        label="A / D Ratio"
        value={adRatio?.toFixed(2)}
        sub={adRatio != null ? (adRatio >= 1 ? '▲ broad advance' : '▼ narrow') : undefined}
        subUp={(adRatio ?? 0) >= 1}
      />

      <div className="ml-auto pl-3 pr-2 flex items-center gap-2 flex-shrink-0">
        {/* Market open/close countdown */}
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold tabular-nums flex items-center gap-1 ${
          countdown.isOpen
            ? 'bg-emerald-500/15 text-emerald-400'
            : 'bg-slate-700/50 text-slate-500'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${countdown.isOpen ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
          {countdown.label}
        </span>
        {isSoon && holiday && (
          <span
            title={`${holiday.name} — ${holiday.date}`}
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium flex items-center gap-1 ${
              isToday
                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                : isTomorrow
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'bg-slate-700/50 text-slate-400 border border-slate-600/50'
            }`}
          >
            🗓
            {isToday
              ? `Market closed · ${holiday.name}`
              : isTomorrow
              ? `Holiday tmrw · ${holiday.name}`
              : `Holiday in ${holiday.daysAway}d · ${holiday.name}`}
          </span>
        )}
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${modeBg}`}>
          {market.marketMode ?? '—'}
        </span>
      </div>
    </div>
  );
};

MarketPulseStrip.propTypes = { market: PropTypes.object };
MarketPulseStrip.defaultProps = { market: null };

export default MarketPulseStrip;
