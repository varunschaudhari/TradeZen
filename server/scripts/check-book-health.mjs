import 'dotenv/config';
import mongoose from 'mongoose';
import Trade from '../src/models/Trade.js';
import Config from '../src/models/Config.js';

const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const config = await Config.findOne().lean();
  const open = await Trade.find({ status: 'OPEN' }).lean();

  const totalDeployed = open.reduce((s, t) => s + (t.capitalDeployed ?? 0), 0);
  const deployedPct = round2((totalDeployed / config.capital) * 100);
  console.log(`Capital: ₹${config.capital}, Open positions: ${open.length}, Total deployed: ₹${round2(totalDeployed)} (${deployedPct}% of capital)`);
  console.log(`maxCapitalDeployedPct config: ${config.maxCapitalDeployedPct}%, maxOpenTrades config: ${config.maxOpenTrades}`);

  console.log('\n=== By sector ===');
  const bySector = {};
  for (const t of open) {
    const sec = t.sector ?? 'UNKNOWN';
    bySector[sec] = bySector[sec] ?? { count: 0, deployed: 0 };
    bySector[sec].count += 1;
    bySector[sec].deployed += t.capitalDeployed ?? 0;
  }
  for (const [sec, v] of Object.entries(bySector)) {
    console.log(`  ${sec}: ${v.count} positions, ₹${round2(v.deployed)} (${round2((v.deployed / config.capital) * 100)}% of capital)`);
  }

  console.log('\n=== All open positions ===');
  for (const t of open) {
    console.log(' ', JSON.stringify({ symbol: t.symbol, sector: t.sector, source: t.source, entryDate: t.entryDate, entryPrice: t.entryPrice, currentPrice: t.currentPrice, unrealizedPnlPct: t.unrealizedPnlPct, capitalDeployed: round2(t.capitalDeployed) }));
  }

  await mongoose.disconnect();
}
main().catch((err) => { console.error(err); process.exit(1); });
