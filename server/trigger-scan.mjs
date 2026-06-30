import axios from 'axios';

async function triggerScan() {
  try {
    console.log('🔄 Triggering scan...\n');
    const response = await axios.post('http://localhost:5000/api/signals/scan?forceRun=true');

    console.log('✅ Scan Response:');
    console.log(JSON.stringify(response.data, null, 2));

  } catch (err) {
    console.error('❌ Error:', err.response?.data || err.message);
  }
}

triggerScan();
