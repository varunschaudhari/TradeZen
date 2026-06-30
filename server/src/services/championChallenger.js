/**
 * @file championChallenger.js
 * @description The "safely change" half of the continuous-improvement loop. Given a CHAMPION
 *   weighting (the current live config) and a CHALLENGER (a proposed change), it re-scores the
 *   SAME backtested trades under each, computes the net-of-cost expectancy of the "would-act"
 *   cohort (score ≥ threshold), and compares them IN-SAMPLE and OUT-OF-SAMPLE. A challenger is
 *   PROMOTED only if it beats the champion OUT-OF-SAMPLE, net-positive, by a margin, with a real
 *   sample — the exact discipline that would have stopped every overfit "improvement" this
 *   project produced.
 *
 *   Weights are keyed by the per-trade signalFlags the backtest captures (RSI_SWEET_SPOT,
 *   RS_STRONG_LEADER, BB_OVERBOUGHT, …). score = base + Σ weight[flag for flag in trade.flags].
 *
 * @author TradeZen Team
 * @created 2026-06-27
 */

const round2 = (n) => Math.round(n * 100) / 100;
export const BASE_SCORE = 40;

/** Champion weighting — mirrors the live composite's price-signal contributions. */
export const CHAMPION_WEIGHTS = Object.freeze({
  RSI_SWEET_SPOT: 10,
  RS_STRONG_LEADER: 8,
  NEAR_52W_HIGH: 4,
  RSI_OVERBOUGHT: -8,
  BB_OVERBOUGHT: -8,
  // everything else (momentum buckets, mean-reversion, volume flags, RS lower tiers) = 0
});

/**
 * Composite score for a trade from its signal flags under a weighting (pure).
 * @param {string[]} flags
 * @param {Object<string,number>} weights
 * @param {number} [base=BASE_SCORE]
 * @returns {number}
 */
export function scoreFromFlags(flags, weights, base = BASE_SCORE) {
  let s = base;
  for (const f of flags ?? []) s += weights[f] ?? 0;
  return s;
}

const netR = (t) => (t.rMultiple ?? 0) - (t.costInR ?? 0);

/**
 * Net-of-cost expectancy of the "would-act" cohort (trades scoring ≥ threshold) under a
 * weighting (pure).
 * @param {object[]} trades - each with { signalFlags, rMultiple, costInR }
 * @param {Object<string,number>} weights
 * @param {number} threshold
 * @returns {{ n:number, netAvgR:number, winRate:number }}
 */
export function evaluateConfig(trades, weights, threshold) {
  const cohort = (trades ?? []).filter((t) => scoreFromFlags(t.signalFlags, weights) >= threshold);
  const n = cohort.length;
  if (!n) return { n: 0, netAvgR: 0, winRate: 0 };
  const sum = cohort.reduce((a, t) => a + netR(t), 0);
  const wins = cohort.filter((t) => netR(t) > 0).length;
  return { n, netAvgR: round2(sum / n), winRate: round2((wins / n) * 100) };
}

/**
 * Compare champion vs challenger and decide promotion (pure).
 * Promotion gate: challenger must beat champion OUT-OF-SAMPLE, be net-positive OOS, clear a
 * minimum margin, and have a minimum OOS cohort size.
 *
 * @param {object} args - { champion, challenger, threshold, inSample, oos, margin, minN }
 * @returns {object}
 */
export function compareConfigs({
  champion,
  challenger,
  threshold,
  inSample,
  oos,
  margin = 0.03,
  minN = 30,
}) {
  const champIS = evaluateConfig(inSample, champion, threshold);
  const chalIS = evaluateConfig(inSample, challenger, threshold);
  const champOOS = evaluateConfig(oos, champion, threshold);
  const chalOOS = evaluateConfig(oos, challenger, threshold);

  const beatsOOS = chalOOS.netAvgR >= champOOS.netAvgR + margin;
  const netPositiveOOS = chalOOS.netAvgR > 0;
  const enoughOOS = chalOOS.n >= minN;
  const promote = beatsOOS && netPositiveOOS && enoughOOS;

  let reason;
  if (promote) {
    reason = `OOS net ${chalOOS.netAvgR}R vs champion ${champOOS.netAvgR}R (+${round2(chalOOS.netAvgR - champOOS.netAvgR)}R, n=${chalOOS.n}).`;
  } else if (!enoughOOS) {
    reason = `OOS cohort too small (n=${chalOOS.n} < ${minN}).`;
  } else if (!netPositiveOOS) {
    reason = `Challenger is not net-positive OOS (${chalOOS.netAvgR}R).`;
  } else {
    reason = `Challenger doesn't beat champion OOS by ≥${margin}R (challenger ${chalOOS.netAvgR}R vs champion ${champOOS.netAvgR}R).`;
  }

  return {
    threshold,
    champIS,
    chalIS,
    champOOS,
    chalOOS,
    promote,
    verdict: `${promote ? 'PROMOTE' : 'REJECT'} — ${reason}`,
  };
}
