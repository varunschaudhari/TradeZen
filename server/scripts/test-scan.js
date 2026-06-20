/**
 * @file test-scan.js
 * @description Manual scan trigger — runs one full cycle and logs every step in detail.
 *
 * Bypasses market-hours guard so it can be run any time.
 * Does NOT save signals to DB by default.
 *
 * Usage (run from the server/ directory):
 *   node scripts/test-scan.js
 *   node scripts/test-scan.js --symbols TATAMOTORS,ICICIBANK
 *   node scripts/test-scan.js --symbols WIPRO,HDFCBANK --save
 *
 * Flags:
 *   --symbols  Comma-separated NSE symbols (default: TATAMOTORS,ICICIBANK)
 *   --save     Persist signals to MongoDB (paper-trade safe — no orders placed)
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

// ── Load .env BEFORE any service imports that read process.env at module-load time
const __scriptDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__scriptDir, '../.env') });

// ── Dynamic imports run after dotenv, so PYTHON_SERVICE_URL / ANTHROPIC_API_KEY are set ──
const [
  { checkPythonHealth, fetchMarketData, analyzeStocks },
  { fetchNewsAndSentiment },
  { runAllGates, checkGate7 },
  { buildClaudePrompt, callClaudeAPI },
  { default: Signal },
  { default: Config },
] = await Promise.all([
  import('../src/services/pythonBridge.js'),
  import('../src/services/newsFetcher.js'),
  import('../src/services/gateChecker.js'),
  import('../src/services/claudeEngine.js'),
  import('../src/models/Signal.js'),
  import('../src/models/Config.js'),
]);

// Inline the few constants we need — avoids a static import of constants.js
// (which reads process.env at module load and would miss dotenv if imported before it)
const VERDICTS            = { BUY: 'BUY', WAIT: 'WAIT', SKIP: 'SKIP' };
const MARKET_MODES        = { BULL: 'BULL', CAUTION: 'CAUTION', BEAR: 'BEAR' };
const GATES_REQUIRED      = 5;   // GATES_REQUIRED_FOR_CLAUDE
const HARD_BLOCK_GATE_IDS = new Set([1, 2, 3, 6, 8]);

// ── CLI args ──────────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const saveFlag  = args.includes('--save');
const symIdx    = args.indexOf('--symbols');
const rawInput  = symIdx !== -1 ? (args[symIdx + 1] ?? '') : 'TATAMOTORS,ICICIBANK';
const SYMBOLS   = rawInput
  .split(',')
  .map((s) => s.trim().replace(/\.NS$/i, '').toUpperCase())
  .filter(Boolean);

if (!SYMBOLS.length) {
  console.error('No symbols provided. Example: node scripts/test-scan.js --symbols RELIANCE,TCS');
  process.exit(1);
}

// ── Formatting helpers ────────────────────────────────────────────────────────
const INR  = (n) =>
  n != null ? `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : 'N/A';
const PCT  = (n) => n != null ? `${n >= 0 ? '+' : ''}${Number(n).toFixed(2)}%` : 'N/A';
const NUM  = (n, dp = 2) => n != null ? Number(n).toFixed(dp) : 'N/A';
const TICK = (v) => v ? '✓' : '✗';
const PAD  = (s, n = 16) => String(s).padEnd(n);

function sep(ch = '─', len = 58) { return ch.repeat(len); }

function banner(title) {
  const bar = sep('═');
  console.log(`\n${bar}`);
  console.log(`  ${title}`);
  console.log(bar);
}

function step(n, title) {
  const tail = sep('─', Math.max(2, 52 - title.length));
  console.log(`\n[Step ${n}] ${title} ${tail}`);
}

function determineMarketMode(md) {
  const nifty = md?.nifty50;
  if (!nifty || !nifty.aboveEma20) return MARKET_MODES.BEAR;
  if ((md?.vix ?? 0) > 20 || (md?.adRatio ?? 0.5) < 0.4) return MARKET_MODES.CAUTION;
  return MARKET_MODES.BULL;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const wallStart = Date.now();

  // IST timestamp for display
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const istStr = istNow.toUTCString().replace('GMT', 'IST');

  banner('SwingTrader AI — Manual Scan Test');
  console.log(`  Symbols : ${SYMBOLS.join(', ')}`);
  console.log(`  Time    : ${istStr}`);
  console.log(`  Save    : ${saveFlag ? 'YES — signals will be written to MongoDB' : 'NO  — dry run  (add --save to persist)'}`);
  console.log(`  Model   : ${process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'}`);

  // ── Step 0: MongoDB ───────────────────────────────────────────────────────
  step(0, 'MongoDB');
  if (!process.env.MONGODB_URI) {
    console.error('  ✗ MONGODB_URI not set in server/.env');
    process.exit(1);
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8_000 });
    console.log(`  ✓ Connected  →  ${mongoose.connection.host}`);
  } catch (err) {
    console.error(`  ✗ Connection failed: ${err.message}`);
    console.error('    → Check MONGODB_URI in server/.env and ensure MongoDB is running');
    process.exit(1);
  }

  // Load config for capital / risk defaults
  const dbConfig    = await Config.findOne().lean();
  const capital     = dbConfig?.capital          ?? 1_000_000;
  const riskPct     = dbConfig?.riskPercentage   ?? 1;
  const paperMode   = dbConfig?.paperTradeMode   ?? true;
  console.log(`  Capital : ${INR(capital)}   Risk/trade: ${riskPct}%   Paper mode: ${paperMode ? 'ON' : 'OFF'}`);
  if (!dbConfig) {
    console.log('  ⚠ No Config document — using defaults (run: node scripts/seed.js)');
  }

  // ── Step 1: Python Health ─────────────────────────────────────────────────
  step(1, 'Python Service Health');
  const pythonUp = await checkPythonHealth();
  if (!pythonUp) {
    console.error(`  ✗ Python service not reachable at ${process.env.PYTHON_SERVICE_URL ?? 'http://localhost:8001'}`);
    console.error('    → Start with: cd python-service && uvicorn app.main:app --port 8001');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`  ✓ Python service healthy`);

  // ── Step 2: Market Data ───────────────────────────────────────────────────
  step(2, 'Market Data  (Nifty / VIX / A/D)');
  let marketData;
  try {
    marketData = await fetchMarketData();
  } catch (err) {
    console.error(`  ✗ fetchMarketData failed: ${err.message}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const nifty    = marketData?.nifty50;
  const bank     = marketData?.bankNifty;
  const vixVal   = marketData?.vix   ?? 0;
  const adVal    = marketData?.adRatio ?? 0;
  const mode     = determineMarketMode(marketData);

  const vixLabel = vixVal > 25 ? 'EXTREME FEAR' : vixVal > 20 ? 'ELEVATED' : 'NORMAL';
  const adLabel  = adVal  > 0.6 ? 'BULLISH'     : adVal  < 0.4 ? 'BEARISH'  : 'NEUTRAL';
  const emaIcon  = nifty?.aboveEma20 ? '↑ ABOVE' : '↓ BELOW';

  console.log(`  Nifty 50   : ${INR(nifty?.price)}  (${PCT(nifty?.changePct)})  EMA20: ${INR(nifty?.ema20)}  ${emaIcon}`);
  console.log(`  Bank Nifty : ${INR(bank?.price)}  (${PCT(bank?.changePct)})`);
  console.log(`  India VIX  : ${NUM(vixVal, 2)}  [${vixLabel}]`);
  console.log(`  A/D Ratio  : ${NUM(adVal, 3)}  [${adLabel}]`);
  console.log(`  Market Mode: ${mode}`);

  if (mode === MARKET_MODES.BEAR) {
    console.log('');
    console.log('  ⚠ BEAR MODE active — Gate 1 will BLOCK all BUY signals');
  }
  if (vixVal > 20) {
    console.log(`  ⚠ VIX ${NUM(vixVal)} > 20 — elevated fear, CAUTION mode`);
  }

  // ── Step 3: Python Stock Analysis ─────────────────────────────────────────
  step(3, `Python Analysis  (${SYMBOLS.join(', ')})`);
  let stockResults;
  try {
    const resp  = await analyzeStocks(SYMBOLS, capital, riskPct);
    stockResults = resp?.results ?? [];
    console.log(`  ✓ ${stockResults.length} result(s) received  (errors: ${resp?.errorCount ?? 0})`);
  } catch (err) {
    console.error(`  ✗ analyzeStocks failed: ${err.message}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  // ── Per-symbol ─────────────────────────────────────────────────────────────
  const summary = [];   // { sym, verdict, confidence?, tokensUsed?, costInr?, saved? }
  let totalTokens = 0;
  let totalCostInr = 0;

  for (const stockData of stockResults) {
    const sym = stockData.symbol ?? 'UNKNOWN';

    console.log(`\n${sep('─')}`);
    console.log(`  SYMBOL: ${sym}`);
    console.log(sep('─'));

    // ── Python error ───────────────────────────────────────────────────────
    if (stockData.error) {
      console.log(`  ✗ Python analysis error: ${stockData.error}`);
      summary.push({ sym, verdict: 'PYTHON_ERROR', note: stockData.error });
      continue;
    }

    // ── Stock snapshot ─────────────────────────────────────────────────────
    const ind = stockData.indicators ?? {};
    const fib = stockData.fibonacci  ?? {};

    console.log('');
    console.log('  Price & Trend:');
    console.log(`    Current    : ${INR(stockData.currentPrice)}  (${PCT(stockData.dayChangePct)})`);
    console.log(`    52w Range  : ${INR(stockData.low52w)} – ${INR(stockData.high52w)}`);
    console.log(`    Weekly     : ${stockData.weeklyTrend ?? 'N/A'}`);

    console.log('');
    console.log('  Indicators:');
    console.log(`    EMA 20/50/200  : ${INR(ind.ema20)} / ${INR(ind.ema50)} / ${INR(ind.ema200)}`);
    console.log(`    RSI (14)       : ${NUM(ind.rsi14)}   [buy zone: 40–65]`);
    console.log(`    MACD/Sig/Hist  : ${NUM(ind.macd)} / ${NUM(ind.macdSignal)} / ${NUM(ind.macdHist)}`);
    console.log(`    ATR (14)       : ${NUM(ind.atr14)}   Bollinger %B: ${NUM(ind.bbPctB, 3)}`);
    console.log(`    Volume Ratio   : ${NUM(ind.volRatio, 2)}×   [≥1.5 = institutional]`);
    console.log(`    Candle Pattern : ${ind.candlePattern ?? 'NONE'}`);

    if ((stockData.supportLevels ?? []).length) {
      const sups = stockData.supportLevels
        .map((l) => `${INR(l.price)} [${l.strength.slice(0, 1).toUpperCase()}]`)
        .join('   ');
      console.log(`    Support        : ${sups}`);
    }
    if ((stockData.resistanceLevels ?? []).length) {
      const rsts = stockData.resistanceLevels
        .map((l) => `${INR(l.price)} [${l.strength.slice(0, 1).toUpperCase()}]`)
        .join('   ');
      console.log(`    Resistance     : ${rsts}`);
    }
    if (fib.fib618 != null) {
      console.log(`    Fibonacci      : 23.6: ${INR(fib.fib236)}  38.2: ${INR(fib.fib382)}  50: ${INR(fib.fib50)}  61.8: ${INR(fib.fib618)}`);
    }

    console.log('');
    console.log('  Suggested Trade Levels:');
    console.log(`    Entry : ${INR(stockData.suggestedEntry)}`);
    console.log(`    SL    : ${INR(stockData.suggestedStopLoss)}`);
    console.log(`    T1    : ${INR(stockData.suggestedTarget1)}`);
    console.log(`    T2    : ${INR(stockData.suggestedTarget2)}`);

    // ── News ───────────────────────────────────────────────────────────────
    console.log('');
    console.log('  News (Gate 8 input):');
    const newsData = await fetchNewsAndSentiment(sym);
    const sentLabel = newsData.sentiment === 'NEGATIVE' ? `${newsData.sentiment} ← GATE 8 WILL BLOCK` : newsData.sentiment;
    console.log(`    Sentiment : ${sentLabel}   (score: ${newsData.score > 0 ? '+' : ''}${newsData.score}, ${newsData.headlines.length} headlines)`);
    newsData.headlines.slice(0, 3).forEach((h, i) =>
      console.log(`    ${i + 1}. ${h.slice(0, 95)}`)
    );

    // ── Gates ──────────────────────────────────────────────────────────────
    console.log('');
    console.log('  Gate Results:');
    const { gatesPassed, gateDetails, hardBlockFired, shouldCallClaude } = runAllGates(
      stockData, marketData, newsData
    );

    const GATE_META = [
      { key: 'gate1', id: 1, label: 'G1  Nifty above 20 EMA    ' },
      { key: 'gate2', id: 2, label: 'G2  Weekly trend ≠ BEARISH' },
      { key: 'gate3', id: 3, label: 'G3  No earnings ≤ 15d     ' },
      { key: 'gate4', id: 4, label: 'G4  RSI in [40–65]        ' },
      { key: 'gate5', id: 5, label: 'G5  Volume ≥ 1.5×         ' },
      { key: 'gate6', id: 6, label: 'G6  R:R ≥ 2:1             ' },
      { key: 'gate8', id: 8, label: 'G8  News not NEGATIVE     ' },
    ];

    for (const { key, id, label } of GATE_META) {
      const g   = gateDetails[key];
      if (!g) continue;
      const tag = !g.passed && HARD_BLOCK_GATE_IDS.has(id) ? '  ← HARD BLOCK' : '';
      console.log(`    ${TICK(g.passed)} ${label}  ${g.reason}${tag}`);
    }

    const callIcon = shouldCallClaude ? '✓' : '✗';
    console.log('');
    console.log(`    Summary: ${gatesPassed}/7 passed  hardBlock=${hardBlockFired}  threshold=${GATES_REQUIRED}`);
    console.log(`    ${callIcon} ${shouldCallClaude ? 'Calling Claude Sonnet' : 'Claude NOT called — threshold not met or hard-block fired'}`);

    // ── Claude ─────────────────────────────────────────────────────────────
    let claudeResult = null;
    let gate7Result  = { passed: false, reason: 'Claude not called — gates insufficient' };

    if (shouldCallClaude) {
      const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
      if (!apiKey || apiKey.startsWith('sk-ant-YOUR')) {
        console.log('');
        console.log('  ⚠ ANTHROPIC_API_KEY not configured — skipping Claude call');
        console.log('    Set a real key in server/.env to test the full pipeline');
        summary.push({ sym, verdict: `GATES_PASS (${gatesPassed}/7)`, note: 'no API key' });
        continue;
      }

      console.log('');
      console.log('  Claude Analysis:');
      try {
        const prompt = buildClaudePrompt(stockData, marketData, newsData, gateDetails, gatesPassed);
        console.log(`    Calling ${process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'} ...`);

        claudeResult = await callClaudeAPI(prompt);
        gate7Result  = checkGate7(claudeResult);

        totalTokens  += claudeResult.tokensUsed ?? 0;
        totalCostInr += claudeResult.costInr    ?? 0;

        console.log(`    Verdict     : ${claudeResult.verdict}`);
        console.log(`    Confidence  : ${claudeResult.confidence}`);
        console.log(`    Entry Zone  : ${INR(claudeResult.entryZone?.low)} – ${INR(claudeResult.entryZone?.high)}`);
        console.log(`    Stop Loss   : ${INR(claudeResult.stopLoss)}`);
        console.log(`    Target 1    : ${INR(claudeResult.target1)}   R:R ${NUM(claudeResult.riskReward)}:1`);
        console.log(`    Target 2    : ${INR(claudeResult.target2)}`);
        console.log(`    Reasoning   : "${claudeResult.reasoning?.slice(0, 130)}"`);
        if ((claudeResult.keyRisks ?? []).length) {
          console.log(`    Key Risks   : ${claudeResult.keyRisks.map((r) => `"${r}"`).join('  |  ')}`);
        }
        if (claudeResult.entryTrigger) {
          console.log(`    Entry Trigger: ${claudeResult.entryTrigger}`);
        }
        if (claudeResult.waitCondition) {
          console.log(`    Wait Cond   : ${claudeResult.waitCondition}`);
        }
        if (claudeResult.skipReason) {
          console.log(`    Skip Reason : ${claudeResult.skipReason}`);
        }
        const g7tag = !gate7Result.passed ? '  ← BUY requires HIGH' : '';
        console.log(`    G7 Result   : ${TICK(gate7Result.passed)} ${gate7Result.reason}${g7tag}`);
        console.log(`    Tokens      : ${(claudeResult.tokensUsed ?? 0).toLocaleString()}   Cost: ₹${claudeResult.costInr}`);
      } catch (err) {
        console.error(`    ✗ Claude API error: ${err.message}`);
        summary.push({ sym, verdict: 'CLAUDE_ERROR', note: err.message });
        continue;
      }
    }

    // ── Final verdict + optional save ──────────────────────────────────────
    console.log('');
    const finalVerdict = claudeResult
      ? claudeResult.verdict
      : hardBlockFired
        ? `BLOCKED (hard gate)`
        : `GATES_INSUFFICIENT (${gatesPassed}/${7})`;

    if (saveFlag && claudeResult) {
      try {
        const gateDetailsWithG7 = { ...gateDetails, gate7: gate7Result };
        const totalGatesPassed  = gatesPassed + (gate7Result.passed ? 1 : 0);

        const signal = await Signal.create({
          symbol:       sym,
          verdict:      claudeResult.verdict,
          confidence:   claudeResult.confidence,
          entryZone:    claudeResult.entryZone,
          stopLoss:     claudeResult.stopLoss     ?? stockData.suggestedStopLoss,
          target1:      claudeResult.target1      ?? stockData.suggestedTarget1,
          target2:      claudeResult.target2      ?? stockData.suggestedTarget2,
          riskReward:   claudeResult.riskReward,
          signalValidTill: new Date(Date.now() + 24 * 60 * 60 * 1_000),
          waitCondition:  claudeResult.waitCondition ?? null,
          skipReason:     claudeResult.skipReason    ?? null,
          reasoning:      claudeResult.reasoning,
          keyRisks:       claudeResult.keyRisks ?? [],
          entryTrigger:   claudeResult.entryTrigger ?? null,
          gatesPassed:    totalGatesPassed,
          gateDetails:    gateDetailsWithG7,
          indicators: {
            ema20:       ind.ema20,
            ema50:       ind.ema50,
            ema200:      ind.ema200,
            rsi:         ind.rsi14,
            macd:        ind.macd,
            macdSignal:  ind.macdSignal,
            volRatio:    ind.volRatio,
            atr:         ind.atr14,
            bollingerB:  ind.bbPctB,
          },
          marketContext: {
            niftyPrice:  marketData?.nifty50?.price,
            vix:         marketData?.vix,
            marketMode:  mode,
            adRatio:     marketData?.adRatio,
          },
          newsSentiment:  newsData.sentiment,
          newsHeadlines:  newsData.headlines,
          isActive:       claudeResult.verdict === VERDICTS.BUY || claudeResult.verdict === VERDICTS.WAIT,
          claudeTokensUsed: claudeResult.tokensUsed ?? 0,
          claudeCostInr:    claudeResult.costInr    ?? 0,
        });

        console.log(`  ✓ Signal saved  →  id: ${signal._id}`);
        summary.push({
          sym,
          verdict:    claudeResult.verdict,
          confidence: claudeResult.confidence,
          tokens:     claudeResult.tokensUsed,
          costInr:    claudeResult.costInr,
          saved:      true,
          signalId:   signal._id.toString(),
        });
      } catch (err) {
        console.error(`  ✗ Signal save failed: ${err.message}`);
        summary.push({ sym, verdict: claudeResult.verdict, saved: false, note: err.message });
      }
    } else if (claudeResult) {
      console.log(`  ✓ Verdict: ${finalVerdict}  (${claudeResult.confidence})  — NOT saved (add --save to persist)`);
      summary.push({
        sym,
        verdict:    claudeResult.verdict,
        confidence: claudeResult.confidence,
        tokens:     claudeResult.tokensUsed,
        costInr:    claudeResult.costInr,
        saved:      false,
      });
    } else {
      console.log(`  — Verdict: ${finalVerdict}  — no Claude call`);
      summary.push({ sym, verdict: finalVerdict, saved: false });
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const durationS = ((Date.now() - wallStart) / 1_000).toFixed(1);
  banner(`Scan Complete  —  ${durationS}s`);
  console.log('');
  console.log(`  ${'Symbol'.padEnd(16)} ${'Verdict'.padEnd(12)} ${'Conf'.padEnd(8)} ${'Tokens'.padEnd(8)} Cost      Saved`);
  console.log(`  ${sep('─', 60)}`);
  for (const r of summary) {
    const conf    = (r.confidence ?? '—').padEnd(8);
    const tokens  = r.tokens != null ? String(r.tokens).padEnd(8) : '—'.padEnd(8);
    const cost    = r.costInr != null ? `₹${r.costInr}` : '—';
    const saved   = r.saved != null ? (r.saved ? '✓' : '✗') : ' ';
    const note    = r.note ? `  (${r.note})` : '';
    console.log(`  ${PAD(r.sym)} ${PAD(r.verdict, 12)} ${conf} ${tokens} ${cost.padEnd(10)} ${saved}${note}`);
  }

  if (totalTokens > 0) {
    console.log('');
    console.log(`  Total Claude usage : ${totalTokens.toLocaleString()} tokens   ₹${totalCostInr.toFixed(4)} INR`);
  }

  console.log('');
  if (!saveFlag && summary.some((r) => r.verdict === VERDICTS.BUY || r.verdict === VERDICTS.WAIT)) {
    console.log('  Tip: Re-run with --save to persist these signals to MongoDB');
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('\nTest scan crashed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
