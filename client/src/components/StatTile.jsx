/**
 * @file StatTile.jsx
 * @description Premium glass/gradient stat tile — shared by the Swing and Intraday
 *   trading hub pages. Tone picks the existing card-{tone} gradient + glow-{tone} text
 *   treatment already used across the app (Positions/Performance), so new pages read as
 *   part of the same system rather than a new visual language.
 */

import React from 'react';
import PropTypes from 'prop-types';

const TONE_STYLES = {
  bull:    { card: 'card-bull',    value: 'text-bull glow-bull' },
  bear:    { card: 'card-bear',    value: 'text-bear glow-bear' },
  wait:    { card: 'card-wait',    value: 'text-wait' },
  accent:  { card: 'card-accent',  value: 'text-accent glow-accent' },
  neutral: { card: '',             value: 'text-slate-100' },
};

const StatTile = ({ label, value, sublabel, tone = 'neutral', icon, loading = false }) => {
  const t = TONE_STYLES[tone] ?? TONE_STYLES.neutral;
  return (
    <div className={`card ${t.card} relative overflow-hidden animate-fade-in-up`}>
      {icon && (
        <div className="absolute -top-1 -right-1 opacity-[0.14] pointer-events-none">
          {icon}
        </div>
      )}
      <p className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      {loading ? (
        <div className="skeleton h-7 w-24 mt-2" />
      ) : (
        <p className={`text-2xl font-bold tabular-nums mt-0.5 ${t.value}`}>{value}</p>
      )}
      {sublabel && !loading && (
        <p className="text-[11px] text-slate-500 mt-1 truncate">{sublabel}</p>
      )}
    </div>
  );
};

StatTile.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node,
  sublabel: PropTypes.node,
  tone: PropTypes.oneOf(['bull', 'bear', 'wait', 'accent', 'neutral']),
  icon: PropTypes.node,
  loading: PropTypes.bool,
};

export default StatTile;
