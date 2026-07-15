/**
 * @file test-verdict-engine.mjs
 * @description Pure-function unit tests for verdictEngine.js — the deterministic
 *   replacement for the old Claude verdict call. No DB, no network, no Docker needed:
 *   every case is a synthetic (stockData, marketData, gateResult) fixture asserted
 *   against an exact expected output.
 *   Usage: node scripts/test-verdict-engine.mjs
 */

import assert from 'node:assert/strict';
import {
  decideVerdict,
  deriveEntryZone,
  classifySetupType,
  deriveKeyRisks,
} from '../src/services/verdictEngine.js';
import { VERDICTS, CONFIDENCE_LEVELS } from '../src/config/constants.js';

let pass = 0;
let fail = 0;
const failures = [];

function check(label, fn) {
  try {
    fn();
    pass += 1;
  } catch (err) {
    fail += 1;
    failures.push({ label, error: err.message });
  }
}

// ── Fixture builders ──────────────────────────────────────────────────────────
const BULL_MARKET = { marketMode: 'BULL', vix: 14, nifty50: { price: 24000, ema20: 23800 } };
const BEAR_MARKET = { marketMode: 'BEAR', vix: 28, nifty50: { price: 21000, ema20: 23800 } };

function stock(overrides = {}) {
  return {
    symbol: 'TESTSTOCK',
    currentPrice: 1000,
    high52w: 1050,
    weeklyTrend: 'BULLISH',
    sector: 'IT',
    earningsTimestamp: null,
    suggestedEntry: 1000,
    suggestedStopLoss: 970, // risk = 30
    suggestedTarget1: 1055, // rr = 55/30 = 1.83R (below T1_MIN_R 1.5? no, 1.83 >= 1.5, passes)
    suggestedTarget2: 1080, // rr = 80/30 = 2.67R (>= RISK_REWARD_MIN 2.0, passes)
    indicators: { atr14: 15, rsi14: 55, volRatio: 1.8, ema20: 990, ema50: 960 },
    ...overrides,
  };
}

function gate(overrides = {}) {
  return {
    gatesPassed: 7,
    hardBlockFired: false,
    shouldCallClaude: true,
    compositeScore: 65,
    scoreConfidence: CONFIDENCE_LEVELS.HIGH,
    scoreBreakdown: [{ label: 'RSI sweet spot', points: 10 }],
    tags: [],
    gateDetails: {},
    earningsWarning: false,
    ...overrides,
  };
}

// ── 1. Core verdict rules ──────────────────────────────────────────────────────
check('HIGH confidence + BULL + clean geometry → BUY', () => {
  const r = decideVerdict(stock(), BULL_MARKET, gate());
  assert.equal(r.verdict, VERDICTS.BUY);
  assert.equal(r.confidence, CONFIDENCE_LEVELS.HIGH);
  assert.equal(r.downgradedFrom, undefined);
});

check('MEDIUM confidence → WAIT with a waitCondition', () => {
  const r = decideVerdict(stock(), BULL_MARKET, gate({ scoreConfidence: CONFIDENCE_LEVELS.MEDIUM, compositeScore: 55 }));
  assert.equal(r.verdict, VERDICTS.WAIT);
  assert.equal(typeof r.waitCondition, 'string');
  assert.ok(r.waitCondition.length > 0);
});

check('LOW confidence → SKIP with a skipReason', () => {
  const r = decideVerdict(stock(), BULL_MARKET, gate({ scoreConfidence: CONFIDENCE_LEVELS.LOW, compositeScore: 30 }));
  assert.equal(r.verdict, VERDICTS.SKIP);
  assert.equal(typeof r.skipReason, 'string');
  assert.ok(r.skipReason.length > 0);
});

check('hardBlockFired → SKIP regardless of score', () => {
  const r = decideVerdict(stock(), BULL_MARKET, gate({ hardBlockFired: true, scoreConfidence: CONFIDENCE_LEVELS.HIGH, compositeScore: 90 }));
  assert.equal(r.verdict, VERDICTS.SKIP);
  assert.equal(r.skipReason, 'Hard-block gate fired');
});

check('BEAR market → WAIT even with HIGH confidence (never BUY in bear)', () => {
  const r = decideVerdict(stock(), BEAR_MARKET, gate());
  assert.equal(r.verdict, VERDICTS.WAIT);
  assert.match(r.waitCondition, /BEAR/);
});

// ── 2. Target-geometry floor (ported from parseClaudeResponse) ─────────────────
check('BUY downgraded to WAIT when target1 < T1_MIN_R (1.5R)', () => {
  // entry 1000, sl 970 (risk 30), target1 1035 → rrT1 = 35/30 = 1.17R < 1.5R
  const r = decideVerdict(stock({ suggestedTarget1: 1035 }), BULL_MARKET, gate());
  assert.equal(r.verdict, VERDICTS.WAIT);
  assert.equal(r.downgradedFrom, VERDICTS.BUY);
  assert.match(r.downgradeReason, /target1 too close/);
});

check('BUY downgraded to WAIT when target2 R:R < RISK_REWARD_MIN (2.0R)', () => {
  // entry 1000, sl 970 (risk 30), target1 1055 (1.83R, passes), target2 1050 (1.67R < 2.0R)
  const r = decideVerdict(stock({ suggestedTarget2: 1050 }), BULL_MARKET, gate());
  assert.equal(r.verdict, VERDICTS.WAIT);
  assert.equal(r.downgradedFrom, VERDICTS.BUY);
  assert.match(r.downgradeReason, /target2 R:R/);
});

