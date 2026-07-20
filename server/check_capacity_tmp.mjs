import mongoose from 'mongoose';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mongo:27017/swing-trader';
await mongoose.connect(MONGODB_URI);
const db = mongoose.connection.db;

const openCount = await db.collection('trades').countDocuments({ status: 'OPEN' });
const config = await db.collection('configs').findOne({});
const openTrades = await db.collection('trades').find({ status: 'OPEN' }).toArray();
const totalDeployed = openTrades.reduce((s,t) => s + (t.capitalDeployed ?? 0), 0);

console.log('Open trades:', openCount, '/ MAX_OPEN_TRADES=15');
console.log('Capital:', config.capital, '| riskPercentage:', config.riskPercentage, '| maxCapitalDeployedPct:', config.maxCapitalDeployedPct);
console.log('Total capital deployed:', totalDeployed, '(', (totalDeployed/config.capital*100).toFixed(1), '% of capital)');

await mongoose.disconnect();
