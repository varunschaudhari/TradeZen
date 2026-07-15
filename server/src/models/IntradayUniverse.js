/**
 * @file IntradayUniverse.js
 * @description The intraday module's OWN daily shortlist — deliberately a separate
 *   collection from the swing ScanResult (scanType EOD_PREP), so intraday stock
 *   selection never depends on swing trend-quality criteria again. One document per
 *   build; callers read the latest. See intradayUniverse.js for how it's ranked.
 * @author TradeZen Team
 * @created 2026-07-09
 */

import mongoose from 'mongoose';

const intradayUniverseSymbolSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true },
    tier: String, // NIFTY50 | NEXT50
    currentPrice: Number,
    avgTurnoverInr: Number, // liquidity (from the swing screen's cheap OHLCV pass)
    atrPct: Number, // volatility as % of price — the actual "will this move" signal
    suitabilityScore: Number, // blended rank used to pick the top N
  },
  { _id: false }
);

const intradayUniverseSchema = new mongoose.Schema(
  {
    symbols: { type: [intradayUniverseSymbolSchema], default: [] },
    universeCount: Number,
    screenedCount: Number,
  },
  { timestamps: true, strict: true }
);

intradayUniverseSchema.index({ createdAt: -1 });

export default mongoose.model('IntradayUniverse', intradayUniverseSchema);
