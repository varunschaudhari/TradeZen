/**
 * @file Goal.js
 * @description Mongoose schema for a user's capital target — deliberately independent of
 *   Config/Signal/Trade generation. Tracks progress only; never influences gates, scoring,
 *   or position sizing.
 * @author TradeZen Team
 */

import mongoose from 'mongoose';

const goalSchema = new mongoose.Schema(
  {
    userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    targetAmount: { type: Number, required: true, min: 1 },
    targetDate:   { type: Date, required: true },
    startCapital: { type: Number, required: true, min: 1 },
    startDate:    { type: Date, required: true },
  },
  { timestamps: true, strict: true }
);

export default mongoose.model('Goal', goalSchema);
