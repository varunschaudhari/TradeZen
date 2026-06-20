/**
 * @file seed.js
 * @description One-time database seed script — creates the singleton Config document
 *              and optionally populates a starter watchlist.
 *
 * Usage:
 *   node scripts/seed.js                    # seeds with defaults
 *   FORCE_RESEED=true node scripts/seed.js  # drops existing config and re-creates
 *
 * Requires MONGODB_URI in environment (or server/.env via dotenv).
 */

import 'dotenv/config';
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Copy server/.env and fill in your connection string.');
  process.exit(1);
}

// ── Inline schema (avoids importing all models in a script context) ───────────
const configSchema = new mongoose.Schema(
  {
    capital: { type: Number, default: 1_000_000 },
    riskPercentage: { type: Number, default: 1 },
    maxOpenTrades: { type: Number, default: 3 },
    maxCapitalDeployedPct: { type: Number, default: 60 },
    watchlist: [
      {
        symbol: { type: String, uppercase: true },
        sector: String,
        addedDate: { type: Date, default: Date.now },
        _id: false,
      },
    ],
    telegramChatId: String,
    emailRecipient: String,
    marketMode: { type: String, default: 'BULL' },
    marketModeOverride: { type: Boolean, default: false },
    paperTradeMode: { type: Boolean, default: true },
    scannerEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const STARTER_WATCHLIST = [
  { symbol: 'RELIANCE', sector: 'Energy' },
  { symbol: 'TCS', sector: 'IT' },
  { symbol: 'INFY', sector: 'IT' },
  { symbol: 'HDFCBANK', sector: 'Banking' },
  { symbol: 'ICICIBANK', sector: 'Banking' },
];

async function seed() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const Config = mongoose.model('Config', configSchema);

  const existing = await Config.findOne();

  if (existing && process.env.FORCE_RESEED !== 'true') {
    console.log('Config already exists — skipping (set FORCE_RESEED=true to override)');
    console.log(`  capital=₹${existing.capital.toLocaleString('en-IN')}`);
    console.log(`  watchlist=${existing.watchlist.map((w) => w.symbol).join(', ') || '(empty)'}`);
    console.log(`  paperTradeMode=${existing.paperTradeMode}`);
    await mongoose.disconnect();
    return;
  }

  if (existing) {
    await Config.deleteMany();
    console.log('Dropped existing config (FORCE_RESEED=true)');
  }

  const config = await Config.create({
    capital: Number(process.env.DEFAULT_CAPITAL ?? 1_000_000),
    riskPercentage: Number(process.env.DEFAULT_RISK_PCT ?? 1),
    maxOpenTrades: 3,
    maxCapitalDeployedPct: 60,
    watchlist: STARTER_WATCHLIST,
    paperTradeMode: true,
    scannerEnabled: true,
  });

  console.log('Config seeded successfully');
  console.log(`  capital=₹${config.capital.toLocaleString('en-IN')}`);
  console.log(`  watchlist=${config.watchlist.map((w) => w.symbol).join(', ')}`);
  console.log(`  paperTradeMode=${config.paperTradeMode}`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
