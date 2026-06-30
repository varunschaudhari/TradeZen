/**
 * @file backtest.mjs
 * @description Run the walk-forward backtester over a symbol list and compare hold-window
 *              strategies side by side: fixed 10-bar vs ATR-adaptive time-stops.
 *                - fixed   : flat BACKTEST_HOLD_DAYS bars
 *                - linear  : days = (targetMove% / atr%) × buffer   (clean-trend assumption)
 *                - adaptive: days = (targetMove% / atr%)²           (diffusion/random-walk)
 *              All three run in ONE data pass (yfinance is fetched once per symbol).
 *              Usage (inside the server container):
 *                node scripts/backtest.mjs RELIANCE,TCS,ICICIBANK [period] [modes]
 *                node scripts/backtest.mjs UNIVERSE 2y     # full ~270-symbol universe (slow)
 *                node scripts/backtest.mjs                 # uses the seeded watchlist
 *              modes (4th arg, comma-separated) default to: fixed,linear,adaptive
 *                horizon comparison: ... 2y fixed:3,fixed:10,fixed:25
 * @author TradeZen Team
 */

import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import Config from '../src/models/Config.js';
import { runBacktest } from '../src/services/backtestEngine.js';
import { fetchUniverse } from '../src/services/pythonBridge.js';

const period = process.argv[3] || '2y';
const MODES = process.argv[4] ? process.argv[4].split(',') : ['fixed', 'linear', 'adaptive'];

const pct = (n) => `${String(n).padStart(6)}%`;

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
  console.log(`\n▶ Backtesting ${symbols.length} symbols over ${period} — comparing hold modes: ${MODES.join(', ')}\n`);

  const res = await runBacktest(symbols, { period, modes: MODES });

  // ── Overall comparison ──────────────────────────────────────────────────────
  console.log('=== OVERALL (by hold mode) ===');
  console.log('  mode      trades   winRate    avgR(gross)  avgCost   avgR(NET)  avgHold');
  for (const m of MODES) {
    const o = res.results[m].overall;
    console.log(
      `  ${m.padEnd(9)} ${String(o.trades).padStart(5)}   ${pct(o.winRate)}   ${String(o.avgR).padStart(8)}  ${String(o.avgCost).padStart(7)}  ${String(o.avgRNet).padStart(8)}  ${String(o.avgHold).padStart(6)}`
    );
  }

  // ── Exit-reason mix (where TIME exits should shrink) ─────────────────────────
  console.log('\n=== EXIT REASONS (by hold mode) ===');
  console.log('  mode          T2   TRAIL     SL    TIME');
  for (const m of MODES) {
    const e = res.results[m].byExitReason;
    console.log(
      `  ${m.padEnd(9)} ${String(e.T2).padStart(5)}  ${String(e.TRAIL).padStart(5)}  ${String(e.SL).padStart(5)}  ${String(e.TIME).padStart(6)}`
    );
  }

  // ── Score-bucket calibration: gross vs NET (does edge survive costs, by score?) ──
  console.log('\n=== COMPOSITE SCORE × HOLD MODE (gross → NET of costs) ===');
  for (const m of MODES) {
    console.log(`  [${m}]`);
    for (const [bucket, b] of Object.entries(res.results[m].byScoreBucket)) {
      console.log(
        `    ${bucket.padEnd(6)} trades=${String(b.trades).padStart(4)}  winRate=${pct(b.winRate)}  avgR=${String(b.avgR).padStart(6)} → NET ${String(b.avgRNet).padStart(6)} (cost ${b.avgCost})`
      );
    }
  }

  console.log(`\nSymbols: ${res.symbols}   Period: ${res.period}`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error('Backtest failed:', err);
  process.exit(1);
});
