/**
 * @file NewsCache.js
 * @description Per-symbol aggregate news cache (one doc per symbol) with a MongoDB
 *              TTL index so entries auto-expire after NEWS_CACHE_TTL_SECONDS (4 hours).
 *              Distinct from News.js (one doc per individual headline).
 * @author TradeZen Team
 * @created 2026-06-20
 * @lastModified 2026-06-20
 */

import mongoose from 'mongoose';
import { NEWS_CACHE_TTL_SECONDS, SENTIMENTS } from '../config/constants.js';

const newsCacheSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, uppercase: true, unique: true, index: true },
    headlines: { type: [String], default: [] },
    sentiment: { type: String, enum: Object.values(SENTIMENTS), default: SENTIMENTS.NEUTRAL },
    sentimentScore: { type: Number, default: 0 },
    sources: { type: [String], default: [] },
    autoNegative: { type: Boolean, default: false },
    fetchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, strict: true }
);

// TTL: MongoDB removes documents NEWS_CACHE_TTL_SECONDS after fetchedAt.
newsCacheSchema.index({ fetchedAt: 1 }, { expireAfterSeconds: NEWS_CACHE_TTL_SECONDS });

export default mongoose.model('NewsCache', newsCacheSchema);
