import mongoose from 'mongoose';
import Signal from './src/models/Signal.js';
import Trade from './src/models/Trade.js';

const MONGODB_URI = 'mongodb://localhost:27017/swing-trader';

async function auditSystem() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✓ Connected to MongoDB\n');

    // 1. Total signals overview
    const totalSignals = await Signal.countDocuments();
    const buySignals = await Signal.countDocuments({ verdict: 'BUY' });
    const waitSignals = await Signal.countDocuments({ verdict: 'WAIT' });
    const skipSignals = await Signal.countDocuments({ verdict: 'SKIP' });

    console.log('📊 SIGNAL DISTRIBUTION:');
    console.log(`  Total signals: ${totalSignals}`);
    console.log(`  BUY: ${buySignals} (${((buySignals/totalSignals)*100).toFixed(1)}%)`);
    console.log(`  WAIT: ${waitSignals} (${((waitSignals/totalSignals)*100).toFixed(1)}%)`);
    console.log(`  SKIP: ${skipSignals} (${((skipSignals/totalSignals)*100).toFixed(1)}%)\n`);

    // 2. BUY signals by confidence
    const buyByConfidence = await Signal.aggregate([
      { $match: { verdict: 'BUY' } },
      { $group: { _id: '$confidence', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    console.log('🎯 BUY SIGNALS BY CONFIDENCE:');
    buyByConfidence.forEach(b => {
      console.log(`  ${b._id}: ${b.count}`);
    });
    console.log();

    // 3. BUY signals by gates passed
    const buyByGates = await Signal.aggregate([
      { $match: { verdict: 'BUY' } },
      { $group: { _id: '$gatesPassed', count: { $sum: 1 } } },
      { $sort: { _id: -1 } }
    ]);

    console.log('🚪 BUY SIGNALS BY GATES PASSED:');
    buyByGates.forEach(b => {
      console.log(`  ${b._id}/8 gates: ${b.count} signals`);
    });
    console.log();

    // 4. Simons override usage
    const withOverride = await Signal.countDocuments({ 'simonOverride': { $ne: null } });
    console.log(`⭐ SIMONS OVERRIDE: ${withOverride} signals (${buySignals > 0 ? ((withOverride/buySignals)*100).toFixed(1) : 0}% of BUYs)\n`);

    // 5. Average Simons score on BUY vs WAIT
    const avgSimonsScore = await Signal.aggregate([
      { $match: { simonsScore: { $ne: null } } },
      { $group: {
          _id: '$verdict',
          avgScore: { $avg: '$simonsScore' },
          count: { $sum: 1 }
        }
      }
    ]);

    console.log('📈 AVERAGE SIMONS SCORE:');
    avgSimonsScore.forEach(s => {
      console.log(`  ${s._id}: ${s.avgScore.toFixed(1)} (${s.count} signals)`);
    });
    console.log();

    // 6. Check for trades linked to signals
    const totalTrades = await Trade.countDocuments();
    const closedTrades = await Trade.countDocuments({ status: 'CLOSED' });
    const openTrades = await Trade.countDocuments({ status: 'OPEN' });

    console.log('💼 TRADE DATA:');
    console.log(`  Total trades: ${totalTrades}`);
    console.log(`  Closed: ${closedTrades}`);
    console.log(`  Open: ${openTrades}\n`);

    // 7. Win rate (closed trades only)
    if (closedTrades > 0) {
      const winningTrades = await Trade.countDocuments({ status: 'CLOSED', realizedPnl: { $gt: 0 } });
      const losingTrades = await Trade.countDocuments({ status: 'CLOSED', realizedPnl: { $lt: 0 } });
      const totalPnL = await Trade.aggregate([
        { $match: { status: 'CLOSED' } },
        { $group: { _id: null, totalPnL: { $sum: '$realizedPnl' } } }
      ]);

      console.log('📊 TRADE OUTCOMES:');
      console.log(`  Winners: ${winningTrades} (${((winningTrades/closedTrades)*100).toFixed(1)}%)`);
      console.log(`  Losers: ${losingTrades} (${((losingTrades/closedTrades)*100).toFixed(1)}%)`);
      console.log(`  Total P&L: ₹${totalPnL[0]?.totalPnL?.toFixed(2) || 0}\n`);
    }

    // 8. Recent 10 BUY signals
    const recentBuys = await Signal.find({ verdict: 'BUY' })
      .select('symbol verdict confidence gatesPassed simonsScore simonOverride createdAt')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    console.log('🔄 RECENT 10 BUY SIGNALS:');
    recentBuys.forEach((sig, i) => {
      const override = sig.simonOverride ? ' [OVERRIDE]' : '';
      console.log(`  ${i+1}. ${sig.symbol} | Gates: ${sig.gatesPassed}/8 | Simons: ${sig.simonsScore ?? 'N/A'} | Confidence: ${sig.confidence}${override}`);
    });

    console.log('\n✓ Audit complete');
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

auditSystem();
