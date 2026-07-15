/**
 * @file GoLiveGateCard.jsx
 * @description Evidence-based go-live PASS/FAIL per lane (swing + intraday), judged net of
 *   estimated charges and slippage. Mirrors server/src/services/goLiveGate.js exactly —
 *   this card never loosens a threshold to make a lane look ready.
 */

import React from 'react';
import PropTypes from 'prop-types';

const GateLane = ({ title, lane }) => {
  if (!lane) return null;
  return (
    <div className="flex-1 min-w-[260px]">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-slate-300">{title}</span>
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
            lane.pass ? 'bg-bull/20 text-bull' : 'bg-bear/20 text-bear'
          }`}
        >
          {lane.pass ? 'PASS' : 'NOT YET'}
        </span>
      </div>
      <div className="space-y-1">
        {lane.checks.map((c) => (
          <div key={c.key} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-slate-400">
              <span className={c.pass ? 'text-bull' : 'text-bear'}>{c.pass ? '✓' : '✗'}</span>
              {c.label}
            </span>
            <span className="font-mono text-slate-500">
              <span className={c.pass ? 'text-slate-300' : 'text-bear'}>{c.actual ?? '—'}</span>
              <span className="ml-1.5 text-slate-600">need {c.required}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

GateLane.propTypes = { title: PropTypes.string.isRequired, lane: PropTypes.object };

const GoLiveGateCard = ({ gate }) => {
  if (!gate) return null;
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-slate-300 mb-1">Go-Live Gate</h3>
      <p className="text-xs text-slate-500 mb-4">
        Real money is justified only when a lane passes every check — all results judged
        NET of estimated charges and slippage. Passing certifies the evidence is consistent
        with a cost-surviving edge; it is still not a guarantee. Do not loosen a threshold
        to make it pass.
      </p>
      <div className="flex flex-wrap gap-8">
        <GateLane title="Swing (delivery)" lane={gate.swing} />
        <GateLane title="Intraday ORB (experimental)" lane={gate.intraday} />
      </div>
    </div>
  );
};

GoLiveGateCard.propTypes = {
  gate: PropTypes.shape({ swing: PropTypes.object, intraday: PropTypes.object }),
};

export default GoLiveGateCard;
