/**
 * @file TradeCard.jsx
 * @description Active trade card with full entry/exit levels and quick-action buttons
 */

import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { formatCurrency, formatPercent, formatDateTime } from '../utils/formatters.js';
import PositionTracker from './PositionTracker.jsx';

const ACTION_STYLES = {
  HOLD:       { box: 'bg-slate-700/40 border-slate-600 text-slate-300',  label: 'Hold' },
  TRAIL_STOP: { box: 'bg-accent/10 border-accent/40 text-accent',        label: 'Trail stop' },
  BOOK_T1:    { box: 'bg-bull/10 border-bull/40 text-bull',              label: 'Book T1' },
  BOOK_T2:    { box: 'bg-bull/15 border-bull/50 text-bull',              label: 'Book T2' },
  EXIT_RISK:  { box: 'bg-bear/10 border-bear/40 text-bear',              label: 'Exit risk' },
};

const TradeCard = ({ trade, onMarkT1Hit, onMarkClosed, onMarkSLHit, onTrailStop, onUpdateNotes, onQuickClose }) => {
  const [notesOpen,    setNotesOpen]    = useState(false);
  const [draftNotes,   setDraftNotes]   = useState(trade.notes ?? '');
  const [savingNotes,  setSavingNotes]  = useState(false);
  const [pendingClose, setPendingClose] = useState(false);

  const pnlClass    = (trade.unrealizedPnl ?? 0) >= 0 ? 'text-bull' : 'text-bear';
  const live        = trade.live;
  const actionStyle = live ? (ACTION_STYLES[live.action] ?? ACTION_STYLES.HOLD) : null;
  const hasPrice    = trade.currentPrice != null && trade.currentPrice > 0;

  const saveNotes = async () => {
    if (!onUpdateNotes) return;
    setSavingNotes(true);
    try {
      await onUpdateNotes(trade._id, draftNotes);
      setNotesOpen(false);
    } finally {
      setSavingNotes(false);
    }
  };

  return (
    <div className="card border border-buy/20 bg-buy/5 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-lg">{trade.symbol}</span>
          {live && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${actionStyle.box}`} title={live.reason}>
              {actionStyle.label}
            </span>
          )}
        </div>
        <div className="text-right">
          <div className={`font-mono font-semibold ${pnlClass}`}>
            {formatCurrency(trade.unrealizedPnl)}
          </div>
          <div className={`text-xs ${pnlClass}`}>
            {formatPercent(trade.unrealizedPnlPct)}
            {live && <span className="text-slate-500"> · {live.rMultiple}R</span>}
          </div>
        </div>
      </div>

      {/* Price tracker bar */}
      <PositionTracker trade={trade} />

      {/* Live action strip */}
      {live && (
        <div className={`rounded-lg border px-2.5 py-2 text-xs ${actionStyle.box}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{live.reason}</span>
            {live.slDistancePct != null && (
              <span className="text-slate-400 whitespace-nowrap" title="Distance to stop">
                SL {live.slDistancePct}%
              </span>
            )}
          </div>
          {live.canTrail && onTrailStop && (
            <button
              onClick={() => onTrailStop(trade._id, live.suggestedStop)}
              className="mt-1.5 w-full bg-accent/20 hover:bg-accent/30 text-accent border border-accent/40 rounded py-1 transition-colors"
            >
              Trail SL → {formatCurrency(live.suggestedStop)}
            </button>
          )}
        </div>
      )}

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-400">Entry</span>
          <span className="font-mono">{formatCurrency(trade.entryPrice)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Current</span>
          <span className="font-mono">{formatCurrency(trade.currentPrice)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Stop Loss</span>
          <span className="font-mono text-bear">{formatCurrency(trade.stopLoss)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">
            {trade.target1Hit ? 'T1 ✓' : 'Target 1'}
          </span>
          <span className={`font-mono ${trade.target1Hit ? 'text-slate-500 line-through' : 'text-bull'}`}>
            {formatCurrency(trade.target1)}
          </span>
        </div>
        {trade.target2 && (
          <div className="flex justify-between">
            <span className={`text-slate-400 ${trade.target1Hit ? 'text-bull font-medium' : ''}`}>
              Target 2
            </span>
            <span className="font-mono text-bull">{formatCurrency(trade.target2)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-slate-400">Shares</span>
          <span className="font-mono">{trade.shares}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Deployed</span>
          <span className="font-mono text-xs">{formatCurrency(trade.capitalDeployed)}</span>
        </div>
      </div>

      <div className="text-xs text-slate-500">
        Entered {formatDateTime(trade.entryDate)}
      </div>

      {/* ── Notes section ─────────────────────────────────────────────── */}
      {notesOpen ? (
        <div className="space-y-1.5 pt-1">
          <textarea
            value={draftNotes}
            onChange={(e) => setDraftNotes(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Why I entered this trade…"
            className="input w-full text-xs resize-none"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={saveNotes}
              disabled={savingNotes}
              className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {savingNotes ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setDraftNotes(trade.notes ?? ''); setNotesOpen(false); }}
              className="text-xs px-3 py-1 text-slate-400 hover:text-slate-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setNotesOpen(true)}
          className="text-left w-full text-xs text-slate-500 hover:text-slate-300 transition-colors truncate"
          title={trade.notes || 'Add a trade journal note'}
        >
          {trade.notes
            ? <><span className="text-slate-400 mr-1">✏</span>{trade.notes}</>
            : <span className="text-slate-600 italic">+ Add note…</span>
          }
        </button>
      )}

      {/* ── Quick close confirm strip ──────────────────────────────────── */}
      {pendingClose && (
        <div className="flex items-center gap-2 rounded-lg bg-slate-700/50 border border-slate-600/50 px-2.5 py-2 text-xs">
          <span className="text-slate-300 flex-1">
            Close at <span className="font-mono font-semibold">{hasPrice ? formatCurrency(trade.currentPrice) : '—'}</span>?
          </span>
          <button
            onClick={() => { onQuickClose(trade._id, trade.currentPrice); setPendingClose(false); }}
            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium"
          >
            ✓
          </button>
          <button
            onClick={() => setPendingClose(false)}
            className="px-2.5 py-1 bg-slate-600 hover:bg-slate-500 text-slate-200 rounded"
          >
            ✗
          </button>
        </div>
      )}

      {/* ── Action buttons ─────────────────────────────────────────────── */}
      <div className="flex gap-2 pt-1">
        {!trade.target1Hit && (
          <button
            onClick={() => onMarkT1Hit(trade._id)}
            className="flex-1 text-xs bg-bull/20 hover:bg-bull/30 text-bull border border-bull/30 rounded-lg py-1.5 transition-colors"
          >
            T1 Hit
          </button>
        )}
        <button
          onClick={() => onMarkSLHit(trade._id)}
          className="flex-1 text-xs bg-bear/20 hover:bg-bear/30 text-bear border border-bear/30 rounded-lg py-1.5 transition-colors"
        >
          SL Hit
        </button>
        {!pendingClose && (
          <button
            onClick={() => setPendingClose(true)}
            disabled={!hasPrice}
            title={hasPrice ? `Quick close at ${formatCurrency(trade.currentPrice)}` : 'No price available'}
            className="flex-1 text-xs bg-emerald-900/40 hover:bg-emerald-800/50 text-emerald-400 border border-emerald-700/30 rounded-lg py-1.5 transition-colors disabled:opacity-40"
          >
            ⚡ {hasPrice ? formatCurrency(trade.currentPrice, 0) : 'Quick'}
          </button>
        )}
        <button
          onClick={() => onMarkClosed(trade._id)}
          className="flex-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg py-1.5 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
};

TradeCard.propTypes = {
  trade: PropTypes.shape({
    _id:              PropTypes.string.isRequired,
    symbol:           PropTypes.string.isRequired,
    entryPrice:       PropTypes.number,
    currentPrice:     PropTypes.number,
    stopLoss:         PropTypes.number,
    target1:          PropTypes.number,
    target1Hit:       PropTypes.bool,
    shares:           PropTypes.number,
    capitalDeployed:  PropTypes.number,
    unrealizedPnl:    PropTypes.number,
    unrealizedPnlPct: PropTypes.number,
    entryDate:        PropTypes.string,
    notes:            PropTypes.string,
    live: PropTypes.shape({
      action:        PropTypes.string,
      reason:        PropTypes.string,
      rMultiple:     PropTypes.number,
      slDistancePct: PropTypes.number,
      suggestedStop: PropTypes.number,
      canTrail:      PropTypes.bool,
    }),
  }).isRequired,
  onMarkT1Hit:    PropTypes.func.isRequired,
  onMarkClosed:   PropTypes.func.isRequired,
  onMarkSLHit:    PropTypes.func.isRequired,
  onTrailStop:    PropTypes.func,
  onUpdateNotes:  PropTypes.func,
  onQuickClose:   PropTypes.func,
};

export default TradeCard;
