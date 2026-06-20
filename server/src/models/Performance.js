/**
 * @file Performance.js
 * @description Mongoose schema for daily/weekly performance snapshots
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import mongoose from 'mongoose';

const performanceSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, index: true },
    period: { type: String, enum: ['daily', 'weekly', 'monthly'], required: true },
    totalTrades: { type: Number, default: 0 },
    winningTrades: { type: Number, default: 0 },
    losingTrades: { type: Number, default: 0 },
    winRate: { type: Number, default: 0 },
    totalPnl: { type: Number, default: 0 },
    totalPnlPct: { type: Number, default: 0 },
    avgRiskReward: { type: Number, default: 0 },
    maxDrawdown: { type: Number, default: 0 },
    capitalStart: Number,
    capitalEnd: Number,
    signalsGenerated: { type: Number, default: 0 },
    buySignals: { type: Number, default: 0 },
    claudeApiCostInr: { type: Number, default: 0 },
  },
  { timestamps: true, strict: true }
);

performanceSchema.index({ date: -1, period: 1 }, { unique: true });

export default mongoose.model('Performance', performanceSchema);
