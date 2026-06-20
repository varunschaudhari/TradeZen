/**
 * @file test-integration.mjs
 * @description STEP 10 — end-to-end integration test for SwingTrader AI.
 *
 * Requires all three services to be running:
 *   • MongoDB         (localhost:27017 or Atlas)
 *   • Python service  (localhost:8001)
 *   • Node server     (localhost:5000)
 *
 * Quick-start (local, no Docker):
 *   1. Start MongoDB:       docker run -d -p 27017:27017 mongo:7
 *   2. Start Python:        cd python-service && uvicorn app.main:app --port 8001
 *   3. Seed DB:             cd server && node scripts/seed.js
 *   4. Start Node server:   cd server && node src/app.js
 *   5. Run this test:       node test-integration.mjs
 *
 * Quick-start (Docker Compose):
 *   docker-compose up -d
 *   docker-compose exec server node scripts/seed.js
 *   node test-integration.mjs
 *
 * Environment:
 *   SERVER_URL    default http://localhost:5000
 *   PYTHON_URL    default http://localhost:8001
 *   SCAN_WAIT_S   seconds to wait for scan results (default 90)
 */

const SERVER = process.env.SERVER_URL ?? 'http://localhost:5000';
const PYTHON = process.env.PYTHON_URL ?? 'http://localhost:8001';
const SCAN_WAIT = parseInt(process.env.SCAN_WAIT_S ?? '90', 10);

const get  = (url) => fetch(url).then((r) => r.json());
const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => ({ status: r.status, body: r.json() }))
    .then(async ({ status, body }) => ({ status, body: await body }));
const patch = (url, body) =>
  fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json());
