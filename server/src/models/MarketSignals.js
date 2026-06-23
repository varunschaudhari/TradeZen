/**
 * @file MarketSignals.js
 * @description Singleton document holding market-regime signals that the daily/scan
 *              pipeline can't derive from price alone: FII/DII flow, Put/Call ratio,
 *              and sector rotation ranking. Populated manually (PATCH /api/market-signals)
 *              or by best-effort fetchers. Read once per scan and injected into the
 *              composite score + Claude prompt.
 * @author TradeZen Team
 * @created 2026-06-21
 */

import mongoose from 'mongoose';
import { FII_TRENDS } from '../config/constants.js';

const sectorRankSchema = new mongoose.Schema({ sector: String, ret: Number }, { _id: false });

const marketSignalsSchema = new mongoose.Schema(
  {
    fiiTrend: { type: String, enum: Object.values(FII_TRENDS), default: FII_TRENDS.NEUTRAL },
    fiiNetBuy3d: { type: Number, default: null },
    pcRatio: { type: Number, default: null },
    topSectors: { type: [String], default: [] },
    bottomSectors: { type: [String], default: [] },
    sectorRanking: { type: [sectorRankSchema], default: [] },
    source: { type: String, default: 'manual' }, // manual | auto
  },
  { timestamps: true, strict: true }
);

export default mongoose.model('MarketSignals', marketSignalsSchema);
