/**
 * @file MarketRegimeHistory.js
 * @description One document per IST trading day — the day's last-observed market
 *   regime snapshot (VIX, A/D ratio, classified mode). marketHealthService.js upserts
 *   this alongside the existing MarketState singleton on every scan cycle, keyed by
 *   calendar day, so later scan cycles the same day just refine that day's row.
 *
 *   Exists so backtestEngine.js can eventually replay the REAL regime (MIXED/CAUTION,
 *   not just BULL/BEAR) for any historical day this has been running — it can't
 *   recover regime data from before this model existed, but every day forward is
 *   real evidence instead of the Nifty-vs-its-own-20EMA approximation backtest used
 *   to be limited to. See backtestEngine.js's regimeHistoryMap.
 * @author TradeZen Team
 * @created 2026-08-21
 */

import mongoose from 'mongoose';
import { MARKET_MODES } from '../config/constants.js';

const marketRegimeHistorySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true, index: true }, // YYYY-MM-DD, IST calendar day
    niftyPrice: Number,
    niftyEma20: Number,
    vix: Number,
    adRatio: Number,
    marketMode: { type: String, enum: Object.values(MARKET_MODES) },
    allowTrading: Boolean,
    reason: String,
    capturedAt: { type: Date, default: Date.now }, // last snapshot of the day (overwritten intraday)
  },
  { timestamps: true, strict: true }
);

export default mongoose.model('MarketRegimeHistory', marketRegimeHistorySchema);