check('BUY downgraded to WAIT when levels are incomplete (no suggestedEntry)', () => {
  const r = decideVerdict(stock({ suggestedEntry: null }), BULL_MARKET, gate());
  assert.equal(r.verdict, VERDICTS.WAIT);
  assert.equal(r.downgradedFrom, VERDICTS.BUY);
  assert.match(r.downgradeReason, /incomplete or invalid/);
});

check('MEDIUM/LOW verdicts are NEVER subject to the geometry-downgrade branch', () => {
  // Same bad geometry as the T1 case above, but score is MEDIUM — should just be WAIT
  // for score reasons, not carry a downgradedFrom (that only applies to BUY attempts).
  const r = decideVerdict(
    stock({ suggestedTarget1: 1035 }),
    BULL_MARKET,
    gate({ scoreConfidence: CONFIDENCE_LEVELS.MEDIUM, compositeScore: 55 })
  );
  assert.equal(r.verdict, VERDICTS.WAIT);
  assert.equal(r.downgradedFrom, undefined);
});

// ── 3. Determinism — the whole point of the exercise ────────────────────────────
check('same inputs always produce the same verdict (deterministic)', () => {
  const s = stock();
  const m = BULL_MARKET;
  const g = gate();
  const r1 = decideVerdict(s, m, g);
  const r2 = decideVerdict(s, m, g);
  assert.deepEqual(r1, r2);
});

check('tokensUsed and costInr are always 0 (zero-cost verdict)', () => {
  const r = decideVerdict(stock(), BULL_MARKET, gate());
  assert.equal(r.tokensUsed, 0);
  assert.equal(r.costInr, 0);
});

check('reasoning is always a non-empty string', () => {
  for (const conf of [CONFIDENCE_LEVELS.HIGH, CONFIDENCE_LEVELS.MEDIUM, CONFIDENCE_LEVELS.LOW]) {
    const r = decideVerdict(stock(), BULL_MARKET, gate({ scoreConfidence: conf }));
    assert.equal(typeof r.reasoning, 'string');
    assert.ok(r.reasoning.length > 0, `reasoning empty for ${conf}`);
  }
});

// ── 4. deriveEntryZone ───────────────────────────────────────────────────────────
check('deriveEntryZone: quarter-ATR band below entry when ATR present', () => {
  const zone = deriveEntryZone(1000, 20);
  assert.equal(zone.high, 1000);
  assert.equal(zone.low, 995); // 1000 - 0.25*20
});

check('deriveEntryZone: falls back to 0.5% band when ATR missing/zero', () => {
  const zone = deriveEntryZone(1000, null);
  assert.equal(zone.high, 1000);
  assert.equal(zone.low, 995); // 1000 - 0.005*1000
});

check('deriveEntryZone: null for non-positive entry', () => {
  assert.equal(deriveEntryZone(0, 10), null);
  assert.equal(deriveEntryZone(null, 10), null);
});

// ── 5. classifySetupType ─────────────────────────────────────────────────────────
check('classifySetupType: MEAN_REVERSION tag wins first', () => {
  const t = classifySetupType(stock(), gate({ tags: ['MEAN_REVERSION'] }));
  assert.equal(t, 'MEAN_REVERSION');
});

check('classifySetupType: near 52w high + EMA20 > EMA50 → MOMENTUM_BREAKOUT', () => {
  const s = stock({ currentPrice: 1040, high52w: 1050, indicators: { ema20: 1020, ema50: 990 } });
  const t = classifySetupType(s, gate());
  assert.equal(t, 'MOMENTUM_BREAKOUT');
});

check('classifySetupType: VOLUME_ANOMALY tag → VOLUME_ANOMALY', () => {
  const t = classifySetupType(stock({ currentPrice: 900 }), gate({ tags: ['VOLUME_ANOMALY'] }));
  assert.equal(t, 'VOLUME_ANOMALY');
});

check('classifySetupType: no matching signal → OTHER', () => {
  const s = stock({ currentPrice: 900, high52w: 1050, indicators: { ema20: 890, ema50: 900 } });
  const t = classifySetupType(s, gate());
  assert.equal(t, 'OTHER');
});

// ── 6. deriveKeyRisks ─────────────────────────────────────────────────────────────
check('deriveKeyRisks: flags earnings warning', () => {
  const risks = deriveKeyRisks(stock(), BULL_MARKET, gate({ earningsWarning: true }));
  assert.ok(risks.some((r) => /earnings/i.test(r)));
});

check('deriveKeyRisks: flags elevated VIX', () => {
  const risks = deriveKeyRisks(stock(), { ...BULL_MARKET, vix: 24 }, gate());
  assert.ok(risks.some((r) => /VIX/i.test(r)));
});

check('deriveKeyRisks: caps at 4 items', () => {
  const risks = deriveKeyRisks(
    stock({ indicators: { atr14: 15, rsi14: 68, volRatio: 0.5, ema20: 990, ema50: 960 } }),
    { ...BULL_MARKET, vix: 24, marketMode: 'CAUTION' },
    gate({ earningsWarning: true, gateDetails: { gate4: { passed: false, reason: 'weak' }, gate5: { passed: false, reason: 'weak vol' } } })
  );
  assert.ok(risks.length <= 4);
});

// ── Report ───────────────────────────────────────────────────────────────────────
console.log(`\nverdictEngine.js: ${pass} passed, ${fail} failed (${pass + fail} total assertions)\n`);
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f.label}\n    ${f.error}`);
  process.exit(1);
}
console.log('All checks passed.');
process.exit(0);
