/**
 * @file News.js
 * @description Mongoose schema for news articles and their sentiment scores (Gate 8)
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import mongoose from 'mongoose';
import { SENTIMENTS } from '../config/constants.js';

const newsSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, uppercase: true, index: true },
    headline: { type: String, required: true },
    source: String,
    url: String,
    publishedAt: { type: Date, required: true },
    sentiment: {
      type: String,
      enum: Object.values(SENTIMENTS),
      default: SENTIMENTS.NEUTRAL,
    },
    sentimentScore: { type: Number, default: 0 },
  },
  { timestamps: true, strict: true }
);

newsSchema.index({ symbol: 1, publishedAt: -1 });

export default mongoose.model('News', newsSchema);
