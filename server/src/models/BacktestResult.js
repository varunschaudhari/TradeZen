/**
 * @file BacktestResult.js
 * @description MongoDB schema for historical backtest results
 * Stores replay performance of setups on past 2 years of data
 */

import mongoose from 'mongoose';

const backTestResultSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, uppercase: true, index: true },
    setupType: { type: String, default: 'CUSTOM' }, // MOMENTUM_BREAKOUT, PULLBACK_TO_SUPPORT, etc

    // Setup parameters
    entry: { type: Number, required: true },
    stopLoss: { type: Number, required: true },
    target1: { type: Number, required: true },
    target2: { type: Number, required: true },
    riskReward: { type: Number, required: true },

    // Backtest period
    backtestPeriod: { type: String, default: '2y' },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },

    // Aggregated stats
    tradesSimulated: { type: Number, default: 0 },
    winsAtT1: { type: Number, default: 0 },
    winsAtT2: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    timeouts: { type: Number, default: 0 },

    winRate: { type: Number, default: 0 }, // % (wins / total)
    winRateT1: { type: Number, default: 0 }, // % (T1 wins / total)
    winRateT2: { type: Number, default: 0 }, // % (T2 wins / total)
    lossRate: { type: Number, default: 0 }, // % (losses / total)

    avgRealizedRR: { type: Number, default: 0 }, // avg R:R realized
    avgHoldingDays: { type: Number, default: 0 },
    avgWinSize: { type: Number, default: 0 }, // avg R per win
    avgLossSize: { type: Number, default: 0 }, // avg R per loss

    maxConsecutiveWins: { type: Number, default: 0 },
    maxConsecutiveLosses: { type: Number, default: 0 },
    largestWin: { type: Number, default: 0 }, // in R
    largestLoss: { type: Number, default: 0 }, // in R

    profitFactor: { type: Number, default: 0 }, // (sum of wins) / (sum of losses)
    expectancyPerTrade: { type: Number, default: 0 }, // (winRate × avgWinSize) - (lossRate × avgLossSize)

    // Quality assessment
    sampleSize: { type: String, enum: ['SMALL', 'MEDIUM', 'LARGE'], default: 'MEDIUM' }, // < 5, 5-10, > 10
    performanceAssessment: {
      type: String,
      enum: ['EXCELLENT', 'GOOD', 'DECENT', 'POOR', 'INSUFFICIENT_DATA'],
      default: 'INSUFFICIENT_DATA',
    },

    // Detailed trade-by-trade breakdown
    trades: [
      {
        sequenceNo: Number,
        entryDate: Date,
        entryPrice: Number,
        exitDate: Date,
        exitPrice: Number,
        exitType: { type: String, enum: ['T1', 'T2', 'SL', 'TIMEOUT'] },
        realizedR: Number, // profit in Risk units
        holdingDays: Number,
        barsSincEntry: Number,
      },
    ],

    // Metadata
    createdAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), index: true }, // 30 days TTL
  },
  { timestamps: true }
);

// TTL index to auto-delete old results
backTestResultSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index for lookups
backTestResultSchema.index({ symbol: 1, entry: 1, stopLoss: 1, target1: 1, target2: 1 });

export default mongoose.model('BacktestResult', backTestResultSchema);
