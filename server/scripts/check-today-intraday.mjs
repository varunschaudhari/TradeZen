import 'dotenv/config';
import mongoose from 'mongoose';
import MarketState from '../src/models/MarketState.js';
import IntradaySignal from '../src/models/IntradaySignal.js';
import IntradayUniverse from '../src/models/IntradayUniverse.js';
import Config from '../src/models/Config.js';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const ms = await MarketState.findOne().lean();
  console.log('=== MarketState ===');
  console.log(JSON.stringify({
    marketMode: ms?.marketMode, lastMarketHealth: ms?.lastMarketHealth,
    vix: ms?.vix, adRatio: ms?.adRatio, updatedAt: ms?.updatedAt,
  }, null, 2));

  const config = await Config.findOne().lean();
  console.log('\nscannerEnabled (swing):', config?.scannerEnabled);

  const today = new Date().toISOString().slice(0, 10);
  console.log('\nToday (server UTC date):', today);

  const universe = await IntradayUniverse.findOne().sort({ createdAt: -1 }).lean().catch(() => null);
  console.log('\n=== Latest intraday universe ===');
  console.log(JSON.stringify({ date: universe?.date, symbolsCount: universe?.symbols?.length, symbols: universe?.symbols?.slice(0, 20), createdAt: universe?.createdAt }, null, 2));

  const todaySignals = await IntradaySignal.find({ sessionDate: today }).lean();
  console.log(`\n=== Today's IntradaySignal docs (sessionDate=${today}): ${todaySignals.length} ===`);
  for (const s of todaySignals) {
    console.log(' ', JSON.stringify({ symbol: s.symbol, source: s.source, direction: s.direction, marketModeAtEntry: s.marketModeAtEntry, alertedAt: s.alertedAt, exitReason: s.exitReason }));
  }

  // Also check yesterday and last few days for context
  const IntradaySignalAll = await IntradaySignal.find({}).sort({ createdAt: -1 }).limit(10).lean();
  console.log('\n=== Last 10 IntradaySignal docs overall (any date) ===');
  for (const s of IntradaySignalAll) {
    console.log(' ', JSON.stringify({ sessionDate: s.sessionDate, symbol: s.symbol, source: s.source, direction: s.direction, marketModeAtEntry: s.marketModeAtEntry, createdAt: s.createdAt }));
  }

  await mongoose.disconnect();
}
main().catch((err) => { console.error(err); process.exit(1); });
