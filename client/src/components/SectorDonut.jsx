/**
 * @file SectorDonut.jsx
 * @description Sector concentration donut for currently-open swing positions —
 *   surfaces the same sector caps tracked by MAX_POSITIONS_PER_SECTOR / MAX_SECTOR_DEPLOYED_PCT.
 */

import React from 'react';
import PropTypes from 'prop-types';
import { formatCurrency } from '../utils/formatters.js';

const SECTOR_PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444', '#84cc16', '#f97316'];

const SectorDonut = ({ data }) => {
  const sectors = data?.sectors ?? [];
  if (!sectors.length) return null;

  const R = 56, r = 34, cx = 70, cy = 70;
  const totalPct = sectors.reduce((s, d) => s + d.pct, 0) || 100;
  const arcs = [];
  let angle = -90;

  sectors.forEach((sec, i) => {
    const sweep = (sec.pct / totalPct) * 360;
    const end   = angle + sweep;
    const rad   = (deg) => (deg * Math.PI) / 180;
    const x1 = cx + R * Math.cos(rad(angle));
    const y1 = cy + R * Math.sin(rad(angle));
    const x2 = cx + R * Math.cos(rad(end));
    const y2 = cy + R * Math.sin(rad(end));
    const ix1 = cx + r * Math.cos(rad(angle));
    const iy1 = cy + r * Math.sin(rad(angle));
    const ix2 = cx + r * Math.cos(rad(end));
    const iy2 = cy + r * Math.sin(rad(end));
    const large = sweep > 180 ? 1 : 0;
    const path = [
      `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
      `A ${R} ${R} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
      `L ${ix2.toFixed(2)} ${iy2.toFixed(2)}`,
      `A ${r} ${r} 0 ${large} 0 ${ix1.toFixed(2)} ${iy1.toFixed(2)}`,
      'Z',
    ].join(' ');
    arcs.push({ path, color: SECTOR_PALETTE[i % SECTOR_PALETTE.length], sec });
    angle = end;
  });

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-slate-300 mb-3">Sector Concentration — Open Positions</h3>
      {data.hasWarning && (
        <div className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-3 py-1.5 mb-3">
          High concentration — one sector exceeds {data.warningThreshold}% of deployed capital
        </div>
      )}
      <div className="flex flex-wrap gap-6 items-center">
        <svg width="140" height="140" viewBox="0 0 140 140" className="flex-shrink-0">
          {arcs.map((arc, i) => (
            <path key={i} d={arc.path} fill={arc.color} fillOpacity={0.85}>
              <title>{arc.sec.sector}: {arc.sec.pct.toFixed(1)}%</title>
            </path>
          ))}
          <text x="70" y="66" textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="monospace">DEPLOYED</text>
          <text x="70" y="80" textAnchor="middle" fill="#e2e8f0" fontSize="12" fontWeight="700" fontFamily="monospace">
            {data.totalDeployed >= 100000
              ? `₹${(data.totalDeployed / 100000).toFixed(1)}L`
              : `₹${(data.totalDeployed / 1000).toFixed(0)}K`}
          </text>
        </svg>
        <div className="flex flex-col gap-2 min-w-0 flex-1">
          {arcs.map((arc, i) => (
            <div key={i} className="flex items-center gap-2 text-xs min-w-0">
              <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: arc.color }} />
              <span className="text-slate-400 truncate flex-1">{arc.sec.sector}</span>
              <span className="text-slate-300 font-mono font-semibold">{arc.sec.pct.toFixed(1)}%</span>
              <span className="text-slate-500 font-mono text-[10px]">{formatCurrency(arc.sec.deployed)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

SectorDonut.propTypes = {
  data: PropTypes.object,
};

export default SectorDonut;
