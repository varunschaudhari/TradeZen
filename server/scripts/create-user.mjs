/**
 * @file create-user.mjs
 * @description The only way to provision a TradeZen account — there is no public
 *   signup. Creates a User + a matching per-user Config doc (sane defaults; edit
 *   capital/risk/watchlist afterwards via Settings).
 *
 * Usage:
 *   node scripts/create-user.mjs <email> <password> <name> [role]
 *   role defaults to "user"; "admin" is accepted but not enforced anywhere yet.
 *
 * Requires MONGODB_URI in environment (or server/.env via dotenv).
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Config from '../src/models/Config.js';
import { hashPassword } from '../src/services/authService.js';

const [, , rawEmail, password, name, role] = process.argv;

if (!rawEmail || !password || !name) {
  console.error('Usage: node scripts/create-user.mjs <email> <password> <name> [role]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}
if (role && role !== 'admin' && role !== 'user') {
  console.error('Role must be "admin" or "user".');
  process.exit(1);
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Copy server/.env and fill in your connection string.');
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const email = rawEmail.toLowerCase().trim();
  const existing = await User.findOne({ email });
  if (existing) {
    console.error(`A user with email ${email} already exists (id ${existing._id}).`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const user = await User.create({ email, passwordHash, name, role: role ?? 'user' });
  const config = await Config.create({ userId: user._id });

  console.log('\nUser created:');
  console.log(`  id    = ${user._id}`);
  console.log(`  email = ${user.email}`);
  console.log(`  name  = ${user.name}`);
  console.log(`  role  = ${user.role}`);
  console.log('\nConfig created with defaults:');
  console.log(`  capital=₹${config.capital.toLocaleString('en-IN')}  riskPercentage=${config.riskPercentage}%  paperTradeMode=${config.paperTradeMode}`);
  console.log('\nIf this account should inherit an existing pre-multi-tenancy dataset');
  console.log('(the old single-tenant Config/Trades), run scripts/backfill-owner.mjs next.');
  console.log(`\nLog in at /login with ${email}.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('create-user failed:', err.message);
  process.exit(1);
});