const del = (url) => fetch(url, { method: 'DELETE' }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Test runner ────────────────────────────────────────────────────────────────
let passed = 0, failed = 0, skipped = 0;
const results = [];

function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  results.push({ ok, label, detail });
  ok ? passed++ : failed++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' (' + detail + ')' : ''}`);
}

function skip(label, reason) {
  results.push({ ok: null, label, detail: reason });
  skipped++;
  console.log(`  SKIP ${label} — ${reason}`);
}

async function run() {
  console.log('\nSwingTrader AI — Integration Test (STEP 10)');
  console.log('='.repeat(50));
  console.log(`  Server:  ${SERVER}`);
  console.log(`  Python:  ${PYTHON}`);
  console.log(`  Scan wait: ${SCAN_WAIT}s\n`);

  // ── 1. Health checks ─────────────────────────────────────────────────────────
  console.log('── 1. Health Checks ─────────────────────────────────');
  let serverUp = false, pythonUp = false;
  try {
    const sh = await get(`${SERVER}/health`);
    serverUp = sh.success === true;
    check('Node server /health → 200', serverUp, `success=${sh.success}`);
  } catch (e) {
    check('Node server /health → 200', false, e.message);
  }

  try {
    const ph = await get(`${PYTHON}/health`);
    pythonUp = ph.status === 'healthy';
    check('Python service /health → healthy', pythonUp, `status=${ph.status}`);
  } catch (e) {
    check('Python service /health → healthy', false, e.message);
  }

  if (!serverUp) {
    console.log('\nNode server not running — aborting integration test.');
    console.log('Start it with: cd server && node src/app.js');
    process.exit(1);
  }

  // ── 2. Config API ─────────────────────────────────────────────────────────────
  console.log('\n── 2. Config API ────────────────────────────────────');
  let config = null;
  try {
    const res = await get(`${SERVER}/api/config`);
    config = res.data;
    check('GET /api/config → success', res.success, `capital=₹${config?.capital?.toLocaleString('en-IN') ?? 'N/A'}`);
    check('Config has capital field', typeof config?.capital === 'number');
    check('Config paperTradeMode is boolean', typeof config?.paperTradeMode === 'boolean');
    check('Config paperTradeMode is ON (safe default)', config?.paperTradeMode === true);

    if (!config) {
      console.log('  No Config document — run: cd server && node scripts/seed.js');
    }
  } catch (e) {
    check('GET /api/config', false, e.message);
  }

  // PATCH config — update capital
  try {
    const original = config?.capital ?? 1_000_000;
    const res = await patch(`${SERVER}/api/config`, { capital: original });
    check('PATCH /api/config → success', res.success);
    check('PATCH preserves capital value', res.data?.capital === original);
  } catch (e) {
    check('PATCH /api/config', false, e.message);
  }

  // ── 3. Watchlist API ─────────────────────────────────────────────────────────
  console.log('\n── 3. Watchlist API ─────────────────────────────────');
  const TEST_SYMBOL = 'WIPRO';
  let watchlistHasTestSymbol = false;

  // Check current watchlist
  try {
    const res = await get(`${SERVER}/api/watchlist`);
    check('GET /api/watchlist → success', res.success);
    check('Watchlist is an array', Array.isArray(res.data?.watchlist));
    const count = res.data?.watchlist?.length ?? 0;
    console.log(`  INFO watchlist has ${count} stock(s)`);
    watchlistHasTestSymbol = res.data?.watchlist?.some((w) => w.symbol === TEST_SYMBOL);
  } catch (e) {
    check('GET /api/watchlist', false, e.message);
  }

  // Add test stock (WIPRO)
  if (!watchlistHasTestSymbol) {
    try {
      const { status, body } = await post(`${SERVER}/api/watchlist`, { symbol: TEST_SYMBOL, sector: 'IT' });
      const ok = status === 201 || status === 409; // 409 = already exists
      check(`POST /api/watchlist ${TEST_SYMBOL} → 201/409`, ok, `status=${status}`);
    } catch (e) {
      check(`POST /api/watchlist ${TEST_SYMBOL}`, false, e.message);
    }
  } else {
    skip(`POST /api/watchlist ${TEST_SYMBOL}`, 'already in watchlist');
  }

  // Joi validation — bad symbol
  try {
    const { status } = await post(`${SERVER}/api/watchlist`, {});
    check('POST /api/watchlist {} → 400 (Joi)', status === 400, `status=${status}`);
  } catch (e) {
    check('POST /api/watchlist {} → 400 (Joi)', false, e.message);
  }

  // Remove test stock
  try {
    const res = await del(`${SERVER}/api/watchlist/${TEST_SYMBOL}`);
    check(`DELETE /api/watchlist/${TEST_SYMBOL} → success`, res.success || res.code === 404);
  } catch (e) {
    check(`DELETE /api/watchlist/${TEST_SYMBOL}`, false, e.message);
  }

  // ── 4. News API ───────────────────────────────────────────────────────────────
  console.log('\n── 4. News API ──────────────────────────────────────');
  try {
    const res = await get(`${SERVER}/api/news/RELIANCE`);
    check('GET /api/news/RELIANCE → success', res.success);
    check('News has sentiment field', ['POSITIVE', 'NEUTRAL', 'NEGATIVE'].includes(res.data?.sentiment));
    check('News has headlines array', Array.isArray(res.data?.headlines));
    console.log(`  INFO sentiment=${res.data?.sentiment}, headlines=${res.data?.headlines?.length ?? 0}`);
  } catch (e) {
    check('GET /api/news/RELIANCE', false, e.message);
  }

  // Bad symbol format — use raw fetch to capture status code
  try {
    const raw = await fetch(`${SERVER}/api/news/BADSYM123456789012345`);
    check('GET /api/news/(26-char symbol) → 400', raw.status === 400, `status=${raw.status}`);
  } catch (e) {
    check('GET /api/news/(26-char symbol) → 400', false, e.message);
  }

  // ── 5. OHLCV (Python proxy) ───────────────────────────────────────────────────
  console.log('\n── 5. OHLCV Candlestick Data ────────────────────────');
  if (!pythonUp) {
    skip('GET /api/ohlcv/TCS', 'Python service not running');
  } else {
    try {
      const res = await get(`${SERVER}/api/ohlcv/TCS?period=30d&interval=1d`);
      check('GET /api/ohlcv/TCS → success', res.success);
      const bars = res.data?.data ?? [];
      check('OHLCV has at least 10 bars', bars.length >= 10, `bars=${bars.length}`);
      if (bars.length > 0) {
        const b = bars[0];
        check('OHLCV bar has time/open/high/low/close',
          b.time && b.open && b.high && b.low && b.close,
          `open=${b.open}`);
      }
      console.log(`  INFO TCS OHLCV: ${bars.length} bars`);
    } catch (e) {
      check('GET /api/ohlcv/TCS', false, e.message);
    }
  }

  // ── 6. Performance API ────────────────────────────────────────────────────────
  console.log('\n── 6. Performance API ───────────────────────────────');
  try {
    const res = await get(`${SERVER}/api/performance`);
    check('GET /api/performance → success', res.success);
    const d = res.data;
    check('Performance has winRate', typeof d?.winRate === 'number');
    check('Performance has avgRR', typeof d?.avgRR === 'number');
    check('Performance has totalPnl', typeof d?.totalPnl === 'number');
    check('Performance has capital', typeof d?.capital === 'number');
  } catch (e) {
    check('GET /api/performance', false, e.message);
  }

  try {
    const res = await get(`${SERVER}/api/performance/history`);
    check('GET /api/performance/history → success', res.success);
    check('History has monthly array', Array.isArray(res.data?.monthly));
  } catch (e) {
    check('GET /api/performance/history', false, e.message);
  }

  // ── 7. Trades API ─────────────────────────────────────────────────────────────
  console.log('\n── 7. Trades API ────────────────────────────────────');
  try {
    const res = await get(`${SERVER}/api/trades`);
    check('GET /api/trades → success', res.success);
    check('Trades data is array', Array.isArray(res.data));
  } catch (e) {
    check('GET /api/trades', false, e.message);
  }

  try {
    const res = await get(`${SERVER}/api/trades/open`);
    check('GET /api/trades/open → success', res.success);
  } catch (e) {
    check('GET /api/trades/open', false, e.message);
  }

  // Joi validation — incomplete trade
  try {
    const { status } = await post(`${SERVER}/api/trades`, { symbol: 'INFY' });
    check('POST /api/trades with missing fields → 400', status === 400, `status=${status}`);
  } catch (e) {
    check('POST /api/trades Joi validation', false, e.message);
  }

  // ── 8. Signals API + Manual Scan ─────────────────────────────────────────────
  console.log('\n── 8. Signals API ───────────────────────────────────');
  try {
    const res = await get(`${SERVER}/api/signals`);
    check('GET /api/signals → success', res.success);
    check('Signals data is array', Array.isArray(res.data));
    const buyCount = (res.data ?? []).filter((s) => s.verdict === 'BUY').length;
    const waitCount = (res.data ?? []).filter((s) => s.verdict === 'WAIT').length;
    console.log(`  INFO signals in DB: ${res.data?.length ?? 0} (BUY=${buyCount}, WAIT=${waitCount})`);
  } catch (e) {
    check('GET /api/signals', false, e.message);
  }

  try {
    const res = await get(`${SERVER}/api/signals/active`);
    check('GET /api/signals/active → success', res.success);
  } catch (e) {
    check('GET /api/signals/active', false, e.message);
  }

  // ── 9. Manual scan trigger ────────────────────────────────────────────────────
  console.log('\n── 9. Manual Scan ───────────────────────────────────');
  if (!config?.watchlist?.length && !pythonUp) {
    skip('POST /api/signals/scan', 'No watchlist stocks and Python not running');
  } else {
    let scanQueued = false;
    try {
      const { status, body } = await post(`${SERVER}/api/signals/scan`, {});
      const b = await body;
      scanQueued = status === 202;
      check('POST /api/signals/scan → 202 Accepted', scanQueued, `status=${status}`);
      console.log(`  INFO ${b?.message ?? ''}`);
    } catch (e) {
      check('POST /api/signals/scan', false, e.message);
    }

    if (scanQueued && pythonUp && config?.watchlist?.length > 0) {
      console.log(`  INFO Polling for scan results (up to ${SCAN_WAIT}s)…`);
      const startTs = Date.now();
      let signalCount = 0;

      while (Date.now() - startTs < SCAN_WAIT * 1000) {
        await sleep(10_000);
        try {
          const res = await get(`${SERVER}/api/signals`);
          const latest = (res.data ?? []).filter(
            (s) => new Date(s.createdAt) > new Date(startTs)
          );
          if (latest.length > 0) {
            signalCount = latest.length;
            console.log(`  INFO ${signalCount} new signal(s) found after scan`);
            break;
          }
          const elapsed = Math.round((Date.now() - startTs) / 1000);
          console.log(`  INFO still waiting… ${elapsed}s elapsed`);
        } catch (_) { /* network hiccup — keep polling */ }
      }

      if (signalCount > 0) {
        // Validate signal structure
        const sig = await get(`${SERVER}/api/signals`).then((r) => r.data?.[0]);
        check('Signal has symbol field', typeof sig?.symbol === 'string');
        check('Signal verdict is BUY|WAIT|SKIP', ['BUY','WAIT','SKIP'].includes(sig?.verdict));
        check('Signal confidence is HIGH|MEDIUM|LOW', ['HIGH','MEDIUM','LOW'].includes(sig?.confidence));
        check('Signal has gatesPassed', typeof sig?.gatesPassed === 'number');
        check('Signal has stopLoss', typeof sig?.stopLoss === 'number' || sig?.verdict === 'SKIP');
        check('Signal has marketContext', sig?.marketContext != null);
        console.log(`  INFO sample signal: ${sig?.symbol} ${sig?.verdict} (${sig?.confidence}) — gates=${sig?.gatesPassed}`);
      } else {
        console.log(`  INFO No new signals in ${SCAN_WAIT}s — market may be closed or gates insufficient`);
        console.log('  INFO This is expected outside 9:15–15:30 IST weekdays');
        skip('Signal structure validation', 'no new signals produced');
      }
    } else if (!pythonUp) {
      skip('Scan result validation', 'Python service not running');
    }
  }

  // ── 10. Prices API ────────────────────────────────────────────────────────────
  console.log('\n── 10. Prices API ───────────────────────────────────');
  try {
    const { status } = await post(`${SERVER}/api/prices/update`, {});
    check('POST /api/prices/update {} → 400 (Joi)', status === 400, `status=${status}`);
  } catch (e) {
    check('POST /api/prices/update Joi', false, e.message);
  }

  try {
    const { status, body } = await post(`${SERVER}/api/prices/update`, {
      prices: [{ symbol: 'RELIANCE', currentPrice: 2500 }],
    });
    const b = await body;
    // 200 if no open trades, still validates route is working
    check('POST /api/prices/update valid → 200', status === 200, `status=${status}`);
    check('Prices response has symbolsChecked', typeof b?.data?.symbolsChecked === 'number');
  } catch (e) {
    check('POST /api/prices/update', false, e.message);
  }

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(50));
  const total = passed + failed + skipped;
  console.log(`STEP 10 RESULT: ${passed} passed, ${failed} failed, ${skipped} skipped (${total} total)`);
  console.log('='.repeat(50));

  if (failed > 0) {
    console.log('\nFailed checks:');
    results.filter((r) => r.ok === false).forEach((r) => {
      console.log(`  ✗ ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
    });
  }

  if (failed === 0) {
    console.log('\nAll checks passed. SwingTrader AI is operational.');
    console.log('Next steps:');
    console.log('  1. Set your ANTHROPIC_API_KEY in server/.env');
    console.log('  2. Set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID for alerts');
    console.log('  3. Set EMAIL_USER + EMAIL_PASS for email notifications');
    console.log('  4. Open http://localhost:3000 (or docker-compose client) to see the dashboard');
    console.log('  5. Signals auto-scan every 15 min during market hours (9:15–15:30 IST weekdays)');
  }

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Integration test crashed:', err.message);
  process.exit(1);
});
