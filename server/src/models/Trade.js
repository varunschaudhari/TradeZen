/**
 * @file Trade.js
 * @description Mongoose schema for manually logged trade entries and their lifecycle
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import mongoose from 'mongoose';
import { TRADE_STATUSES, EXIT_REASONS } from '../config/constants.js';

const tradeSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, uppercase: true, index: true },
    signalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Signal' },
    status: {
      type: String,
      enum: Object.values(TRADE_STATUSES),
      default: TRADE_STATUSES.OPEN,
      index: true,
    },
    entryPrice: { type: Number, required: true },
    entryDate: { type: Date, required: true, default: Date.now },
    stopLoss: { type: Number, required: true },
    target1: { type: Number, required: true },
    target2: Number,
    shares: { type: Number, required: true },
    capitalDeployed: { type: Number, required: true },
    currentPrice: Number,
    unrealizedPnl: { type: Number, default: 0 },
    unrealizedPnlPct: { type: Number, default: 0 },
    target1Shares: Number,
    target2Shares: Number,
    target1Hit: { type: Boolean, default: false },
    target1HitDate: Date,
    target1ExitPrice: Number,
    exitPrice: Number,
    exitDate: Date,
    realizedPnl: Number,
    realizedPnlPct: Number,
    exitReason: { type: String, enum: Object.values(EXIT_REASONS) },
    slTrailed: { type: Boolean, default: false },
    slTrailedTo: Number,
    earningsTimestamp: Number,
    earningsAlertSent: { type: Boolean, default: false },
    lastSlWarningAt: Date,
    notes: String,
  },
  { timestamps: true, strict: true }
);

tradeSchema.index({ symbol: 1, status: 1 });
tradeSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('Trade', tradeSchema);
