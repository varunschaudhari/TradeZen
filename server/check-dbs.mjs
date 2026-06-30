import mongoose from 'mongoose';

async function checkDatabases() {
  try {
    await mongoose.connect('mongodb://localhost:27017');
    const admin = mongoose.connection.getClient().db('admin');
    const dbs = await admin.admin().listDatabases();

    console.log('\n📦 Available MongoDB Databases:');
    dbs.databases.forEach(db => console.log(`  • ${db.name} (${(db.sizeOnDisk / 1024 / 1024).toFixed(2)} MB)`));

    console.log('\n🔍 Checking swing-trader database:\n');

    // Check swing-trader collections
    const st = mongoose.connection.db;
    const collections = await st.listCollections().toArray();
    console.log('Collections:');
    collections.forEach(col => console.log(`  • ${col.name}`));

    // Count documents in key collections
    for (const col of ['signals', 'trades', 'configs']) {
      try {
        const count = await st.collection(col).countDocuments();
        console.log(`\n  ${col}: ${count} documents`);
      } catch (e) {
        console.log(`\n  ${col}: not found`);
      }
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

checkDatabases();
