/**
 * @file ActionHero.jsx
 * @description The dashboard's headline answer to "is there anything to act on right now?"
 *   Shows actionable BUY count prominently, or — the common case — an explicit "no actions"
 *   state WITH the reason (market mode / gates), so the user knows *why* nothing fired, not
 *   just that nothing did. Honest by design: BUYs are framed as "review (paper)", not orders.
 * @author SwingTrader AI Team
 * @created 2026-06-27
 */

import React from 'react';
import PropTypes from 'prop-types';

const Icon = ({ d }) => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);
Icon.propTypes = { d: PropTypes.string };
const BOLT = 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z';
const CLOCK = 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z';

/** Plain-language reason there are no BUY signals — derived from market mode + watch count. */
const noBuyReason = (mode, waitCount) => {
  if (mode === 'BEAR') return 'Bear market — Nifty is below its 20 EMA, so every BUY is blocked (Gate 1).';
  if (mode === 'CAUTION') return 'Market in CAUTION — few setups qualify and position sizes are reduced.';
  if (mode === 'MIXED') return 'Narrow market (MIXED) — trading is allowed at reduced size, but setups are scarce.';
  return waitCount > 0
    ? `Conditions are workable, but nothing cleared all 8 gates. ${waitCount} name${waitCount === 1 ? '' : 's'} on watch (WAIT).`
    : 'No setups cleared the gates today. The scanner keeps looking during market hours.';
};

const ActionHero = ({ buyCount, waitCount, totalSignals, market, onViewBuys }) => {
  const hasBuys = buyCount > 0;
  return (
    <section
      className={`card flex flex-wrap items-center justify-between gap-4 border-l-4 ${
        hasBuys ? 'border-l-buy bg-buy/[0.06]' : 'border-l-slate-600'
      }`}
    >
      <div className="flex items-center gap-4 min-w-0">
        <span
          className={`grid place-items-center w-12 h-12 rounded-xl flex-shrink-0 ${
            hasBuys ? 'bg-buy/15 text-buy' : 'bg-surface-elevated/60 text-slate-400'
          }`}
        >
          <Icon d={hasBuys ? BOLT : CLOCK} />
        </span>
        <div className="min-w-0">
          {hasBuys ? (
            <>
              <p className="text-lg font-semibold text-slate-100">
                {buyCount} BUY signal{buyCount === 1 ? '' : 's'} to review
              </p>
              <p className="text-sm text-slate-400">
                Cleared all gates with HIGH confidence — review the setup before acting (paper mode).
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-semibold text-slate-100">No actions right now</p>
              <p className="text-sm text-slate-400">{noBuyReason(market?.marketMode, waitCount)}</p>
            </>
          )}
        </div>
      </div>
      {hasBuys && (
        <button onClick={onViewBuys} className="btn-success text-sm flex-shrink-0">
          Review BUYs →
        </button>
      )}
    </section>
  );
};

ActionHero.propTypes = {
  buyCount: PropTypes.number,
  waitCount: PropTypes.number,
  totalSignals: PropTypes.number,
  market: PropTypes.shape({ marketMode: PropTypes.string }),
  onViewBuys: PropTypes.func,
};

ActionHero.defaultProps = { buyCount: 0, waitCount: 0, totalSignals: 0, market: null, onViewBuys: null };

export default ActionHero;
