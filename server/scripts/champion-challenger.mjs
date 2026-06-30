/**
 * @file champion-challenger.mjs
 * @description Run a champion-vs-challenger comparison. Collects backtested trades for an
 *   in-sample and an out-of-sample symbol set (once), then re-scores both under the champion
 *   and challenger weightings and prints the net-of-cost "would-act" expectancy for each,
 *   in-sample AND OOS, with a promote/reject verdict.
 *
 *   Edit CHALLENGER below to test a proposed change. A challenger is promoted ONLY if it beats
 *   the champion out-of-sample, net-positive, by a margin — so overfit ideas get rejected.
 *
 *   Usage (host, Docker-resilient):
 *     PYTHON_SERVICE_URL=http://localhost:8001 MONGODB_URI=mongodb://localhost:27017/tz-cc \
 *       node scripts/champion-challenger.mjs
 * @author TradeZen Team
 */

import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { collectBacktestTrades } from '../src/services/backtestEngine.js';
import { CHAMPION_WEIGHTS, compareConfigs } from '../src/services/championChallenger.js';
import { SCORE_HIGH_CONFIDENCE } from '../src/config/constants.js';

const IN_SAMPLE = ('RELIANCE TCS HDFCBANK ICICIBANK INFY SBIN BHARTIARTL ITC LT KOTAKBANK AXISBANK ' +
  'HINDUNILVR BAJFINANCE MARUTI SUNPHARMA TITAN ASIANPAINT NESTLEIND ULTRACEMCO WIPRO LUPIN POLYCAB ' +
  'NMDC TRENT PNB CANBK FEDERALBNK ASHOKLEY TVSMOTOR MPHASIS PERSISTENT COFORGE BHARATFORG CONCOR ' +
  'ESCORTS HINDPETRO AUBANK BANDHANBNK SAIL BEL').split(' ');

const OOS = ('APOLLOHOSP TATACONSUM HDFCLIFE SBILIFE AMBUJACEM DLF GAIL HAVELLS IOC PFC RECLTD SIEMENS ' +
  'SRF TATAPOWER VEDL NAUKRI PIDILITIND ICICIPRULI ICICIGI HDFCAMC ADANIENT JINDALSTEL SHRIRAMFIN ' +
  'DABUR MARICO GODREJCP DMART BOSCHLTD COLPAL CUMMINSIND').split(' ');

// ── The proposed change. Edit this to test any weighting idea. ──────────────────
// This example concentrates on the two most robust signals and adds mean-reversion
// (which looked good in-sample) — a plausible idea the OOS gate will judge honestly.
const CHALLENGER = {
  ...CHAMPION_WEIGHTS,
  RSI_SWEET_SPOT: 14,
  RS_STRONG_LEADER: 12,
  MEAN_REVERSION: 6,
};

const fmt = (g) => `net ${g.netAvgR >= 0 ? '+' : ''}${g.netAvgR}R  win ${g.winRate}%  (n=${g.n})`;

const run = async () => {
  await connectDB().catch(() => {}); // DB optional — backtest uses prices, not Mongo
  console.log(`\n▶ Collecting trades (in-sample ${IN_SAMPLE.length} + OOS ${OOS.length} symbols)…\n`);
  const [inSample, oos] = await Promise.all([
    collectBacktestTrades(IN_SAMPLE, { period: '2y', holdMode: 'adaptive' }),
    collectBacktestTrades(OOS, { period: '2y', holdMode: 'adaptive' }),
  ]);
  console.log(`  in-sample trades: ${inSample.length}   OOS trades: ${oos.length}`);

  const r = compareConfigs({
    champion: CHAMPION_WEIGHTS,
    challenger: CHALLENGER,
    threshold: SCORE_HIGH_CONFIDENCE,
    inSample,
    oos,
  });

  console.log(`\n=== CHAMPION vs CHALLENGER (would-act cohort: score ≥ ${r.threshold}, net of cost) ===`);
  console.log(`  IN-SAMPLE   champion: ${fmt(r.champIS)}`);
  console.log(`              challenger: ${fmt(r.chalIS)}`);
  console.log(`  OUT-SAMPLE  champion: ${fmt(r.champOOS)}`);
  console.log(`              challenger: ${fmt(r.chalOOS)}`);
  console.log(`\n=== VERDICT ===\n  ${r.verdict}`);
  console.log('\n  (Promotion requires the challenger to beat the champion OUT-OF-SAMPLE,');
  console.log('   net-positive, by ≥0.03R, with n≥30 — overfit gains in-sample do not count.)\n');

  await mongoose.disconnect().catch(() => {});
  process.exit(0);
};

run().catch((err) => {
  console.error('champion-challenger failed:', err);
  process.exit(1);
});
