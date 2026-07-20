import mongoose from 'mongoose';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mongo:27017/swing-trader';
await mongoose.connect(MONGODB_URI);
const db = mongoose.connection.db;

const since = new Date(Date.now() - 2*60*60*1000);
const buySignals = await db.collection('signals').find({ verdict: 'BUY', createdAt: { $gte: since } }).sort({createdAt:-1}).toArray();
console.log('BUY signals in last 2h:', buySignals.length);
for (const s of buySignals) {
  console.log(s.symbol, '| createdAt:', s.createdAt, '| updatedAt:', s.updatedAt, '| entryZone:', JSON.stringify(s.entryZone));
}

const openTrades = await db.collection('trades').find({ status: 'OPEN' }).toArray();
const openSymbols = new Set(openTrades.map(t => t.symbol));
console.log('\nOpen trade symbols:', [...openSymbols].join(', '));

console.log('\n--- BUY signals NOT in open trades ---');
for (const s of buySignals) {
  if (!openSymbols.has(s.symbol)) console.log(s.symbol, 'NOT OPEN');
}

const config = await db.collection('configs').findOne({});
console.log('\nautoPaperTrade:', config.autoPaperTrade, '| watchlist:', config.watchlist.map(w=>w.symbol));

await mongoose.disconnect();
