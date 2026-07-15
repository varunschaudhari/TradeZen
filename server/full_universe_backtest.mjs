import { collectBacktestTrades } from './src/services/backtestEngine.js';
import { fetchUniverse } from './src/services/pythonBridge.js';
import fs from 'node:fs';

const OUT = '/tmp/universe_trades.json';
const PROGRESS = '/tmp/universe_progress.txt';

async function main() {
  const symbols = await fetchUniverse();
  fs.writeFileSync(PROGRESS, `universe size: ${symbols.length}\nstarted: ${new Date().toISOString()}\n`);
  const all = [];
  let done = 0;
  let errors = 0;
  for (const symbol of symbols) {
    try {
      const trades = await collectBacktestTrades([symbol], { period: '2y', holdMode: 'adaptive' });
      all.push(...trades);
    } catch (err) {
      errors += 1;
    }
    done += 1;
    if (done % 10 === 0 || done === symbols.length) {
      fs.appendFileSync(PROGRESS, `${done}/${symbols.length} symbols done, ${all.length} trades so far, ${errors} errors, ${new Date().toISOString()}\n`);
      fs.writeFileSync(OUT, JSON.stringify(all)); // incremental save — safe to read at any point
    }
  }
  fs.appendFileSync(PROGRESS, `FINISHED: ${all.length} total trades, ${errors} errors, ${new Date().toISOString()}\n`);
}

main().catch((err) => {
  fs.appendFileSync(PROGRESS, `FATAL: ${err.message}\n`);
  process.exit(1);
});
