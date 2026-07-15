/**
 * @file User.js
 * @description Mongoose schema for a login account. Accounts are admin-provisioned
 *   only (server/scripts/create-user.mjs) — there is no public signup route.
 * @author TradeZen Team
 */

import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    // Stored for future use — nothing in the app enforces role-based restrictions yet.
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
  },
  { timestamps: true, strict: true }
);

export default mongoose.model('User', userSchema);
