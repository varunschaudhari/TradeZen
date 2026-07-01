/**
 * @file Stock.js
 * @description Persistent stock master — one document per NSE symbol. Unlike the
 *   ephemeral per-cycle ScanResult snapshots (14-day TTL), this is the durable catalog
 *   the Stocks page reads from. Fundamentals/sector are upserted from the /stock detail
 *   (seed + analysis views); the latest scan status is upserted on every scan cycle.
 * @author TradeZen Team
 * @created 2026-06-27
 */

import mongoose from 'mongoose';

const lastScanSchema = new mongoose.Schema(
  {
    at: Date,
    gatesPassed: Number,
    compositeScore: Number,
    verdict: String, // BUY | WAIT | SKIP | WATCH | null
    droppedAtStage: String,
    reachedClaude: Boolean,
  },
  { _id: false }
);

const stockSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, unique: true, uppercase: true, index: true },
    companyName: String,
    sector: { type: String, default: 'Unknown', index: true },
    industry: String,

    // Fundamentals (from Python /stock — refreshed on seed and on analysis views)
    peRatio: Number,
    forwardPe: Number,
    marketCap: Number,
    beta: Number,
    dividendYield: Number,
    high52w: Number,
    low52w: Number,
    fundamentalsRefreshedAt: Date,

    // Latest known market snapshot
    currentPrice: Number,
    weeklyTrend: String,
    earningsTimestamp: Number,

    // Latest scan outcome (upserted every scan cycle)
    lastScan: { type: lastScanSchema, default: null },

    // Latest signal (upserted from the signal pipeline / analysis)
    lastSignalAt: Date,
    lastSignalVerdict: String,

    inUniverse: { type: Boolean, default: true },

    // Whether this stock participates in scan cycles (user-controlled toggle)
    active: { type: Boolean, default: true, index: true },

    // Index memberships, e.g. ['NIFTY50', 'NIFTY100', 'NIFTY500', 'MIDCAP150']
    indices: { type: [String], default: [] },

    // Broad market-cap tier for UI filtering
    marketCapTier: { type: String, enum: ['LARGE', 'MID', 'SMALL', 'MICRO', ''], default: '' },
  },
  { timestamps: true, strict: true }
);

// Note: `sector` already has an index via `index: true` on the field above.
stockSchema.index({ 'lastScan.compositeScore': -1 });
stockSchema.index({ 'lastScan.at': -1 });
stockSchema.index({ active: 1, sector: 1 });

export default mongoose.model('Stock', stockSchema);
