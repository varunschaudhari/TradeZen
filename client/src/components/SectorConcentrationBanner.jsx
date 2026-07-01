/**
 * @file SectorConcentrationBanner.jsx
 * @description Shows a warning when any single sector holds ≥40% of deployed capital.
 *   Also renders a compact sector bar below the warning so the user can see the full
 *   breakdown at a glance without navigating to Positions.
 */

import React from 'react';
import PropTypes from 'prop-types';
import { formatCurrency } from '../utils/formatters.js';

const WARN_PCT  = 40;
const BAR_COLORS = [
  'bg-violet-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-red-500',    'bg-pink-500', 'bg-cyan-500',    'bg-orange-500',
];

const SectorConcentrationBanner = ({ data }) => {
  if (!data || !data.sectors?.length) return null;

  const warnings = data.sectors.filter((s) => s.pct >= WARN_PCT);
  if (!data.hasWarning) {
    // No warning — render the compact sector bar only (non-intrusive)
    return (
      <div className="card py-2.5 px-3 flex items-center gap-3 flex-wrap">
        <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wide flex-shrink-0">
          Sector spread
        </span>
        <div className="flex-1 flex gap-1 min-w-0">
          {data.sectors.map((s, i) => (
            <div
              key={s.sector}
              title={`${s.sector}: ${s.pct}% (${s.symbols.join(', ')})`}
              className={`h-2 rounded-full ${BAR_COLORS[i % BAR_COLORS.length]} opacity-70`}
              style={{ width: `${s.pct}%`, minWidth: 4 }}
            />
          ))}
        </div>
        <div className="flex items-center gap-3 flex-wrap text-[11px] text-slate-500">
          {data.sectors.map((s, i) => (
            <span key={s.sector} className="flex items-center gap-1 flex-shrink-0">
              <span className={`w-1.5 h-1.5 rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`} />
              {s.sector} {s.pct}%
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="card border border-amber-500/30 bg-amber-500/[0.06] space-y-2">
      {/* Warning header */}
      <div className="flex items-start gap-3">
        <span className="text-amber-400 text-lg leading-none flex-shrink-0 mt-0.5">⚠</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-300">Sector concentration warning</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {warnings.map((w) => (
              <span key={w.sector}>
                <strong className="text-amber-400">{w.sector}</strong> holds <strong className="text-amber-400">{w.pct}%</strong> of your deployed capital
                {' '}({w.symbols.join(', ')}).{' '}
              </span>
            ))}
            Consider diversifying to reduce single-sector exposure below {WARN_PCT}%.
          </p>
        </div>
      </div>

      {/* Sector breakdown bar */}
      <div className="space-y-1.5">
        <div className="flex h-2 rounded-full overflow-hidden gap-px">
          {data.sectors.map((s, i) => (
            <div
              key={s.sector}
              title={`${s.sector}: ${s.pct}% · ${formatCurrency(s.deployed)}`}
              className={`${BAR_COLORS[i % BAR_COLORS.length]} ${s.pct >= WARN_PCT ? '' : 'opacity-50'} transition-all`}
              style={{ width: `${s.pct}%`, minWidth: 4 }}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {data.sectors.map((s, i) => (
            <span key={s.sector} className={`flex items-center gap-1 text-[11px] ${s.pct >= WARN_PCT ? 'text-amber-400 font-medium' : 'text-slate-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${BAR_COLORS[i % BAR_COLORS.length]} ${s.pct >= WARN_PCT ? '' : 'opacity-50'}`} />
              {s.sector} {s.pct}%
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

SectorConcentrationBanner.propTypes = {
  data: PropTypes.shape({
    sectors:          PropTypes.array,
    totalDeployed:    PropTypes.number,
    hasWarning:       PropTypes.bool,
    warningThreshold: PropTypes.number,
  }),
};

export default SectorConcentrationBanner;
