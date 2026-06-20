/**
 * @file OHLCV.js
 * @description Mongoose schema for caching raw OHLCV candle data from yfinance
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import mongoose from 'mongoose';

const ohlcvSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, uppercase: true },
    timestamp: { type: Date, required: true },
    open: { type: Number, required: true },
    high: { type: Number, required: true },
    low: { type: Number, required: true },
    close: { type: Number, required: true },
    volume: { type: Number, required: true },
    interval: { type: String, default: '15m' },
  },
  { timestamps: true, strict: true }
);

ohlcvSchema.index({ symbol: 1, timestamp: -1 }, { unique: true });

export default mongoose.model('OHLCV', ohlcvSchema);
