/**
 * @file test-notify.js
 * @description Send a mock BUY alert for ICICIBANK to Telegram and email.
 *              Tests all transport layers: connection verification → dedup clear → live send.
 *
 * Usage (run from server/ directory):
 *   node scripts/test-notify.js                  # full test (Telegram + email)
 *   node scripts/test-notify.js --telegram-only  # skip email
 *   node scripts/test-notify.js --email-only     # skip Telegram
 *   node scripts/test-notify.js --all            # also tests SL warning + bear mode
 *
 * Prerequisites:
 *   • TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID set in server/.env
 *   • EMAIL_USER, EMAIL_PASS, EMAIL_TO set in server/.env
 *   • MongoDB running (optional — falls back to env vars if DB unavailable)
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

// ── Load .env before any service imports ─────────────────────────────────────
const __scriptDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__scriptDir, '../.env') });

// ── Dynamic imports after dotenv ──────────────────────────────────────────────
const {
  sendBuyAlert,
  sendSlWarning,
  sendBearModeAlert,
  sendVixSpikeAlert,
  sendTarget1Hit,
  clearDedupCache,
  testConnections,
} = await import('../src/services/notifier.js');

// ── CLI flags ─────────────────────────────────────────────────────────────────
const args           = process.argv.slice(2);
const telegramOnly   = args.includes('--telegram-only');
const emailOnly      = args.includes('--email-only');
const sendAll        = args.includes('--all');

// ── Formatting ────────────────────────────────────────────────────────────────
const TICK = (v) => v ? '✓' : '✗';
function sep(ch = '─', n = 56) { return ch.repeat(n); }
function banner(t) { console.log(`\n${sep('═')}\n  ${t}\n${sep('═')}`); }
function section(t) { console.log(`\n── ${t} ${sep('─', Math.max(2, 48 - t.length))}`); }

// ── Mock data ─────────────────────────────────────────────────────────────────

/** Realistic BUY signal for ICICIBANK */
const MOCK_BUY_SIGNAL = {
  _id: '000000000000000000000001',
  symbol: 'ICICIBANK',
  verdict: 'BUY',
  confidence: 'HIGH',
  entryZone:       { low: 1245.50, high: 1252.00 },
  stopLoss:        1215.00,
  target1:         1315.00,
  target2:         1370.00,
  riskReward:      2.18,
  shares:          65,
  capitalDeployed: 81_380,
  maxLoss:         2_405,
  maxProfit:       7_670,
  signalValidTill: new Date(Date.now() + 6 * 60 * 60 * 1_000),
  reasoning:
    'ICICIBANK shows strong bullish momentum with RSI at 54.2 — squarely in the 40–65 buy zone. ' +
    'Volume confirmation at 1.85× the 20-day average indicates institutional participation. ' +
    'Price is above all key EMAs (20/50/200) with MACD histogram turning positive. ' +
    'The stock is resting on the 38.2% Fibonacci retracement from the 60-bar swing, ' +
    'providing a well-defined entry with a favourable 2.18:1 risk-reward ratio.',
  keyRisks: [
    'Banking sector NPA concerns — RBI quarterly review due in 2 weeks',
    'FII net outflows from banking sector over the past 5 sessions',
    'Broad market correction risk if Nifty breaks below 20 EMA',
  ],
  entryTrigger:
    'Break and hold above ₹1,252 on a 15-min candle with volume > 1.5 M shares',
  waitCondition:  null,
  skipReason:     null,
  gatesPassed:    8,
  indicators: {
    rsi:      54.2,
    volRatio: 1.85,
    atr:      24.5,
    ema20:    1238.5,
    ema50:    1210.0,
    ema200:   1145.0,
    macd:     8.34,
    macdSignal: 6.12,
    bollingerB: 0.63,
  },
  marketContext: {
    niftyPrice: 24_250,
    vix:        13.8,
    marketMode: 'BULL',
    adRatio:    0.68,
  },
  newsSentiment:    'NEUTRAL',
  newsHeadlines:    [
    'ICICI Bank Q2 results beat estimates on strong retail credit growth',
    'RBI keeps repo rate unchanged at 6.5% — banking stocks rally',
  ],
  claudeTokensUsed: 1_240,
  claudeCostInr:    0.0044,
};

