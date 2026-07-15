/**
 * @file BlockedTrade.js
 * @description Discipline ledger — one document per trade the system REFUSED, marked
 *   to market later so the value of the NOs becomes a measured number instead of an
 *   invisible non-event. Honest in both directions: a block that dodged a loss counts
 *   as PROTECTED, a block that missed a winner counts as COST. One doc per symbol per
 *   session per block type (the unique index absorbs 15-minute scan repeats).
 * @author TradeZen Team
 * @created 2026-07-07
 */

import mongoose from 'mongoose';

export const BLOCK_TYPES = Object.freeze([
  'HARD_BLOCK', // gate 1/2/3/6/8 fired on a stock that otherwise qualified (5+ gates)
  'CAPITAL_GUARD', // daily-loss pause / max positions / regime deployment cap
  'SECTOR_CAP', // sector concentration cap
  'QUALITY_DOWNGRADE', // Claude BUY downgraded: non-HIGH confidence or target geometry
]);

export const LEDGER_VERDICTS = Object.freeze(['PROTECTED', 'COST', 'FLAT']);

const blockedTradeSchema = new mongoose.Schema(
  {
    // Null for signal-quality blocks (HARD_BLOCK/QUALITY_DOWNGRADE — about the stock,
    // shared across every user watching it) — set for portfolio-capacity blocks
    // (CAPITAL_GUARD/SECTOR_CAP — one entry per user whose own book was full).
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    symbol: { type: String, required: true, uppercase: true },
    sessionDate: { type: String, required: true }, // YYYY-MM-DD (IST)
    blockedAt: { type: Date, required: true },
    blockType: { type: String, enum: BLOCK_TYPES, required: true },
    reason: String,
    sector: { type: String, default: null },

    // The hypothetical trade the block prevented
    refPrice: Number, // price at block time (would-be entry reference)
    stopLoss: Number, // planned/suggested stop when known
    hypotheticalShares: Number, // risk-sized like a real trade; null when unsizable
    hypotheticalCapital: Number,

    // Mark-to-market after the horizon (LEDGER_EVAL_AFTER_DAYS)
    evaluateAfter: { type: Date, required: true, index: true },
    evaluatedAt: Date,
    priceAtEval: Number,
    fwdReturnPct: Number, // (priceAtEval − refPrice) / refPrice × 100
    hypotheticalPnl: Number, // shares × (priceAtEval − refPrice); what NOT trading avoided
    verdict: { type: String, enum: [...LEDGER_VERDICTS, null], default: null },
  },
  { timestamps: true, strict: true }
);

// One ledger entry per symbol/session/type/user — doubles as the cross-cycle dedup
// claim. userId is null for shared quality blocks (one entry total) and a real id for
// per-user capacity blocks (one entry per affected user).
blockedTradeSchema.index({ symbol: 1, sessionDate: 1, blockType: 1, userId: 1 }, { unique: true });
blockedTradeSchema.index({ userId: 1, verdict: 1, evaluatedAt: -1 });

export default mongoose.model('BlockedTrade', blockedTradeSchema);
