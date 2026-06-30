/**
 * @file test-backtest-setup.mjs
 * @description Smoke-test the per-setup backtester (backtestSetup) after swapping its
 *   internals to the research engine's realism model. Prints the summary stats + the last
 *   few trades so the report's Section-11 output shape can be eyeballed. No DB needed —
 *   backtestSetup only calls the Python /indicator-series endpoint.
 *   Usage:  node scripts/test-backtest-setup.mjs RELIANCE 1300 1260 1380 1420
 */

import { backtestSetup } from '../src/services/backtestEngine.js';

const run = async () => {
  const symbol = (process.argv[2] || 'RELIANCE').toUpperCase();
  const entry = Number(process.argv[3] || 1300);
  const sl = Number(process.argv[4] || 1260);
  const t1 = Number(process.argv[5] || 1380);
  const t2 = Number(process.argv[6] || 1420);

  console.log(`\n▶ backtestSetup(${symbol}, entry=${entry}, SL=${sl}, T1=${t1}, T2=${t2})\n`);
  const res = await backtestSetup(symbol, entry, sl, t1, t2);
  if (!res) {
    console.log('returned null (no data / invalid levels)');
    process.exit(0);
  }
  const { trades, ...summary } = res;
  console.log('=== SUMMARY (report Section-11 shape) ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\n=== LAST ${Math.min(6, (trades || []).length)} TRADES ===`);
  for (const t of (trades || []).slice(-6)) {
    const d = typeof t.entryDate === 'string' ? t.entryDate.slice(0, 10) : t.entryDate;
    console.log(
      `  ${String(d)}  ${String(t.exitType).padEnd(7)} R=${Number(t.realizedR).toFixed(2).padStart(6)}  hold=${t.holdingDays}d`
    );
  }
  process.exit(0);
};

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
