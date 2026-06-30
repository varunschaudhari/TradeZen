import mongoose from 'mongoose';

async function auditTradezen() {
  try {
    await mongoose.connect('mongodb://localhost:27017/tradezen');
    console.log('✓ Connected to tradezen database\n');

    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();

    console.log('📦 Collections:\n');

    for (const col of collections) {
      const count = await db.collection(col.name).countDocuments();
      const sample = await db.collection(col.name).findOne({});
      console.log(`${col.name}: ${count} documents`);
      if (count > 0 && sample) {
        const keys = Object.keys(sample).slice(0, 5);
        console.log(`  Fields: ${keys.join(', ')}`);
      }
      console.log();
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

auditTradezen();
