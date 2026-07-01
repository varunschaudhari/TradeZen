/**
 * @file SignalCard.jsx
 * @description Signal card showing verdict, indicators, gate count, and trade levels
 */

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { formatCurrency, formatPercent, timeAgo } from '../utils/formatters.js';
import { GATE_NAMES, GATE_DESCRIPTIONS } from '../utils/constants.js';

/* Verdict-driven visual treatment */
const VERDICT_STYLES = {
  BUY:  { accent: 'bg-buy',  ring: 'border-buy/40',   tint: 'bg-buy/[0.04]' },
  WAIT: { accent: 'bg-wait', ring: 'border-wait/40',  tint: 'bg-wait/[0.04]' },
  SKIP: { accent: 'bg-skip', ring: 'border-slate-700/70', tint: '' },
};

const CONFIDENCE_STYLES = {
  HIGH:   'bg-buy/15 text-buy',
  MEDIUM: 'bg-wait/15 text-wait',
  LOW:    'bg-slate-700/50 text-slate-400',
};

/* BUY signals expire at 15:30 IST = 10:00 UTC same IST calendar day */
function computeExpiryMs(createdAt) {
  const d    = new Date(createdAt);
  const dIST = new Date(d.getTime() + 5.5 * 3600 * 1000); // shift to IST
  return Date.UTC(dIST.getUTCFullYear(), dIST.getUTCMonth(), dIST.getUTCDate(), 10, 0, 0);
}

