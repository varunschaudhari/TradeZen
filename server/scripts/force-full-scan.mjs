/**
 * @file force-full-scan.mjs
 * @description One-off harness to prove the full scan pipeline end-to-end. Connects to
 *              MongoDB, runs runFullScan({ forceRun: true }) (bypassing market hours),
 *              and prints the resulting metrics + a count of signals saved this run.
 *              Usage (inside the server container):
 *                node scripts/force-full-scan.mjs [tiers] [maxAnalyze]
 *                e.g. node scripts/force-full-scan.mjs NIFTY50 8
 * @author TradeZen Team
 */

import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { runFullScan } from '../src/scheduler/scanPipeline.js';
import Signal from '../src/models/Signal.js';

const tiersArg = process.argv[2] ? process.argv[2].split(',') : null;
const maxAnalyze = process.argv[3] ? parseInt(process.argv[3], 10) : undefined;

const run = async () => {
  await connectDB();
  const since = new Date();
  console.log(
    `\n▶ Forcing full scan (tiers=${tiersArg ?? 'ALL'}, maxAnalyze=${maxAnalyze ?? 'default'})…\n`
  );

  const metrics = await runFullScan({ forceRun: true, tiers: tiersArg, maxAnalyze });
  console.log('\n=== SCAN METRICS ===');
  console.log(JSON.stringify(metrics, null, 2));

  const saved = await Signal.find({ createdAt: { $gte: since } })
    .sort({ compositeScore: -1 })
    .lean();
  console.log(`\n=== SIGNALS SAVED THIS RUN: ${saved.length} ===`);
  for (const s of saved) {
    console.log(
      `  ${s.symbol.padEnd(12)} ${s.verdict.padEnd(5)} ${String(s.confidence).padEnd(7)} ` +
        `score=${s.compositeScore} gates=${s.gatesPassed} setup=${s.setupType ?? '-'} ` +
        `entry=${s.entryZone?.high ?? '-'} SL=${s.stopLoss ?? '-'} T1=${s.target1 ?? '-'}`
    );
  }

  await mongoose.disconnect();
  console.log('\n✓ Done.');
  process.exit(0);
};

run().catch((err) => {
  console.error('Force scan failed:', err);
  process.exit(1);
});
