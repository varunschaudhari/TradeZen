/**
 * @file MarketState.js
 * @description Singleton doc for shared market-regime state (marketMode, the last
 *   market-health snapshot, the manual regime override). This used to live on the
 *   Config singleton; once Config became per-user (multi-tenancy), those fields had
 *   to move out — market regime is shared analysis, not per-user portfolio state
 *   (same split as Signal/ScanResult/Stock), so it can't be scoped by userId.
 * @author TradeZen Team
 * @created 2026-07-10
 */

import mongoose from 'mongoose';
import { MARKET_MODES } from '../config/constants.js';

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

const marketStateSchema = new mongoose.Schema(
  {
    marketMode: {
      type: String,
      enum: Object.values(MARKET_MODES),
      default: MARKET_MODES.BULL,
    },
    marketModeOverride: { type: Boolean, default: false },
    lastMarketHealth: { type: marketHealthSnapshotSchema, default: null },
    // Evidence-window start for the go-live gate's INTRADAY lane only (shared/global —
    // intraday paper-trading isn't per-user). The swing lane uses each user's own
    // Config.dataCollectionStartedAt instead. Set manually when a clean observation
    // period begins (see CLAUDE.md's "go-live evidence gate" section).
    dataCollectionStartedAt: { type: Date, default: null },
  },
  { timestamps: true, strict: true }
);

export default mongoose.model('MarketState', marketStateSchema);