function formatCountdown(ms) {
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const Level = ({ label, value, color = 'text-slate-100' }) => (
  <div className="flex flex-col">
    <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
    <span className={`font-mono text-sm font-medium tabular-nums ${color}`}>{value}</span>
  </div>
);
Level.propTypes = { label: PropTypes.string, value: PropTypes.node, color: PropTypes.string };

const GateRow = ({ name, passed, reason, hint }) => (
  <div className="flex items-start gap-2 text-xs" title={reason || hint}>
    <span className={`mt-0.5 flex-shrink-0 ${passed ? 'text-bull' : 'text-bear'}`}>
      {passed ? '✓' : '✗'}
    </span>
    <span className={`${passed ? 'text-slate-300' : 'text-slate-500 line-through'} cursor-help decoration-dotted underline-offset-2 hover:underline`}>
      {name}
    </span>
    {!passed && reason && <span className="text-slate-500 ml-auto text-right">{reason}</span>}
  </div>
);
GateRow.propTypes = { name: PropTypes.string.isRequired, passed: PropTypes.bool.isRequired, reason: PropTypes.string, hint: PropTypes.string };
GateRow.defaultProps = { reason: '' };

const SignalCard = ({ signal, quote, onPreview, accuracy, onLogTrade }) => {
  const [showGates, setShowGates] = useState(false);
  const style      = VERDICT_STYLES[signal.verdict] ?? VERDICT_STYLES.SKIP;
  const isBuy      = signal.verdict === 'BUY';
  const isWait     = signal.verdict === 'WAIT';
  const gatesPassed = signal.gatesPassed ?? 0;
  const changeUp   = (quote?.changePct ?? 0) >= 0;
  const rsi        = signal.indicators?.rsi;
  const rsiChip    =
    rsi == null ? 'bg-surface-elevated/60 text-slate-400'
    : rsi > 65  ? 'bg-bear/15 text-bear'
    : rsi < 40  ? 'bg-wait/15 text-wait'
    : 'bg-buy/15 text-buy';

  /* ── Expiry countdown (BUY only, updates every 60s) ─────────────── */
  const expiryTs = isBuy && signal.createdAt ? computeExpiryMs(signal.createdAt) : null;
  const [msLeft, setMsLeft] = useState(() => expiryTs != null ? expiryTs - Date.now() : null);

  useEffect(() => {
    if (!expiryTs) return;
    setMsLeft(expiryTs - Date.now());
    const id = setInterval(() => setMsLeft(expiryTs - Date.now()), 60_000);
    return () => clearInterval(id);
  }, [expiryTs]);

  const showCountdown = msLeft != null && msLeft > -3_600_000; // hide >1h after expiry
  const countdownChipCls =
    msLeft == null ? ''
    : msLeft <= 0               ? 'bg-bear/15 text-bear'
    : msLeft < 30 * 60_000      ? 'bg-bear/15 text-bear'
    : msLeft < 90 * 60_000      ? 'bg-wait/15 text-wait'
    : 'bg-surface-elevated/60 text-slate-400';

  return (
    <div className={`card relative overflow-hidden border ${style.ring} ${style.tint} animate-fade-in`}>
      {/* Verdict accent bar */}
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${style.accent}`} />

      {/* Header */}
      <div className="flex items-start justify-between mb-3 pl-1.5">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-lg text-slate-100">{signal.symbol}</span>
            {rsi != null && (
              <span className={`chip ${rsiChip}`} title="RSI 40–65 is the momentum sweet spot (Gate 4)">
                RSI {rsi.toFixed(1)}
              </span>
            )}
            {/* Accuracy chip — shown when there is closed-trade history */}
            {accuracy && accuracy.total > 0 && (
              <span
                className={`chip ${
                  accuracy.winRate >= 60 ? 'bg-buy/15 text-buy'
                  : accuracy.winRate >= 40 ? 'bg-wait/15 text-wait'
                  : 'bg-bear/15 text-bear'
                }`}
                title={`${accuracy.wins} target exits · ${accuracy.losses} SL exits · ${accuracy.total - accuracy.wins - accuracy.losses} other`}
              >
                {accuracy.wins}W {accuracy.losses}L
              </span>
            )}
          </div>
          {quote?.price != null && (
            <div className="flex items-center gap-2 mt-1">
              <span className="font-mono text-sm text-slate-200 tabular-nums">{formatCurrency(quote.price, 0)}</span>
              {quote.changePct != null && (
                <span className={`text-xs font-mono ${changeUp ? 'text-bull' : 'text-bear'}`}>
                  {changeUp ? '▲' : '▼'} {formatPercent(quote.changePct)}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {signal.simonsScore != null && (
            <span className="chip bg-accent/10 text-accent text-xs" title={`Simons composite: ${Math.round(signal.simonsScore)}`}>
              S {Math.round(signal.simonsScore)}
            </span>
          )}
          {onPreview && (
            <button
              onClick={(e) => { e.stopPropagation(); onPreview(signal.symbol); }}
              title="Quick chart preview"
              aria-label="Quick chart preview"
              className="p-1 rounded-md text-slate-500 hover:text-slate-200 hover:bg-surface-elevated/60 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5L9 8l3.75 3.5L21 4M21 4h-4.5M21 4v4.5M3.75 20.25h16.5" />
              </svg>
            </button>
          )}
          <span className={`badge-${signal.verdict?.toLowerCase()}`}>{signal.verdict}</span>
        </div>
      </div>

      {/* BUY — entry/exit levels in a clean grid */}
      {isBuy && (
        <div className="pl-1.5 mb-3">
          <div className="grid grid-cols-3 gap-y-3 gap-x-2 rounded-lg bg-surface-base/40 border border-slate-700/50 p-3">
            <Level
              label="Entry"
              value={`${formatCurrency(signal.entryZone?.low, 0)}–${formatCurrency(signal.entryZone?.high, 0)}`}
            />
            <Level label="Stop" value={formatCurrency(signal.stopLoss, 0)} color="text-bear" />
            <Level label="R:R" value={signal.riskReward ? `${signal.riskReward.toFixed(1)}:1` : '—'} color="text-accent-light" />
            <Level label="Target 1" value={formatCurrency(signal.target1, 0)} color="text-bull" />
            <Level label="Target 2" value={formatCurrency(signal.target2, 0)} color="text-bull" />
            <Level label="Max Loss" value={formatCurrency(signal.maxLoss, 0)} color="text-bear" />
          </div>
          <div className="flex justify-between text-[11px] text-slate-500 mt-2 px-0.5">
            <span>{signal.shares} shares</span>
            <span>Deploys {formatCurrency(signal.capitalDeployed, 0)}</span>
          </div>
        </div>
      )}

      {/* WAIT — show condition only */}
      {isWait && signal.waitCondition && (
        <p className="text-xs text-wait mb-3 pl-1.5">
          <span className="font-semibold">Wait for: </span>{signal.waitCondition}
        </p>
      )}

      {/* Simons override reason (if applicable) */}
      {signal.simonOverride && (
        <p className="text-xs text-accent mb-2 pl-1.5 italic">
          ✨ {signal.simonOverride.reason}
        </p>
      )}

      {/* Reasoning snippet */}
      {signal.reasoning && (
        <p className="text-xs text-slate-400 mb-3 pl-1.5 line-clamp-2 italic">&ldquo;{signal.reasoning}&rdquo;</p>
      )}

      {/* Gate progress + toggle */}
      <div className="pl-1.5">
        <button
          onClick={(e) => { e.stopPropagation(); setShowGates((v) => !v); }}
          className="w-full flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          <span className="flex gap-0.5 flex-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 flex-1 rounded-full ${i < gatesPassed ? style.accent : 'bg-slate-700'}`}
              />
            ))}
          </span>
          <span className="font-mono whitespace-nowrap">{gatesPassed}/8</span>
          <span>{showGates ? '▲' : '▼'}</span>
        </button>

        {showGates && signal.gateDetails && (
          <div className="mt-2 space-y-1 border-t border-slate-700/60 pt-2">
            {Object.entries(GATE_NAMES).map(([key, name]) => (
              <GateRow
                key={key}
                name={name}
                passed={signal.gateDetails[key]?.passed ?? false}
                reason={signal.gateDetails[key]?.reason}
                hint={GATE_DESCRIPTIONS[key]}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-3 pt-2 pl-1.5 border-t border-slate-700/60 flex items-center justify-between text-xs gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {signal.confidence ? (
            <span
              className={`chip cursor-help ${CONFIDENCE_STYLES[signal.confidence] ?? 'text-slate-500'}`}
              title="Model-assigned confidence — NOT yet validated against real outcomes. Treat it as a hypothesis, not a guarantee (paper mode)."
            >
              {signal.confidence} confidence*
            </span>
          ) : <span />}
          {/* Expiry countdown — BUY signals only */}
          {isBuy && showCountdown && (
            <span
              className={`chip ${countdownChipCls}`}
              title="BUY signals expire at 15:30 IST"
            >
              ⏰ {formatCountdown(msLeft)}
            </span>
          )}
          <span className="text-slate-500">{timeAgo(signal.createdAt)}</span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          {isBuy && onLogTrade && (
            <button
              onClick={(e) => { e.stopPropagation(); onLogTrade(signal); }}
              title="Log this trade directly — no need to open the detail page"
              className="px-2 py-1 rounded text-xs bg-emerald-900/60 hover:bg-emerald-800/70 text-emerald-400
                border border-emerald-700/50 font-medium transition-colors"
            >
              + Log Trade
            </button>
          )}
          <Link
            to={`/analysis/${signal.symbol}`}
            className="px-2 py-1 rounded text-xs bg-surface-elevated hover:bg-accent/20 text-accent hover:text-accent transition-colors font-medium"
            title="View comprehensive analysis report"
          >
            📊 Analyze
          </Link>
        </div>
      </div>
    </div>
  );
};

SignalCard.propTypes = {
  signal: PropTypes.shape({
    _id:            PropTypes.string,
    symbol:         PropTypes.string,
    verdict:        PropTypes.string,
    confidence:     PropTypes.string,
    entryZone:      PropTypes.shape({ low: PropTypes.number, high: PropTypes.number }),
    stopLoss:       PropTypes.number,
    target1:        PropTypes.number,
    target2:        PropTypes.number,
    riskReward:     PropTypes.number,
    shares:         PropTypes.number,
    capitalDeployed: PropTypes.number,
    maxLoss:        PropTypes.number,
    gatesPassed:    PropTypes.number,
    gateDetails:    PropTypes.object,
    indicators:     PropTypes.object,
    reasoning:      PropTypes.string,
    waitCondition:  PropTypes.string,
    createdAt:      PropTypes.string,
  }).isRequired,
  quote: PropTypes.shape({
    price:     PropTypes.number,
    changePct: PropTypes.number,
  }),
  onPreview:  PropTypes.func,
  onLogTrade: PropTypes.func,
  accuracy: PropTypes.shape({
    wins:    PropTypes.number,
    losses:  PropTypes.number,
    total:   PropTypes.number,
    winRate: PropTypes.number,
  }),
};

SignalCard.defaultProps = { quote: null, onPreview: null, onLogTrade: null, accuracy: null };

export default SignalCard;
