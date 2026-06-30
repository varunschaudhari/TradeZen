/**
 * @file force-eod-prep.mjs
 * @description One-off harness to prove the EOD prep scan end-to-end. Connects to MongoDB,
 *              runs runEodPrep({ forceRun: true }) (bypassing the trading-day guard), then
 *              prints the persisted next-session watchlist.
 *              Usage (inside the server container):  node scripts/force-eod-prep.mjs
 * @author TradeZen Team
 */

import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { runEodPrep } from '../src/scheduler/scanPipeline.js';
import ScanResult from '../src/models/ScanResult.js';

const run = async () => {
  await connectDB();
  console.log('\n▶ Forcing EOD prep scan (no Claude, no signals)…\n');

  const result = await runEodPrep({ forceRun: true });
  console.log(`Watchlist candidates: ${result.candidates}`);

  const prep = await ScanResult.findOne({ scanType: 'EOD_PREP' }).sort({ createdAt: -1 }).lean();
  if (prep) {
    console.log(`\n=== NEXT-SESSION WATCHLIST (${prep.watchlist.length}) — ${prep.createdAt.toISOString()} ===`);
    for (const [i, c] of prep.watchlist.entries()) {
      console.log(
        `  ${String(i + 1).padStart(2)}. ${c.symbol.padEnd(12)} score=${Math.round(c.compositeScore ?? 0)} ` +
          `gates=${c.gatesPassed}/8 conf=${c.scoreConfidence ?? '-'} ` +
          `entry=${c.suggestedEntry ?? '-'} SL=${c.suggestedStopLoss ?? '-'} T1=${c.suggestedTarget1 ?? '-'} RR=${c.riskReward ?? '-'}`
      );
    }
  } else {
    console.log('No EOD prep snapshot persisted.');
  }

  await mongoose.disconnect();
  console.log('\n✓ Done.');
  process.exit(0);
};

run().catch((err) => {
  console.error('Force EOD prep failed:', err);
  process.exit(1);
});
