/**
 * @file WalkForwardRun.js
 * @description One document per walk-forward backtest run (`POST /api/backtest/run`).
 *   Unlike single-setup replays (BacktestResult, 30-day TTL cache), these are kept so a
 *   user can compare "expectancy under adaptive mode" today vs. a month ago and see
 *   whether the score-threshold calibration has drifted — the whole point requires a
 *   longitudinal record, so no TTL here; GET /api/backtest/runs just caps the listing.
 * @author TradeZen Team
 * @created 2026-08-21
 */

import mongoose from 'mongoose';

const walkForwardRunSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    symbols: { type: [String], default: [] },
    symbolCount: { type: Number, required: true },
    period: { type: String, required: true },
    modes: { type: [String], required: true },
    // Full per-mode aggregate (overall/liveStrategy/byScoreBucket/byExitReason/byVerdict/
    // periods/stability/equityCurve) — same shape runBacktest() returns. Deliberately
    // untyped: this is exploratory/analytical data, not something the app enforces
    // invariants on, and the shape is expected to grow (see backtestEngine.js's aggregate()).
    results: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true, strict: true }
);

walkForwardRunSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('WalkForwardRun', walkForwardRunSchema);
