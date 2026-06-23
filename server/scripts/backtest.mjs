/**
 * @file backtest.mjs
 * @description Run the walk-forward backtester over a symbol list and print win rate /
 *              expectancy overall and by composite-score bucket (threshold calibration).
 *              Usage (inside the server container):
 *                node scripts/backtest.mjs RELIANCE,TCS,ICICIBANK [period]
 *                node scripts/backtest.mjs            # uses the seeded watchlist
 * @author TradeZen Team
 */

import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import Config from '../src/models/Config.js';
import { runBacktest } from '../src/services/backtestEngine.js';
import { fetchUniverse } from '../src/services/pythonBridge.js';

const period = process.argv[3] || '2y';

const run = async () => {
  await connectDB();
  const arg = process.argv[2];
  let symbols;
  if (arg === 'UNIVERSE') {
    symbols = await fetchUniverse(); // full ~270-symbol universe (slow, yfinance-heavy)
  } else if (arg) {
    symbols = arg.split(',').map((s) => s.toUpperCase());
  } else {
    const cfg = await Config.findOne().lean();
    symbols = (cfg?.watchlist ?? []).map((w) => w.symbol);
  }
  console.log(`\n▶ Backtesting ${symbols.length} symbols over ${period}: ${symbols.join(', ')}\n`);

  const res = await runBacktest(symbols, { period });

  console.log('=== OVERALL ===');
  console.log(JSON.stringify(res.overall, null, 2));
  console.log('\n=== WIN RATE BY COMPOSITE SCORE (threshold calibration) ===');
  for (const [bucket, m] of Object.entries(res.byScoreBucket)) {
    console.log(
      `  ${bucket.padEnd(6)} trades=${String(m.trades).padStart(4)}  winRate=${String(m.winRate).padStart(6)}%  avgR=${m.avgR}`
    );
  }
  console.log('\n=== EXIT REASONS ===');
  console.log('  ' + JSON.stringify(res.byExitReason));
  console.log(`\nTotal simulated trades: ${res.trades} across ${res.symbols} symbols (${period})`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error('Backtest failed:', err);
  process.exit(1);
});
