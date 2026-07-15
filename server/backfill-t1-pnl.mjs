import mongoose from 'mongoose';
import Trade from '/app/src/models/Trade.js';
import { computeCloseFields } from '/app/src/services/tradeTracker.js';

await mongoose.connect(process.env.MONGODB_URI);

const affected = await Trade.find({ status: 'CLOSED', target1Hit: true });
console.log(`Found ${affected.length} closed T1-hit trades to recompute\n`);

for (const trade of affected) {
  const before = { realizedPnl: trade.realizedPnl, netPnl: trade.netPnl, estCosts: trade.estCosts };
  const fixed = computeCloseFields(trade, trade.exitPrice, trade.exitReason, trade.exitDate);
  console.log(`${trade.symbol}:`);
  console.log(`  before: realizedPnl=${before.realizedPnl}  netPnl=${before.netPnl}  estCosts=${before.estCosts}`);
  console.log(`  after:  realizedPnl=${fixed.realizedPnl}  netPnl=${fixed.netPnl}  estCosts=${fixed.estCosts}`);
  await Trade.updateOne(
    { _id: trade._id },
    { $set: {
      realizedPnl: fixed.realizedPnl,
      realizedPnlPct: fixed.realizedPnlPct,
      estCosts: fixed.estCosts,
      netPnl: fixed.netPnl,
    } }
  );
  console.log('  -> updated\n');
}

await mongoose.disconnect();
console.log('Done.');
