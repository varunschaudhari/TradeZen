/**
 * @file decision-quality.mjs
 * @description Print the calibration / decision-quality report. Resolves stored signals
 *   against forward prices and shows hit rate by confidence + composite score, plus the
 *   trade-based metrics and the calibration verdict.
 *   Usage (host, Docker-resilient):
 *     PYTHON_SERVICE_URL=http://localhost:8001 MONGODB_URI=mongodb://localhost:27018/tradezen \
 *       node scripts/decision-quality.mjs
 *   Or inside the server container:  node scripts/decision-quality.mjs
 * @author TradeZen Team
 */

import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { getDecisionQualityReport } from '../src/services/decisionQuality.js';

const pct = (n) => (n == null ? '   —' : `${String(n).padStart(5)}%`);

const row = (label, g) => {
  if (!g || g.n === 0) {
    console.log(`  ${label.padEnd(12)} (no signals)`);
    return;
  }
  const flag = g.enough ? '' : '  ⚠ low-n';
  console.log(
    `  ${label.padEnd(12)} n=${String(g.n).padStart(4)}  resolved=${String(g.win + g.loss).padStart(4)}` +
      `  hitRate=${pct(g.hitRate)}  (W:${g.win} L:${g.loss} open:${g.open})${flag}`
  );
};

const run = async () => {
  await connectDB();
  console.log('\n▶ Computing decision-quality / calibration report…\n');
  const r = await getDecisionQualityReport();

  console.log('=== TRADE-BASED (logged closed trades) ===');
  const tb = r.tradeBased;
  console.log(`  closed trades: ${tb.closedTrades}   winRate: ${tb.winRate}%   expectancy: ₹${tb.expectancy}`);
  console.log(`  go-live: ${tb.goLive.ready ? 'READY' : 'not ready'} — ${tb.goLive.message}`);
  if (tb.decayFlags?.length) {
    console.log('  decay flags:');
    for (const f of tb.decayFlags) console.log(`    ${f.type}:${f.key}  winRate=${f.winRate}% (n=${f.trades})`);
  }
  if (tb.closedTrades === 0) {
    console.log('  → No logged trades yet. Calibration below is from SIGNAL self-resolution.');
  }

  const sc = r.signalCalibration;
  console.log(
    `\n=== SIGNAL CALIBRATION — MARKET-ADJUSTED (excess over Nifty, ${r.horizonDays}d horizon) ===`
  );
  console.log(
    `  signals=${sc.signalsConsidered}  resolved=${sc.resolved}  open=${sc.open}  priceUnavailable=${sc.priceUnavailable}  marketAdjusted=${sc.marketAdjusted}`
  );
  console.log('  (WIN = stock OUTPERFORMED Nifty by the target margin — strips bull-market drift)');

  console.log('\n  -- hit rate by CONFIDENCE (is HIGH really better?) --');
  for (const k of ['HIGH', 'MEDIUM', 'LOW']) row(k, sc.byConfidence[k]);

  console.log('\n  -- hit rate by COMPOSITE SCORE (does the score predict?) --');
  for (const k of ['60+', '50-59', '40-49', '<40']) row(k, sc.byScore[k]);

  console.log('\n  -- hit rate by VERDICT --');
  for (const k of ['BUY', 'WAIT', 'SKIP']) row(k, sc.byVerdict[k]);

  console.log(`\n=== CALIBRATION VERDICT ===\n  ${r.verdict.message}\n`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error('decision-quality failed:', err);
  process.exit(1);
});
