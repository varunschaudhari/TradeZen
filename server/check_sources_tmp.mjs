import mongoose from 'mongoose';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mongo:27017/swing-trader';
await mongoose.connect(MONGODB_URI);
const db = mongoose.connection.db;
const trades = await db.collection('trades').find({ status: 'OPEN' }).project({symbol:1, source:1, entryDate:1, createdAt:1}).toArray();
for (const t of trades) console.log(t.symbol, '| source:', t.source, '| entryDate:', t.entryDate);
await mongoose.disconnect();