/** Matching open trade for SL warning and T1 tests */
const MOCK_TRADE = {
  _id:             '000000000000000000000002',
  symbol:          'ICICIBANK',
  entryPrice:      1251.00,
  stopLoss:        1215.00,
  target1:         1315.00,
  target2:         1370.00,
  shares:          65,
  capitalDeployed: 81_315,
  currentPrice:    1220.50,    // close to stop loss — triggers SL warning
  unrealizedPnl:   -1_982.5,
  unrealizedPnlPct: -2.44,
};

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  banner('SwingTrader AI — Notifier Test');
  console.log(`  Symbol  : ICICIBANK (mock BUY signal)`);
  console.log(`  Channels: ${telegramOnly ? 'Telegram only' : emailOnly ? 'Email only' : 'Telegram + Email'}`);
  console.log(`  Mode    : ${sendAll ? 'Full suite (all 5 alert types)' : 'BUY alert only'}`);

  // ── Step 0: MongoDB (optional) ────────────────────────────────────────────
  section('Step 0 — MongoDB (optional)');
  try {
    if (!process.env.MONGODB_URI || process.env.MONGODB_URI.includes('YOUR_')) {
      console.log('  ⚠ MONGODB_URI not configured — skipping DB connect');
      console.log('    paperTradeMode will default to ON (safe)');
    } else {
      await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5_000 });
      console.log(`  ✓ Connected  →  ${mongoose.connection.host}`);
    }
  } catch (err) {
    console.log(`  ⚠ MongoDB unavailable (${err.message}) — continuing without DB`);
    console.log('    paperTradeMode defaults to ON, recipients read from env vars');
  }

  // ── Step 1: Connection verification ──────────────────────────────────────
  section('Step 1 — Connection Verification');
  const conn = await testConnections();

  const tgOk = conn.telegram?.ok ?? false;
  const emOk = conn.email?.ok    ?? false;

  if (conn.telegram?.ok) {
    console.log(`  ✓ Telegram bot @${conn.telegram.username}  →  chat_id: ${conn.telegram.chatId}`);
  } else {
    console.log(`  ✗ Telegram: ${conn.telegram?.reason ?? 'not configured'}`);
    if (!telegramOnly) {
      console.log('    → Set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in server/.env');
      if (!emailOnly && !emOk) {
        console.log('\n  Neither channel is configured. Nothing to test.\n');
        await cleanup();
        process.exit(1);
      }
    }
  }

  if (conn.email?.ok) {
    console.log(`  ✓ Email SMTP verified  →  to: ${conn.email.to}  from: ${conn.email.from}`);
  } else {
    console.log(`  ✗ Email: ${conn.email?.reason ?? 'not configured'}`);
    if (!emailOnly) {
      console.log('    → Set EMAIL_USER + EMAIL_PASS + EMAIL_TO in server/.env');
    }
  }

  // Decide what to actually send
  const willSendTelegram = !emailOnly  && tgOk;
  const willSendEmail    = !telegramOnly && emOk;

  if (!willSendTelegram && !willSendEmail) {
    console.log('\n  No configured channels to send to.');
    console.log('  Fill in server/.env and re-run.\n');
    await cleanup();
    process.exit(1);
  }

  // ── Step 2: Clear dedup cache ─────────────────────────────────────────────
  section('Step 2 — Clear Dedup Cache');
  clearDedupCache();
  console.log('  ✓ In-memory dedup state cleared');
  console.log('    (alerts sent in this test will not be suppressed by prior runs)');

  // ── Step 3: Send mock BUY alert ───────────────────────────────────────────
  section('Step 3 — Send BUY Alert: ICICIBANK');
  console.log('  Signal details:');
  console.log(`    Verdict    : ${MOCK_BUY_SIGNAL.verdict} (${MOCK_BUY_SIGNAL.confidence})`);
  console.log(`    Entry Zone : ₹${MOCK_BUY_SIGNAL.entryZone.low} – ₹${MOCK_BUY_SIGNAL.entryZone.high}`);
  console.log(`    Stop Loss  : ₹${MOCK_BUY_SIGNAL.stopLoss}   R:R: ${MOCK_BUY_SIGNAL.riskReward}:1`);
  console.log(`    Target 1   : ₹${MOCK_BUY_SIGNAL.target1}   Target 2: ₹${MOCK_BUY_SIGNAL.target2}`);
  console.log(`    Shares     : ${MOCK_BUY_SIGNAL.shares}   Deployed: ₹${MOCK_BUY_SIGNAL.capitalDeployed.toLocaleString('en-IN')}`);
  console.log('');
  console.log('  Sending...');

  try {
    await sendBuyAlert(MOCK_BUY_SIGNAL);
    console.log(`  ${TICK(willSendTelegram)} Telegram  ${willSendTelegram ? 'sent' : 'skipped (not configured)'}`);
    console.log(`  ${TICK(willSendEmail)}    Email     ${willSendEmail    ? 'sent' : 'skipped (not configured)'}`);
    console.log('');
    console.log('  ✓ BUY alert sent — check your Telegram / inbox now');
  } catch (err) {
    console.error(`  ✗ sendBuyAlert threw: ${err.message}`);
  }

  // ── Step 4: Additional alert types (--all flag) ───────────────────────────
  if (sendAll) {
    clearDedupCache(); // reset between each alert type

    // SL Warning
    section('Step 4a — SL Warning Alert');
    console.log(`  Trade at ₹${MOCK_TRADE.currentPrice} → SL ₹${MOCK_TRADE.stopLoss}  (${MOCK_TRADE.unrealizedPnlPct}% unrealized)`);
    try {
      await sendSlWarning(MOCK_TRADE);
      console.log('  ✓ SL warning sent');
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
    }

    clearDedupCache();

    // Target 1 Hit
    section('Step 4b — Target 1 Hit Alert');
    const t1Trade = {
      ...MOCK_TRADE,
      currentPrice:    1315.00,
      unrealizedPnl:   4_160,
      unrealizedPnlPct: 5.12,
      target1Hit:      true,
    };
    console.log(`  Trade reached T1: ₹${t1Trade.target1}  (+${t1Trade.unrealizedPnlPct}%)`);
    try {
      await sendTarget1Hit(t1Trade);
      console.log('  ✓ Target 1 alert sent');
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
    }

    clearDedupCache();

    // Bear Mode
    section('Step 4c — Bear Mode Alert');
    console.log('  Simulating Nifty drop below 20 EMA...');
    try {
      await sendBearModeAlert();
      console.log('  ✓ Bear mode alert sent');
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
    }

    clearDedupCache();

    // VIX Spike
    section('Step 4d — VIX Spike Alert');
    const mockVix = 22.5;
    console.log(`  Simulating VIX spike: ${mockVix}`);
    try {
      await sendVixSpikeAlert(mockVix);
      console.log(`  ✓ VIX spike alert sent (${mockVix})`);
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
    }
  }

  // ── Dedup verification ────────────────────────────────────────────────────
  section('Step 5 — Dedup Verification');
  console.log('  Sending the same BUY alert again WITHOUT clearing cache...');
  let secondSendLogged = false;
  const origLog = console.log;
  console.log = (...a) => { secondSendLogged = true; origLog(...a); };
  try {
    await sendBuyAlert(MOCK_BUY_SIGNAL); // should be silently suppressed
  } finally {
    console.log = origLog;
  }
  console.log(`  ✓ Second BUY alert was ${secondSendLogged ? 'NOT' : ''} suppressed by dedup (4-hour window active)`);

  // ── Summary ───────────────────────────────────────────────────────────────
  banner('Test Complete');
  console.log('');
  console.log(`  ${TICK(willSendTelegram)} Telegram  ${tgOk ? `(@${conn.telegram?.username})` : '— not configured'}`);
  console.log(`  ${TICK(willSendEmail)}    Email     ${emOk ? `(${conn.email?.to})`           : '— not configured'}`);
  if (sendAll) {
    console.log('  ✓ All 5 alert types tested (BUY, SL warning, T1 hit, bear mode, VIX spike)');
  }
  console.log('');
  console.log('  Expected in Telegram:');
  console.log('    🚀 BUY SIGNAL — ICICIBANK');
  console.log('    Entry ₹1,245 – ₹1,252  |  SL ₹1,215  |  T1 ₹1,315  |  R:R 2.18:1');
  console.log('');
  console.log('  Expected in email inbox:');
  console.log('    Subject: 🚀 BUY: ICICIBANK (HIGH)');
  console.log('    Dark-theme HTML card with full trade details');
  console.log('');

  if (!tgOk && !emOk) {
    console.log('  To configure:');
    console.log('    Telegram: https://t.me/BotFather  →  create bot  →  set TELEGRAM_BOT_TOKEN');
    console.log('    Chat ID:  send any msg to your bot, then call https://api.telegram.org/bot<TOKEN>/getUpdates');
    console.log('    Email:    Gmail → Settings → Security → 2FA → App Passwords  →  set EMAIL_PASS');
  }

  await cleanup();
  process.exit(0);
}

async function cleanup() {
  try {
    if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  } catch (_) { /* ignore */ }
}

main().catch((err) => {
  console.error('\nTest crashed:', err.message, '\n', err.stack);
  cleanup().finally(() => process.exit(1));
});
