import React, { useMemo, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { formatCurrency } from '../utils/formatters.js';
import LogTradeModal from './LogTradeModal.jsx';

const MAX_SHOW = 5;

const TodaySignals = ({ signals, onViewAll }) => {
  const navigate  = useNavigate();
  const [copiedId,       setCopiedId]       = useState(null);
  const [logTradePrefill, setLogTradePrefill] = useState(null);

  const copyEntry = useCallback((e, s) => {
    e.stopPropagation();
    const low  = formatCurrency(s.entryZone.low, 0);
    const high = s.entryZone.high && s.entryZone.high !== s.entryZone.low
      ? `–${formatCurrency(s.entryZone.high, 0)}`
      : '';
    navigator.clipboard.writeText(`${s.symbol} entry ${low}${high}`).then(() => {
      setCopiedId(s._id);
      toast.success(`${s.symbol} entry copied`);
      setTimeout(() => setCopiedId(null), 1800);
    });
  }, []);

  const todayBuys = useMemo(() => {
    const nowIST = new Date(Date.now() + 5.5 * 3600 * 1000);
    const todayStr = nowIST.toISOString().slice(0, 10);
    return signals
      .filter((s) => {
        if (s.verdict !== 'BUY') return false;
        const d = new Date(s.createdAt);
        const dIST = new Date(d.getTime() + 5.5 * 3600 * 1000);
        return dIST.toISOString().slice(0, 10) === todayStr;
      })
      .slice(0, MAX_SHOW);
  }, [signals]);

  return (
    <div className="card space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
            Today&apos;s BUY Signals
          </h2>
          {todayBuys.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">
              {todayBuys.length}
            </span>
          )}
        </div>
        <button
          onClick={onViewAll}
          className="text-xs text-accent hover:underline hover:text-accent-light"
        >
          View all signals →
        </button>
      </div>

      {/* Empty state */}
      {todayBuys.length === 0 ? (
        <div className="py-6 text-center space-y-1">
          <p className="text-2xl">🔍</p>
          <p className="text-slate-400 text-sm font-medium">No HIGH-confidence BUY setups today</p>
          <p className="text-slate-500 text-xs">
            Scanner runs every 15 min — alerts arrive via WebSocket when gates clear
          </p>
        </div>
      ) : (
        <div className="stagger-grid grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {todayBuys.map((s) => {
            const rr = s.riskReward?.toFixed(1);
            const isCopied = copiedId === s._id;
            const notActionable = s.myActionability && s.myActionability.verdict !== 'BUY';
            return (
              <div
                key={s._id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/stock/${s.symbol}`)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/stock/${s.symbol}`); }}
                className="group flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5
                           hover:border-emerald-500/40 hover:bg-emerald-500/10 transition-all px-3 py-2.5 cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  {/* Symbol + badges */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-slate-100 text-sm">{s.symbol}</span>
                    <span className="badge-buy text-[10px] px-1.5 py-px">BUY</span>
                    {s.confidence === 'HIGH' && (
                      <span className="chip bg-emerald-500/20 text-emerald-400">HIGH</span>
                    )}
                    <span className="chip bg-slate-700/60 text-slate-400">{s.gatesPassed}/8 gates</span>
                    {notActionable && (
                      <span
                        className="chip bg-slate-700/60 text-slate-400"
                        title={s.myActionability.waitCondition}
                      >
                        ⏸ Not for you
                      </span>
                    )}
                  </div>

                  {notActionable && (
                    <p className="text-[11px] text-slate-500 mt-0.5">{s.myActionability.waitCondition}</p>
                  )}

                  {/* Entry zone + copy button */}
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400 font-mono">
                    {s.entryZone?.low != null && (
                      <button
                        onClick={(e) => copyEntry(e, s)}
                        title="Copy entry zone"
                        className={`flex items-center gap-1 transition-colors rounded px-1 -mx-1 hover:text-slate-200 ${
                          isCopied ? 'text-emerald-400' : ''
                        }`}
                      >
                        <span>
                          Entry {formatCurrency(s.entryZone.low, 0)}
                          {s.entryZone.high && s.entryZone.high !== s.entryZone.low
                            ? `–${formatCurrency(s.entryZone.high, 0)}`
                            : ''}
                        </span>
                        <span className="text-[10px] opacity-50 group-hover:opacity-100 transition-opacity">
                          {isCopied ? '✓' : '⎘'}
                        </span>
                      </button>
                    )}
                    {rr && <span className="text-emerald-400/80">RR {rr}:1</span>}
                  </div>
                </div>

                {/* Log Trade button */}
                <button
                  onClick={(e) => { e.stopPropagation(); setLogTradePrefill(s); }}
                  title="Log this trade without opening the detail page"
                  className="shrink-0 text-[11px] px-2.5 py-1.5 rounded-lg font-semibold transition-colors
                    bg-emerald-900/60 hover:bg-emerald-800/70 text-emerald-300 border border-emerald-700/50"
                >
                  + Log
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Log Trade modal — pre-filled from signal */}
      {logTradePrefill && (
        <LogTradeModal
          prefill={logTradePrefill}
          onClose={() => setLogTradePrefill(null)}
        />
      )}
    </div>
  );
};

TodaySignals.propTypes = {
  signals: PropTypes.array.isRequired,
  onViewAll: PropTypes.func.isRequired,
};

export default TodaySignals;
