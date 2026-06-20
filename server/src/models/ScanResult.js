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
    // GATES (failed gates) | RANKED_OUT (passed gates, below Claude cap) |
    // CLAUDE (analyzed by Claude → WAIT/SKIP) | SIGNAL (Claude BUY)
    droppedAtStage: String,
  },
  { _id: false }
);

const scanResultSchema = new mongoose.Schema(
  {
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
  },
  { timestamps: true, strict: true }
);

scanResultSchema.index({ createdAt: -1 });
scanResultSchema.index({ createdAt: 1 }, { expireAfterSeconds: SCAN_RESULT_TTL_SECONDS });

export default mongoose.model('ScanResult', scanResultSchema);
