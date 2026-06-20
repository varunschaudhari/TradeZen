/**
 * @file Config.js
 * @description Mongoose schema for single-document app configuration (singleton pattern)
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import mongoose from 'mongoose';
import { MARKET_MODES } from '../config/constants.js';

const watchlistItemSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, uppercase: true },
    sector: String,
    addedDate: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Last successful market-health snapshot — used as a fallback when the Python
// service is unreachable (see marketHealthService.getMarketHealth).
const marketHealthSnapshotSchema = new mongoose.Schema(
  {
    niftyPrice: Number,
    niftyEma20: Number,
    niftyChangePct: Number,
    bankNiftyPrice: Number,
    bankNiftyEma20: Number,
    vix: Number,
    adRatio: Number,
    marketMode: { type: String, enum: Object.values(MARKET_MODES) },
    allowTrading: Boolean,
    reason: String,
    capturedAt: Date,
  },
  { _id: false }
);

const configSchema = new mongoose.Schema(
  {
    capital: { type: Number, required: true, default: 1000000 },
    riskPercentage: { type: Number, default: 1, min: 0.1, max: 5 },
    maxOpenTrades: { type: Number, default: 3, min: 1, max: 10 },
    maxCapitalDeployedPct: { type: Number, default: 60, min: 10, max: 90 },
    watchlist: [watchlistItemSchema],
    telegramChatId: String,
    emailRecipient: String,
    marketMode: {
      type: String,
      enum: Object.values(MARKET_MODES),
      default: MARKET_MODES.BULL,
    },
    marketModeOverride: { type: Boolean, default: false },
    paperTradeMode: { type: Boolean, default: true },
    scannerEnabled: { type: Boolean, default: true },
    lastMarketHealth: { type: marketHealthSnapshotSchema, default: null },
  },
  { timestamps: true, strict: true }
);

export default mongoose.model('Config', configSchema);
