/**
 * @file Signal.js
 * @description Mongoose schema for AI-generated trading signals
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import mongoose from 'mongoose';
import { VERDICTS, CONFIDENCE_LEVELS, SENTIMENTS, MARKET_MODES } from '../config/constants.js';

const gateDetailSchema = new mongoose.Schema(
  { passed: { type: Boolean, required: true }, reason: { type: String, required: true } },
  { _id: false }
);

const indicatorsSchema = new mongoose.Schema(
  {
    ema20: Number,
    ema50: Number,
    ema200: Number,
    rsi: Number,
    macd: Number,
    macdSignal: Number,
    macdHist: Number,
    volRatio: Number,
    atr: Number,
    bollingerB: Number,
    candlePattern: String,
    momentum6m: Number,
    relativeStrength: Number,
  },
  { _id: false }
);

const marketContextSchema = new mongoose.Schema(
  {
    niftyPrice: Number,
    vix: Number,
    marketMode: { type: String, enum: Object.values(MARKET_MODES) },
    bankNiftyTrend: String,
    adRatio: Number,
    fiiTrend: String,
    pcRatio: Number,
  },
  { _id: false }
);

const signalSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, uppercase: true, index: true },
    sector: { type: String, default: null },
    verdict: { type: String, enum: Object.values(VERDICTS), required: true, index: true },
    confidence: { type: String, enum: Object.values(CONFIDENCE_LEVELS) },
    setupType: { type: String, default: null },
    compositeScore: { type: Number, default: 0 },
    compositeScoreAssessment: { type: String, default: null },
    entryZone: { low: Number, high: Number },
    entryTrigger: String,
    stopLoss: Number,
    stopLossReason: { type: String, default: null },
    target1: Number,
    target1Reason: { type: String, default: null },
    target2: Number,
    target2Reason: { type: String, default: null },
    riskReward: Number,
    shares: Number,
    capitalDeployed: Number,
    maxLoss: Number,
    maxProfit: Number,
    signalValidDays: Number,
    signalValidTill: Date,
    exitBeforeDate: { type: Date, default: null },
    waitCondition: { type: String, default: null },
    skipReason: { type: String, default: null },
    reasoning: String,
    keyRisks: [String],
    tailwindFactors: [String],
    simonsSignals: [String],
    simonsScore: { type: Number, default: null },
    simonsBreakdown: [{ label: String, points: Number, _id: false }],
    simonOverride: {
      reason: String,
      score: Number,
      _id: false,
    },
    tags: [String],
    gatesPassed: { type: Number, default: 0 },
    gateDetails: {
      gate1: gateDetailSchema,
      gate2: gateDetailSchema,
      gate3: gateDetailSchema,
      gate4: gateDetailSchema,
      gate5: gateDetailSchema,
      gate6: gateDetailSchema,
      gate7: gateDetailSchema,
      gate8: gateDetailSchema,
    },
    indicators: indicatorsSchema,
    marketContext: marketContextSchema,
    newsSentiment: { type: String, enum: Object.values(SENTIMENTS) },
    newsSentimentScore: { type: Number, default: 0 },
    newsHeadlines: [String],
    scanTimestamp: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true, index: true },
    notificationSent: { type: Boolean, default: false },
    // Intraday entry-zone watcher (entryWatcher.js): one-shot alert when live price
    // first trades inside entryZone during the signal's validity window
    entryAlertSent: { type: Boolean, default: false },
    entryTriggeredAt: { type: Date, default: null },
    claudeTokensUsed: { type: Number, default: 0 },
    claudeCostInr: { type: Number, default: 0 },
  },
  { timestamps: true, strict: true }
);

signalSchema.index({ symbol: 1, createdAt: -1 });
signalSchema.index({ verdict: 1, isActive: 1 });

export default mongoose.model('Signal', signalSchema);
