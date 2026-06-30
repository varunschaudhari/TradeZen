/**
 * @file MeterBar.jsx
 * @description Compact horizontal gauge — a value marker on a track, with an optional shaded
 *   "healthy" band. Encodes indicators (RSI, Bollinger %B, volume ratio) visually so a trader
 *   reads them at a glance instead of parsing raw numbers.
 * @author SwingTrader AI Team
 * @created 2026-06-28
 */

import React from 'react';
import PropTypes from 'prop-types';

const TONES = { good: '#22c55e', warn: '#eab308', bad: '#ef4444', neutral: '#94a3b8' };

const clampPct = (v, min, max) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));

const MeterBar = ({ label, value, valueText, min, max, band, tone }) => {
  const color = TONES[tone] ?? TONES.neutral;
  const hasVal = value != null && !Number.isNaN(value);
  const mark = hasVal ? clampPct(value, min, max) : null;

  return (
    <div>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500 mb-1">
        <span>{label}</span>
        <span className="font-mono tabular-nums" style={{ color: hasVal ? color : undefined }}>
          {valueText ?? (hasVal ? value : '—')}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-surface-elevated/50 overflow-hidden">
        {band && (
          <div
            className="absolute inset-y-0 bg-buy/20"
            style={{ left: `${clampPct(band[0], min, max)}%`, right: `${100 - clampPct(band[1], min, max)}%` }}
          />
        )}
        {mark != null && (
          <span
            className="absolute top-1/2 w-2.5 h-2.5 rounded-full ring-2 ring-surface-card"
            style={{ left: `${mark}%`, transform: 'translate(-50%, -50%)', background: color }}
          />
        )}
      </div>
    </div>
  );
};

MeterBar.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.number,
  valueText: PropTypes.string,
  min: PropTypes.number,
  max: PropTypes.number,
  band: PropTypes.arrayOf(PropTypes.number), // [lo, hi] healthy zone
  tone: PropTypes.oneOf(['good', 'warn', 'bad', 'neutral']),
};

MeterBar.defaultProps = { value: null, valueText: null, min: 0, max: 100, band: null, tone: 'neutral' };

export default MeterBar;
