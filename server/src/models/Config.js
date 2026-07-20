/**
 * @file Config.js
 * @description Mongoose schema for per-user app configuration — one doc per User
 *   (was a true singleton before multi-tenancy; still found via a single query,
 *   just scoped by userId now instead of taking whatever the one doc is).
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import mongoose from 'mongoose';

const watchlistItemSchema = new mongoose.Schema(
  {
    symbol:    { type: String, required: true, uppercase: true },
    sector:    String,
    addedDate: { type: Date, default: Date.now },
    notes:     { type: String, default: '' },
  },
  { _id: false }
);

const configSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    capital: { type: Number, required: true, default: 1000000 },
    riskPercentage: { type: Number, default: 0.4, min: 0.1, max: 5 },
    maxOpenTrades: { type: Number, default: 25, min: 1, max: 30 },
    maxCapitalDeployedPct: { type: Number, default: 95, min: 10, max: 100 },
    watchlist: [watchlistItemSchema],
    telegramChatId: String,
    emailRecipient: String,
    paperTradeMode: { type: Boolean, default: true },
    scannerEnabled: { type: Boolean, default: true },
    // Opt-in: auto-log a PAPER trade for every BUY signal (paper mode only — never a real
    // order). Off by default so it's enabled deliberately. Builds a forward track record.
    autoPaperTrade: { type: Boolean, default: false },
    // Evidence-window start for the go-live gate (goLiveGate.js). Trades/signals created
    // before this timestamp are excluded from go-live evidence — set when a clean
    // observation period begins, so records recovered from a pre-existing backup/CSV (or
    // superseded prototype logic) never get judged as if the current system produced them.
    dataCollectionStartedAt: { type: Date, default: null },
  },
  { timestamps: true, strict: true }
);

export default mongoose.model('Config', configSchema);
