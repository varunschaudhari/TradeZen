/**
 * @file signal-edge.mjs
 * @description Per-signal edge report. Runs the walk-forward backtest (one hold mode),
 *              then for every price-derived signal flag measures win rate, avg-R, and
 *              LIFT (avgR with the signal − avgR without). Signals are ranked by rLift:
 *              positive = adds expectancy, negative = dilutive (dragging the composite down).
 *
 *              Honest scope: only price-derived signals are measurable historically.
 *              FII / sector / P-C / PEAD / promoter / news / candle are absent in
 *              backtest and CANNOT be evaluated here (they need forward paper-trading).
 *
 *              Usage (inside the server container):
 *                node scripts/signal-edge.mjs RELIANCE,TCS,ICICIBANK [period] [holdMode]
 *                node scripts/signal-edge.mjs UNIVERSE 2y adaptive   # full universe (slow)
 *                node scripts/signal-edge.mjs                        # seeded watchlist
 * @author TradeZen Team
 */

import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import Config from '../src/models/Config.js';
import { runSignalEdge } from '../src/services/backtestEngine.js';
import { fetchUniverse } from '../src/services/pythonBridge.js';

const period = process.argv[3] || '2y';
const holdMode = process.argv[4] || 'adaptive';

const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

const run = async () => {
  await connectDB();
  const arg = process.argv[2];
  let symbols;
  if (arg === 'UNIVERSE') {
    symbols = await fetchUniverse();
  } else if (arg) {
    symbols = arg.split(',').map((s) => s.toUpperCase());
  } else {
    const cfg = await Config.findOne().lean();
    symbols = (cfg?.watchlist ?? []).map((w) => w.symbol);
  }
  console.log(`\n▶ Signal-edge over ${symbols.length} symbols, ${period}, hold='${holdMode}'\n`);

  const res = await runSignalEdge(symbols, { period, holdMode });

  console.log('=== BASE RATE (all eligible trades) ===');
  console.log(`  trades=${res.base.n}  winRate=${res.base.winRate}%  avgR=${sign(res.base.avgR)}\n`);

  console.log('=== PER-SIGNAL EDGE (ranked by rLift = avgR with − without) ===');
  console.log('  signal                 n     winRate    avgR   avgR(w/o)   rLift   winLift   note');
  for (const s of res.signals) {
    const note = s.enough ? '' : `low-n (<30)`;
    console.log(
      `  ${s.signal.padEnd(20)} ${String(s.n).padStart(4)}   ${String(s.winRate).padStart(6)}%  ${String(s.avgR).padStart(6)}    ${String(s.avgRWithout).padStart(6)}   ${sign(s.rLift).padStart(6)}   ${sign(s.winLift).padStart(6)}%   ${note}`
    );
  }

  console.log(`\nHold mode: ${res.holdMode}   Period: ${res.period}   Trades: ${res.trades}`);
  console.log('rLift > 0 → signal adds expectancy.  rLift < 0 → dilutive (consider dropping/inverting).');

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error('Signal-edge failed:', err);
  process.exit(1);
});
