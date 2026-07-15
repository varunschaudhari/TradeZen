/**
 * @file RMultipleBreakdown.jsx
 * @description R-multiple distribution for closed swing trades — buckets each trade's
 *   NET result as a multiple of its own initial risk (entry − stop), so a ₹300 win on a
 *   tight stop and a ₹300 win on a wide stop are correctly told apart. This is the chart
 *   that answers "are winners being cut short relative to how far losers run" directly,
 *   rather than requiring it to be inferred from a handful of individual trades.
 */

import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { formatCurrency } from '../utils/formatters.js';

const BUCKETS = [
  { key: 'lt-2', label: '< -2R', min: -Infinity, max: -2 },
  { key: '-2to-1', label: '-2 to -1R', min: -2, max: -1 },
  { key: '-1to0', label: '-1 to 0R', min: -1, max: 0 },
  { key: '0to1', label: '0 to 1R', min: 0, max: 1 },
  { key: '1to2', label: '1 to 2R', min: 1, max: 2 },
  { key: '2to3', label: '2 to 3R', min: 2, max: 3 },
  { key: 'gt3', label: '> 3R', min: 3, max: Infinity },
];

const bucketFor = (r) => BUCKETS.find((b) => r >= b.min && r < b.max) ?? BUCKETS[BUCKETS.length - 1];

/** Net R-multiple for one closed trade: net P&L ÷ initial risk in ₹ (pure). */
function netRMultiple(trade) {
  const net = trade.netPnl ?? trade.realizedPnl;
  if (net == null || trade.entryPrice == null || trade.stopLoss == null || !trade.shares) return null;
  const riskAmount = Math.abs(trade.entryPrice - trade.stopLoss) * trade.shares;
  return riskAmount > 0 ? net / riskAmount : null;
}

const RMultipleBreakdown = ({ trades }) => {
  const { rows, wins, losses, maxCount } = useMemo(() => {
    const withR = trades
      .map((t) => ({ t, r: netRMultiple(t) }))
      .filter((x) => x.r != null);

    const counts = Object.fromEntries(BUCKETS.map((b) => [b.key, { n: 0, netPnl: 0 }]));
    withR.forEach(({ t, r }) => {
      const b = bucketFor(r);
      counts[b.key].n += 1;
      counts[b.key].netPnl += t.netPnl ?? t.realizedPnl ?? 0;
    });

    const wins = withR.filter((x) => x.r > 0);
    const losses = withR.filter((x) => x.r <= 0);
    const avg = (arr, sel) => (arr.length ? arr.reduce((s, x) => s + sel(x), 0) / arr.length : null);

    return {
      rows: BUCKETS.map((b) => ({ ...b, ...counts[b.key] })),
      wins: {
        n: wins.length,
        avgR: avg(wins, (x) => x.r),
        avgInr: avg(wins, (x) => x.t.netPnl ?? x.t.realizedPnl ?? 0),
      },
      losses: {
        n: losses.length,
        avgR: avg(losses, (x) => x.r),
        avgInr: avg(losses, (x) => x.t.netPnl ?? x.t.realizedPnl ?? 0),
      },
      maxCount: Math.max(1, ...Object.values(counts).map((c) => c.n)),
    };
  }, [trades]);

  const totalSample = wins.n + losses.n;
  const payoffRatio =
    wins.avgInr != null && losses.avgInr != null && losses.avgInr !== 0
      ? Math.abs(wins.avgInr / losses.avgInr)
      : null;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-slate-300">R-Multiple Distribution</h3>
        <span className="text-[11px] text-slate-500">{totalSample} closed trade{totalSample === 1 ? '' : 's'} with valid risk</span>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Each trade&rsquo;s net P&amp;L divided by its own initial risk (entry − stop). Bars right of
        zero are wins, left are losses — the shape shows whether wins and losses are similarly
        sized, or one side is quietly winning the count while losing the money.
      </p>

      {totalSample === 0 ? (
        <p className="text-slate-500 text-sm text-center py-8">
          No closed trades with a valid entry/stop pair yet.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Avg Win</p>
              <p className="font-mono font-semibold text-sm text-bull">
                {wins.n ? `+${wins.avgR.toFixed(2)}R` : '—'}
              </p>
              <p className="text-[11px] text-slate-500">{wins.n ? formatCurrency(wins.avgInr) : `${wins.n} wins`}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Avg Loss</p>
              <p className="font-mono font-semibold text-sm text-bear">
                {losses.n ? `${losses.avgR.toFixed(2)}R` : '—'}
              </p>
              <p className="text-[11px] text-slate-500">{losses.n ? formatCurrency(losses.avgInr) : `${losses.n} losses`}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Payoff Ratio</p>
              <p className={`font-mono font-semibold text-sm ${payoffRatio == null ? 'text-slate-300' : payoffRatio >= 1 ? 'text-bull' : 'text-wait'}`}>
                {payoffRatio != null ? `${payoffRatio.toFixed(2)}×` : '—'}
              </p>
              <p className="text-[11px] text-slate-500">avg win ÷ avg loss size</p>
            </div>
          </div>

          <div className="space-y-2">
            {rows.map((b) => {
              const positive = b.min >= 0;
              const widthPct = Math.round((b.n / maxCount) * 100);
              return (
                <div key={b.key} className="flex items-center gap-3">
                  <span className="w-20 text-[11px] font-mono text-slate-500 flex-shrink-0 text-right">{b.label}</span>
                  <div className="flex-1 h-4 rounded bg-surface-elevated/50 relative overflow-hidden group">
                    <div
                      className={`absolute inset-y-0 left-0 rounded transition-all duration-500 ${positive ? 'bg-bull' : 'bg-bear'}`}
                      style={{ width: `${widthPct}%`, opacity: 0.85 }}
                      title={`${b.n} trade${b.n === 1 ? '' : 's'} · ${formatCurrency(b.netPnl)} net`}
                    />
                  </div>
                  <span className="w-8 text-[11px] font-mono text-slate-400 text-right flex-shrink-0">{b.n || ''}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

RMultipleBreakdown.propTypes = {
  trades: PropTypes.array.isRequired,
};

export default RMultipleBreakdown;
