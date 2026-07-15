/**
 * @file backfill-owner.mjs
 * @description One-off migration: attaches the pre-multi-tenancy single-tenant data
 *   (the old singleton Config doc, and every Trade/PriceAlert document that predates
 *   the userId field) to one named user's account, so the paper-trading history built
 *   up before this migration isn't orphaned.
 *
 *   Run this ONCE, right after creating that user with create-user.mjs. Running it
 *   again is safe (idempotent) — once the orphan docs are claimed, a second run finds
 *   nothing left to migrate.
 *
 *   Defaults to a DRY RUN (reports what it would change, writes nothing). Pass
 *   --confirm to actually apply the changes.
 *
 * Usage:
 *   node scripts/backfill-owner.mjs <email>              # dry run
 *   node scripts/backfill-owner.mjs <email> --confirm    # apply
 *
 * Requires MONGODB_URI in environment (or server/.env via dotenv).
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Config from '../src/models/Config.js';
import Trade from '../src/models/Trade.js';
import PriceAlert from '../src/models/PriceAlert.js';
import BlockedTrade from '../src/models/BlockedTrade.js';

const [, , rawEmail, flag] = process.argv;
const confirm = flag === '--confirm';

if (!rawEmail) {
  console.error('Usage: node scripts/backfill-owner.mjs <email> [--confirm]');
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
  console.log(confirm ? 'Mode: APPLY (writing changes)\n' : 'Mode: DRY RUN (no changes written — pass --confirm to apply)\n');

  const email = rawEmail.toLowerCase().trim();
  const user = await User.findOne({ email });
  if (!user) {
    console.error(`No user found with email ${email}. Run create-user.mjs first.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  const userId = user._id;
  console.log(`Target user: ${user.name} <${user.email}> (${userId})\n`);

  // ── Config: at most one pre-migration singleton lacking userId ────────────────
  const orphanConfig = await Config.findOne({ userId: { $exists: false } });
  if (orphanConfig) {
    console.log(`Found orphan Config (id ${orphanConfig._id}): capital=₹${orphanConfig.capital?.toLocaleString('en-IN')}, watchlist=${orphanConfig.watchlist?.length ?? 0} symbols`);
    if (confirm) {
      // The user already has a fresh default Config from create-user.mjs — drop it in
      // favor of the real pre-existing one so the unique userId index doesn't collide.
      const dropped = await Config.deleteOne({ userId });
      if (dropped.deletedCount) console.log(`  Dropped this user's auto-created default Config (${dropped.deletedCount})`);
      await Config.updateOne({ _id: orphanConfig._id }, { $set: { userId } });
      console.log('  -> attached to user');
    } else {
      console.log('  (dry run: would drop the user\'s default Config and attach this one instead)');
    }
  } else {
    console.log('No orphan Config found — nothing to migrate for Config.');
  }

  // ── Trade / PriceAlert: every pre-migration doc lacking userId ────────────────
  for (const [label, Model] of [['Trade', Trade], ['PriceAlert', PriceAlert]]) {
    const count = await Model.countDocuments({ userId: { $exists: false } });
    console.log(`\nOrphan ${label} docs: ${count}`);
    if (count && confirm) {
      const result = await Model.updateMany({ userId: { $exists: false } }, { $set: { userId } });
      console.log(`  -> updated ${result.modifiedCount}`);
    } else if (count) {
      console.log('  (dry run: would set userId on all of these)');
    }
  }

  // ── BlockedTrade: only CAPITAL_GUARD/SECTOR_CAP orphans are per-user; HARD_BLOCK/
  // QUALITY_DOWNGRADE orphans are correctly shared (userId: null matches missing too).
  const perUserBlockTypes = ['CAPITAL_GUARD', 'SECTOR_CAP'];
  const orphanBlockedCount = await BlockedTrade.countDocuments({
    userId: { $exists: false },
    blockType: { $in: perUserBlockTypes },
  });
  console.log(`\nOrphan per-user BlockedTrade docs (CAPITAL_GUARD/SECTOR_CAP): ${orphanBlockedCount}`);
  if (orphanBlockedCount && confirm) {
    const result = await BlockedTrade.updateMany(
      { userId: { $exists: false }, blockType: { $in: perUserBlockTypes } },
      { $set: { userId } }
    );
    console.log(`  -> updated ${result.modifiedCount}`);
  } else if (orphanBlockedCount) {
    console.log('  (dry run: would set userId on all of these)');
  }

  console.log(confirm ? '\nDone.' : '\nDry run complete — re-run with --confirm to apply.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('backfill-owner failed:', err.message);
  process.exit(1);
});
