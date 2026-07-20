import mongoose from 'mongoose';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mongo:27017/swing-trader';
await mongoose.connect(MONGODB_URI);
const db = mongoose.connection.db;

// Signals created after the cost-floor fix deployed today
const postFix = await db.collection('intradaysignals').find({ targetCostAdjusted: { $exists: true } }).sort({createdAt:-1}).toArray();
console.log('Signals created since cost-floor field exists (post-fix):', postFix.length);
const settled = postFix.filter(s => s.exitReason);
console.log('Of those, settled:', settled.length);
for (const s of settled) {
  console.log(s.symbol, s.setupType, s.direction, 'targetCostAdjusted:', s.targetCostAdjusted, 'exitReason:', s.exitReason, 'paperPnl:', s.paperPnl);
}

// Full history stats for comparison
const all = await db.collection('intradaysignals').find({ exitReason: { $ne: null }, source: { $ne: 'MANUAL' } }).toArray();
console.log('\nAll-time settled (non-manual):', all.length, '| total net:', all.reduce((s,x)=>s+(x.paperPnl??0),0).toFixed(2));

await mongoose.disconnect();
