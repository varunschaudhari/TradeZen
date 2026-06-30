/**
 * @file WatchlistPrep.jsx
 * @description "Next-session watchlist" — surfaces the latest EOD prep scan (gate-qualified
 *   candidates built from the daily close, for confirming live at the next open). Renders
 *   nothing when no prep scan exists, so it only appears when there's something to show.
 * @author SwingTrader AI Team
 * @created 2026-06-23
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { scanApi } from '../services/api.js';
import { formatCurrency, timeAgo } from '../utils/formatters.js';

const CONF_STYLES = {
  HIGH: 'bg-buy/15 text-buy',
  MEDIUM: 'bg-wait/15 text-wait',
  LOW: 'bg-slate-700/50 text-slate-400',
};

const WatchlistPrep = () => {
  const navigate = useNavigate();
  const [prep, setPrep] = useState(null);

  useEffect(() => {
    let cancelled = false;
    scanApi
      .getPrep()
      .then((res) => { if (!cancelled) setPrep(res.data ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const list = prep?.watchlist ?? [];
  if (!prep || list.length === 0) return null;

  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide flex items-center gap-2">
            <span className="text-accent-light">🔭</span> Next-session watchlist
          </h2>
          <span className="chip bg-surface-elevated/60 text-slate-400">{list.length}</span>
        </div>
        <span
          className="text-xs text-slate-500"
          title="Gate-qualified candidates from the post-close prep scan. Confirm live at the open — not tradeable signals."
        >
          built {timeAgo(prep.createdAt)} · confirm at open
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {list.map((c, i) => (
          <button
            key={c.symbol}
            onClick={() => navigate(`/stock/${c.symbol}`)}
            className="text-left rounded-lg border border-slate-700/60 bg-surface-base/40 hover:border-slate-600
                       hover:bg-surface-elevated/30 transition-colors p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-slate-600 text-xs font-mono">{i + 1}</span>
                <span className="font-mono font-bold text-slate-100 truncate">{c.symbol}</span>
                {c.scoreConfidence && (
                  <span className={`chip ${CONF_STYLES[c.scoreConfidence] ?? 'text-slate-500'}`}>
                    {c.scoreConfidence}
                  </span>
                )}
              </div>
              <span className="text-xs font-mono text-slate-400 whitespace-nowrap">
                {Math.round(c.compositeScore ?? 0)} · {c.gatesPassed ?? 0}/8
              </span>
            </div>
            {c.suggestedEntry != null && (
              <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2 font-mono tabular-nums">
                <span>entry {formatCurrency(c.suggestedEntry, 0)}</span>
                <span className="text-bear">SL {formatCurrency(c.suggestedStopLoss, 0)}</span>
                <span className="text-bull">T1 {formatCurrency(c.suggestedTarget1, 0)}</span>
              </div>
            )}
          </button>
        ))}
      </div>
    </section>
  );
};

export default WatchlistPrep;
