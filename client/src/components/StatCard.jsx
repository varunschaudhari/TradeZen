/**
 * @file StatCard.jsx
 * @description Simple centered stat card — label, mono value, optional sublabel — shared
 *   across the Performance / Trade Ledger / Risk & Attribution / Go-Live Evidence pages.
 */

import React from 'react';
import PropTypes from 'prop-types';

const COLOR_CARD_MAP = {
  'text-emerald-400': 'card-bull',
  'text-red-400':     'card-bear',
  'text-amber-400':   'card-wait',
  'text-blue-400':    'card-accent',
};

const StatCard = ({ label, value, sub = null, color = null }) => {
  const cardVariant = COLOR_CARD_MAP[color] ?? '';
  return (
    <div className={`card text-center ${cardVariant}`}>
      <p className="text-slate-400 text-xs mb-1">{label}</p>
      <p className={`text-2xl font-mono font-bold ${color ?? 'text-slate-100'}`}>{value}</p>
      {sub && <p className="text-slate-500 text-xs mt-1">{sub}</p>}
    </div>
  );
};

StatCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node.isRequired,
  sub: PropTypes.node,
  color: PropTypes.string,
};

export default StatCard;
