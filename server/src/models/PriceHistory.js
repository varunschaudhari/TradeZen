/**
 * @file PriceHistory.js
 * @description Daily-TTL cache for historical series fetched from the Python service
 *   (2y indicator series for backtests, 1y OHLCV for Simons, Nifty history). Daily bars
 *   only change after the close, so caching them per trading day turns the 3 redundant
 *   per-analysis fetches into one fetch per symbol per day. Entries auto-expire after a
 *   few days via a TTL index so the collection self-cleans.
 * @author TradeZen Team
 * @created 2026-06-27
 */

import mongoose from 'mongoose';

const priceHistorySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true }, // e.g. indseries:TCS:2y
    payload: { type: mongoose.Schema.Types.Mixed }, // raw Python response, shape varies by key
    fetchedAt: { type: Date, default: Date.now },
  },
  { strict: true, minimize: false }
);

// Auto-purge cached series older than 3 days (bounds growth; daily data refreshes well before this).
priceHistorySchema.index({ fetchedAt: 1 }, { expireAfterSeconds: 3 * 24 * 60 * 60 });

export default mongoose.model('PriceHistory', priceHistorySchema);
