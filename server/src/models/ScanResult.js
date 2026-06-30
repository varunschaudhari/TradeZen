/**
 * @file ScanResult.js
 * @description Per-scan-cycle snapshot — the funnel counts plus every analyzed stock
 *              with its price, gate result, composite score, verdict, and the stage it
 *              dropped out at. Powers the dashboard "scanned stocks" grid. Auto-expires
 *              after SCAN_RESULT_TTL_SECONDS to bound growth.
 * @author TradeZen Team
 * @created 2026-06-20
 */

import mongoose from 'mongoose';
import { MARKET_MODES, SCAN_RESULT_TTL_SECONDS } from '../config/constants.js';

const scanStockSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true },
    currentPrice: Number,
    gatesPassed: Number,
    compositeScore: Number,
    hardBlockFired: Boolean,
    reachedClaude: { type: Boolean, default: false },
    verdict: String, // BUY | WAIT | SKIP | null
    confidence: String,
    // SCREEN (pre-filter cut) | ANALYZE_CAP (screened in, over analyze cap) |
    // GATES (failed gates) | RANKED_OUT (passed gates, below Claude cap) |
    // CLAUDE (analyzed by Claude → WAIT/SKIP) | SIGNAL (Claude BUY)
    droppedAtStage: String,
    reason: String, // screen-filter reason for SCREEN stage (e.g. trend, momentum)
  },
  { _id: false }
);

// Next-session watchlist candidate (EOD prep scan only): gate-qualified shortlist with
// the analysis-suggested levels to confirm live at the next open. NOT a tradeable signal.
const watchCandidateSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true },
    currentPrice: Number,
    compositeScore: Number,
    gatesPassed: Number,
    scoreConfidence: String,
    sector: String,
    rsi: Number,
    suggestedEntry: Number,
    suggestedStopLoss: Number,
    suggestedTarget1: Number,
    suggestedTarget2: Number,
    riskReward: Number,
  },
  { _id: false }
);

const scanResultSchema = new mongoose.Schema(
  {
    // LIVE = intraday signal scan; EOD_PREP = post-close next-session watchlist build
    scanType: { type: String, enum: ['LIVE', 'EOD_PREP'], default: 'LIVE', index: true },
    marketMode: { type: String, enum: Object.values(MARKET_MODES) },
    adRatio: Number,
    niftyPrice: Number,
    durationMs: Number,
    funnel: {
      universe: Number,
      screened: Number,
      analyzed: Number,
      gatePassed: Number,
      selected: Number,
    },
    screenRejections: { type: mongoose.Schema.Types.Mixed, default: {} },
    signalsSaved: Number,
    buySignals: Number,
    claudeCalls: Number,
    totalCostInr: Number,
    errors: Number,
    stocks: { type: [scanStockSchema], default: [] },
    watchlist: { type: [watchCandidateSchema], default: [] }, // EOD_PREP only
  },
  { timestamps: true, strict: true }
);

scanResultSchema.index({ createdAt: -1 });
scanResultSchema.index({ createdAt: 1 }, { expireAfterSeconds: SCAN_RESULT_TTL_SECONDS });

export default mongoose.model('ScanResult', scanResultSchema);
