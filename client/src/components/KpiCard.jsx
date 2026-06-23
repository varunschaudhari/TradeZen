/**
 * @file KpiCard.jsx
 * @description Command-center KPI tile — label, large value, sub-metric, icon, optional progress bar.
 */

import React from 'react';
import PropTypes from 'prop-types';

/* Accent presets keep the dashboard palette consistent */
const ACCENTS = {
  buy:     { icon: 'text-buy bg-buy/10',       bar: 'bg-buy' },
  accent:  { icon: 'text-accent bg-accent/10', bar: 'bg-accent' },
  wait:    { icon: 'text-wait bg-wait/10',     bar: 'bg-wait' },
  bear:    { icon: 'text-bear bg-bear/10',     bar: 'bg-bear' },
  slate:   { icon: 'text-slate-300 bg-slate-700/40', bar: 'bg-slate-500' },
};

const KpiCard = ({ label, value, sub, valueColor, accent, icon, progress, loading, hint }) => {
  const a = ACCENTS[accent] ?? ACCENTS.slate;

  if (loading) {
    return (
      <div className="card animate-pulse">
        <div className="h-3 w-20 bg-slate-700/60 rounded mb-3" />
        <div className="h-7 w-24 bg-slate-700/60 rounded mb-2" />
        <div className="h-3 w-16 bg-slate-700/60 rounded" />
      </div>
    );
  }

  return (
    <div className="card relative overflow-hidden hover:border-slate-600 transition-colors">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
            {label}
            {hint && (
              <span
                title={hint}
                className="grid place-items-center w-3.5 h-3.5 rounded-full border border-slate-600 text-slate-500
                           text-[9px] leading-none cursor-help hover:text-slate-300 hover:border-slate-400"
                aria-label={hint}
              >
                ?
              </span>
            )}
          </p>
          <p className={`text-2xl font-mono font-bold mt-1.5 tabular-nums truncate ${valueColor ?? 'text-slate-100'}`}>
            {value}
          </p>
        </div>
        {icon && (
          <span className={`grid place-items-center w-9 h-9 rounded-lg flex-shrink-0 ${a.icon}`}>
            {icon}
          </span>
        )}
      </div>

      {progress != null ? (
        <div className="mt-3">
          <div className="h-1.5 w-full rounded-full bg-slate-700/60 overflow-hidden">
            <div
              className={`h-full rounded-full ${a.bar} transition-all duration-500`}
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
          {sub && <p className="text-[11px] text-slate-500 mt-1.5">{sub}</p>}
        </div>
      ) : (
        sub && <p className="text-[11px] text-slate-500 mt-1.5">{sub}</p>
      )}
    </div>
  );
};

KpiCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node,
  sub: PropTypes.node,
  valueColor: PropTypes.string,
  accent: PropTypes.oneOf(['buy', 'accent', 'wait', 'bear', 'slate']),
  icon: PropTypes.node,
  progress: PropTypes.number,
  loading: PropTypes.bool,
  hint: PropTypes.string,
};

export default KpiCard;
