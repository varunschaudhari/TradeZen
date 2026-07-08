/**
 * @file disciplineLedger.js
 * @description The discipline ledger: records every trade the system refused (hard
 *   blocks on near-candidates, capital/sector guards, Claude quality downgrades) and
 *   marks each one to market after LEDGER_EVAL_AFTER_DAYS — turning the system's NOs
 *   into a measured number: "capital protected" when the block dodged a loss, an
 *   honest "cost" when it missed a winner. The counterfactual is deliberately simple
 *   and stated: a risk-sized entry at the block-time price, judged on the forward
 *   return at a fixed horizon (no simulated stops/targets — those weren't set).
 *
 *   Recording is fire-and-forget and deduplicated per {symbol, session, type} by a
 *   unique index, so 15-minute scan repeats can't inflate the ledger. Never throws.
 *
 * @author TradeZen Team
 * @created 2026-07-07
 */

import mongoose from 'mongoose';
import BlockedTrade from '../models/BlockedTrade.js';
import { LEDGER_EVAL_AFTER_DAYS, LEDGER_FLAT_BAND_PCT } from '../config/constants.js';
import { getQuotes } from './quoteService.js';
import { logger } from '../config/logger.js';

const round2 = (n) => Math.round(n * 100) / 100;

/** Today's session date string (YYYY-MM-DD, IST). */
function istSessionDate() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Risk-size the hypothetical position exactly like a real trade (pure).
 * No usable stop → shares stay null and the entry is tracked %-only.
 *
 * @param {number} refPrice - Would-be entry price
 * @param {number|null} stopLoss - Planned stop
 * @param {number} capital - Account capital
 * @param {number} riskPct - Risk % per trade
 * @returns {{ shares:number|null, capitalDeployed:number|null }}
 */
export function hypotheticalPosition(refPrice, stopLoss, capital, riskPct) {
  if (!(refPrice > 0) || !(stopLoss > 0) || stopLoss >= refPrice || !(capital > 0)) {
    return { shares: null, capitalDeployed: null };
  }
  const shares = Math.floor((capital * (riskPct / 100)) / (refPrice - stopLoss));
  if (!(shares > 0)) return { shares: null, capitalDeployed: null };
  return { shares, capitalDeployed: round2(shares * refPrice) };
}

/**
 * Classify a forward return into the ledger verdict (pure).
 * PROTECTED = the blocked trade would have LOST (negative forward return).
 *
 * @param {number} fwdReturnPct
 * @returns {'PROTECTED'|'COST'|'FLAT'}
 */
export function classifyOutcome(fwdReturnPct) {
  if (fwdReturnPct <= -LEDGER_FLAT_BAND_PCT) return 'PROTECTED';
  if (fwdReturnPct >= LEDGER_FLAT_BAND_PCT) return 'COST';
  return 'FLAT';
}

/**
 * Record one blocked trade (fire-and-forget safe; dedup via unique index).
 *
 * @param {object} input - { symbol, blockType, reason, refPrice, stopLoss?, sector?,
 *   capital, riskPct }
 * @returns {Promise<object|null>} Created doc, or null (duplicate / no DB / bad input)
 */
export const recordBlockedTrade = async (input) => {
  try {
    if (mongoose.connection.readyState !== 1) return null;
    const { symbol, blockType, reason, refPrice, stopLoss, sector, capital, riskPct } = input;
    if (!symbol || !blockType || !(refPrice > 0)) return null;

    const now = new Date();
    const sized = hypotheticalPosition(refPrice, stopLoss ?? null, capital ?? 0, riskPct ?? 0);
    return await BlockedTrade.create({
      symbol,
      sessionDate: istSessionDate(),
      blockedAt: now,
      blockType,
      reason: reason ?? null,
      sector: sector ?? null,
      refPrice,
      stopLoss: stopLoss ?? null,
      hypotheticalShares: sized.shares,
      hypotheticalCapital: sized.capitalDeployed,
      evaluateAfter: new Date(now.getTime() + LEDGER_EVAL_AFTER_DAYS * 86_400_000),
    });
  } catch (err) {
    if (err.code !== 11000) {
      logger.debug('recordBlockedTrade failed', { symbol: input?.symbol, error: err.message });
    }
    return null;
  }
};

/**
 * JOB 17: mark pending ledger entries to market once their horizon has passed.
 * Never throws — unpriceable symbols stay pending and retry next run.
 *
 * @returns {Promise<{ evaluated:number, protected:number, cost:number, flat:number }>}
 */
export const evaluateBlockedTrades = async () => {
  const summary = { evaluated: 0, protected: 0, cost: 0, flat: 0 };
  try {
    if (mongoose.connection.readyState !== 1) return summary;
    const pending = await BlockedTrade.find({
      evaluatedAt: null,
      evaluateAfter: { $lte: new Date() },
    }).lean();
    if (!pending.length) return summary;

    const quotes = await getQuotes([...new Set(pending.map((b) => b.symbol))]);
    for (const b of pending) {
      const price = quotes[b.symbol]?.price;
      if (price == null || !(b.refPrice > 0)) continue;
      const fwdReturnPct = round2(((price - b.refPrice) / b.refPrice) * 100);
      const verdict = classifyOutcome(fwdReturnPct);
      await BlockedTrade.updateOne(
        { _id: b._id, evaluatedAt: null },
        {
          $set: {
            evaluatedAt: new Date(),
            priceAtEval: price,
            fwdReturnPct,
            hypotheticalPnl:
              b.hypotheticalShares != null
                ? round2(b.hypotheticalShares * (price - b.refPrice))
                : null,
            verdict,
          },
        }
      );
      summary.evaluated += 1;
      if (verdict === 'PROTECTED') summary.protected += 1;
      else if (verdict === 'COST') summary.cost += 1;
      else summary.flat += 1;
    }
    if (summary.evaluated) logger.info('Discipline ledger evaluated', summary);
    return summary;
  } catch (err) {
    logger.error('evaluateBlockedTrades failed', { error: err.message });
    return summary;
  }
};

/**
 * Aggregate the ledger for the UI: headline "capital protected" (net, both directions)
 * plus counts by verdict and block type.
 *
 * @returns {Promise<object>}
 */
export const getLedgerSummary = async () => {
  const all = await BlockedTrade.find().lean();
  const evaluated = all.filter((b) => b.verdict != null);
  const sized = evaluated.filter((b) => b.hypotheticalPnl != null);
  const byVerdict = { PROTECTED: 0, COST: 0, FLAT: 0 };
  const byType = {};
  for (const b of evaluated) byVerdict[b.verdict] += 1;
  for (const b of all) byType[b.blockType] = (byType[b.blockType] ?? 0) + 1;

  // Positive = the blocks saved money net of missed winners (−Σ hypothetical P&L).
  const netCapitalProtected = round2(-sized.reduce((s, b) => s + b.hypotheticalPnl, 0));
  const avgFwdReturnPct = evaluated.length
    ? round2(evaluated.reduce((s, b) => s + (b.fwdReturnPct ?? 0), 0) / evaluated.length)
    : null;

  return {
    totalBlocked: all.length,
    pending: all.length - evaluated.length,
    evaluated: evaluated.length,
    byVerdict,
    byType,
    netCapitalProtected,
    avgFwdReturnPct,
    horizonDays: LEDGER_EVAL_AFTER_DAYS,
  };
};
