import mongoose from 'mongoose';
import Signal from './src/models/Signal.js';
import ScanResult from './src/models/ScanResult.js';

const MONGODB_URI = 'mongodb://localhost:27017/tradezen';

async function detailedAudit() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✓ Connected to tradezen\n');

    // 1. Overall signal distribution
    const totalSignals = await Signal.countDocuments();
    const buySignals = await Signal.countDocuments({ verdict: 'BUY' });
    const waitSignals = await Signal.countDocuments({ verdict: 'WAIT' });
    const skipSignals = await Signal.countDocuments({ verdict: 'SKIP' });

    console.log('📊 SIGNAL DISTRIBUTION (All Time):');
    console.log(`  Total: ${totalSignals} | BUY: ${buySignals} | WAIT: ${waitSignals} | SKIP: ${skipSignals}\n`);

    // 2. Last 3 days signals
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const recentTotal = await Signal.countDocuments({ createdAt: { $gte: threeDaysAgo } });
    const recentBuy = await Signal.countDocuments({ verdict: 'BUY', createdAt: { $gte: threeDaysAgo } });
    const recentWait = await Signal.countDocuments({ verdict: 'WAIT', createdAt: { $gte: threeDaysAgo } });

    console.log('📅 LAST 3 DAYS:');
    console.log(`  Total signals: ${recentTotal}`);
    console.log(`  BUY: ${recentBuy} (${recentTotal > 0 ? ((recentBuy/recentTotal)*100).toFixed(1) : 0}%)`);
    console.log(`  WAIT: ${recentWait} (${recentTotal > 0 ? ((recentWait/recentTotal)*100).toFixed(1) : 0}%)\n`);

    // 3. Gate analysis - which are failing most?
    const gateFailures = await Signal.aggregate([
      { $match: { verdict: { $in: ['WAIT', 'SKIP'] } } },
      { $project: {
          gate1: '$gateDetails.gate1.passed',
          gate2: '$gateDetails.gate2.passed',
          gate3: '$gateDetails.gate3.passed',
          gate4: '$gateDetails.gate4.passed',
          gate5: '$gateDetails.gate5.passed',
          gate6: '$gateDetails.gate6.passed',
          gate8: '$gateDetails.gate8.passed',
        }
      },
      { $group: {
          _id: null,
          gate1_fail: { $sum: { $cond: ['$gate1', 0, 1] } },
          gate2_fail: { $sum: { $cond: ['$gate2', 0, 1] } },
          gate3_fail: { $sum: { $cond: ['$gate3', 0, 1] } },
          gate4_fail: { $sum: { $cond: ['$gate4', 0, 1] } },
          gate5_fail: { $sum: { $cond: ['$gate5', 0, 1] } },
          gate6_fail: { $sum: { $cond: ['$gate6', 0, 1] } },
          gate8_fail: { $sum: { $cond: ['$gate8', 0, 1] } },
        }
      }
    ]);

    if (gateFailures.length > 0) {
      const gf = gateFailures[0];
      const total = waitSignals + skipSignals;
      console.log('🚪 GATE FAILURES (in WAIT/SKIP signals):');
      console.log(`  Gate 1 (Nifty EMA): ${gf.gate1_fail} failures (${((gf.gate1_fail/total)*100).toFixed(1)}%)`);
      console.log(`  Gate 2 (Weekly Trend): ${gf.gate2_fail} failures (${((gf.gate2_fail/total)*100).toFixed(1)}%)`);
      console.log(`  Gate 3 (Earnings): ${gf.gate3_fail} failures (${((gf.gate3_fail/total)*100).toFixed(1)}%)`);
      console.log(`  Gate 4 (RSI): ${gf.gate4_fail} failures (${((gf.gate4_fail/total)*100).toFixed(1)}%)`);
      console.log(`  Gate 5 (Volume): ${gf.gate5_fail} failures (${((gf.gate5_fail/total)*100).toFixed(1)}%)`);
      console.log(`  Gate 6 (R:R): ${gf.gate6_fail} failures (${((gf.gate6_fail/total)*100).toFixed(1)}%)`);
      console.log(`  Gate 8 (News): ${gf.gate8_fail} failures (${((gf.gate8_fail/total)*100).toFixed(1)}%)\n`);
    }

    // 4. Claude confidence on BUY candidates (if any got there)
    const buyByConfidence = await Signal.aggregate([
      { $match: { verdict: 'BUY' } },
      { $group: { _id: '$confidence', count: { $sum: 1 } } }
    ]);

    if (buyByConfidence.length > 0) {
      console.log('🎯 BUY SIGNALS BY CONFIDENCE:');
      buyByConfidence.forEach(b => console.log(`  ${b._id}: ${b.count}`));
      console.log();
    }

    // 5. Average gates passed
    const gatesStats = await Signal.aggregate([
      { $group: {
          _id: '$verdict',
          avgGates: { $avg: '$gatesPassed' },
          minGates: { $min: '$gatesPassed' },
          maxGates: { $max: '$gatesPassed' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    console.log('📊 GATES PASSED STATISTICS:');
    gatesStats.forEach(g => {
      console.log(`  ${g._id}: avg ${g.avgGates.toFixed(1)}/8 (min ${g.minGates}, max ${g.maxGates}) | ${g.count} signals`);
    });
    console.log();

    // 6. Simons override usage
    const withOverride = await Signal.countDocuments({ 'simonOverride': { $ne: null } });
    const totalBuy = await Signal.countDocuments({ verdict: 'BUY' });
    console.log(`⭐ SIMONS OVERRIDE: ${withOverride} signals${totalBuy > 0 ? ` (${((withOverride/totalBuy)*100).toFixed(1)}% of BUYs)` : ''}\n`);

    // 7. Recent signals breakdown
    const recent5 = await Signal.find()
      .select('symbol verdict confidence gatesPassed compositeScore simonOverride createdAt')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    console.log('🔄 LAST 5 SIGNALS:');
    recent5.forEach((sig, i) => {
      const override = sig.simonOverride ? ' [OVERRIDE]' : '';
      console.log(`  ${i+1}. ${sig.symbol} | ${sig.verdict} | Gates: ${sig.gatesPassed}/8 | Score: ${sig.compositeScore.toFixed(0)}${override}`);
    });
    console.log();

    // 8. Scan results - show what happened
    const scans = await ScanResult.find().sort({ createdAt: -1 }).limit(3).lean();
    console.log('📈 LAST 3 SCANS:');
    scans.forEach((scan, i) => {
      console.log(`  ${i+1}. ${new Date(scan.createdAt).toLocaleString()}`);
      if (scan.funnel) {
        console.log(`     Universe: ${scan.funnel.universe} → Screened: ${scan.funnel.screened} → Analyzed: ${scan.funnel.analyzed} → Selected: ${scan.funnel.selected} → Claude: ${scan.funnel.claudeCalls}`);
      }
      console.log(`     BUY: ${scan.buySignals ?? 0} | Duration: ${scan.durationMs}ms`);
    });

    console.log('\n✓ Detailed audit complete');
    await mongoose.connection.close();
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

detailedAudit();
