/**
 * @file claudeEngine.js
 * @description Flow 4 — Claude Sonnet engine: richer Simons-aware prompt builder,
 *              deterministic API call (temperature 0) with retry + rate-limit handling,
 *              expanded JSON parser/validator, and cost estimator. On unrecoverable
 *              failure callClaudeAPI returns a structured SKIP verdict instead of throwing.
 * @author TradeZen Team
 * @created 2026-06-13
 * @lastModified 2026-06-20
 *
 * Signature note: buildClaudePrompt receives the FULL runAllGates() result (which
 * carries gateDetails, gatesPassed, compositeScore, scoreBreakdown, tags) plus capital,
 * rather than the doc's separate (gateResults, compositeScore, capital) args.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  CLAUDE_MAX_TOKENS,
  CLAUDE_RATE_LIMIT_WAIT_MS,
  CLAUDE_TEMPERATURE,
  CONFIDENCE_LEVELS,
  DEFAULT_RISK_PCT,
  SETUP_TYPES,
  VERDICTS,
} from '../config/constants.js';
import { logger } from '../config/logger.js';

// Claude Sonnet 4.6 pricing (USD per token) × 84 INR/USD
const INPUT_COST_PER_TOKEN_INR = (3 / 1_000_000) * 84;
const OUTPUT_COST_PER_TOKEN_INR = (15 / 1_000_000) * 84;

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;
const JSON_REMINDER =
  '\n\nIMPORTANT: Return ONLY valid JSON. No markdown, no text outside the JSON object.';

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// ── Formatting helpers ─────────────────────────────────────────────────────────
function fmt(val, decimals = 2, fallback = 'N/A') {
  if (val === null || val === undefined) return fallback;
  return typeof val === 'number' ? val.toFixed(decimals) : String(val);
}

function fmtPrice(val) {
  return val !== null && val !== undefined ? `₹${fmt(val)}` : 'N/A';
}

function fmtSrLevel(level) {
  return `  ₹${fmt(level.price)}  [${level.strength}]`;
}

function formatGateLines(gateDetails) {
  const labels = {
    gate1: 'G1  Nifty above 20 EMA',
    gate2: 'G2  Weekly trend bullish',
    gate3: 'G3  No earnings within 15 days',
    gate4: 'G4  RSI in [40–65]',
    gate5: 'G5  Volume ≥ 1.5× avg',
    gate6: 'G6  R:R ≥ 2:1',
    gate8: 'G8  News not NEGATIVE',
  };
  return Object.entries(labels)
    .map(([key, label]) => {
      const g = gateDetails?.[key];
      if (!g) return `  ${label}: PENDING`;
      return `  ${g.passed ? '✓' : '✗'} ${label}: ${g.reason}`;
    })
    .join('\n');
}

// ── Prompt section builders ─────────────────────────────────────────────────────
function marketSection(marketData) {
  const nifty = marketData?.nifty50;
  const bank = marketData?.bankNifty;
  const narrow =
    marketData?.marketMode === 'MIXED' || marketData?.narrowMarket
      ? '\n⚠️ NARROW MARKET — index driven by few stocks (weak breadth). Favor only the strongest, highest-conviction setups.'
      : '';
  return `═══════════════ MARKET CONTEXT ═══════════════
Nifty 50:   ${fmtPrice(nifty?.price)} (${fmt(nifty?.changePct)}%)   EMA 20: ${fmtPrice(nifty?.ema20)}   Above EMA: ${nifty?.aboveEma20 ? 'YES' : 'NO'}
Bank Nifty: ${fmtPrice(bank?.price)} (${fmt(bank?.changePct)}%)
India VIX:  ${fmt(marketData?.vix)}   (>20 elevated, >25 extreme fear)
A/D Ratio:  ${fmt(marketData?.adRatio, 3)}   Mode: ${marketData?.marketMode ?? 'N/A'}
FII Flow:   ${marketData?.fiiTrend ?? 'N/A'}    Put/Call Ratio: ${fmt(marketData?.pcRatio)}${narrow}`;
}

function stockSection(stockData) {
  const ind = stockData?.indicators ?? {};
  return `═══════════════ STOCK: ${stockData?.symbol ?? 'UNKNOWN'} ═══════════════
Current Price:  ${fmtPrice(stockData?.currentPrice)}   Day: ${fmt(stockData?.dayChangePct)}%
52-Week Range:  ${fmtPrice(stockData?.low52w)} – ${fmtPrice(stockData?.high52w)}   From High: ${fmt(stockData?.proximity52wHigh)}%
Weekly Trend:   ${stockData?.weeklyTrend ?? 'N/A'}

INDICATORS:
  EMA  20/50/200:  ${fmtPrice(ind.ema20)} / ${fmtPrice(ind.ema50)} / ${fmtPrice(ind.ema200)}
  RSI (14):        ${fmt(ind.rsi14)}   (40–65 is the BUY zone)
  MACD/Signal/Hist:${fmt(ind.macd)} / ${fmt(ind.macdSignal)} / ${fmt(ind.macdHist)}
  ATR (14):        ${fmt(ind.atr14)}
  Bollinger %B:    ${fmt(ind.bbPctB, 3)}
  Volume Ratio:    ${fmt(ind.volRatio, 2)}×
  Candle Pattern:  ${ind.candlePattern ?? 'NONE'}

MOMENTUM (Simons):
  6-Month Momentum:        ${fmt(stockData?.momentum6m)}%
  Relative Strength (Nifty): ${fmt(stockData?.relativeStrength)}`;
}

function levelsSection(stockData) {
  const fib = stockData?.fibonacci ?? {};
  const supports = (stockData?.supportLevels ?? []).map(fmtSrLevel).join('\n') || '  None detected';
  const resistances =
    (stockData?.resistanceLevels ?? []).map(fmtSrLevel).join('\n') || '  None detected';
  return `SUPPORT LEVELS (strongest/nearest first):
${supports}

RESISTANCE LEVELS (strongest/nearest first):
${resistances}

FIBONACCI (60-bar swing):
  38.2%: ${fmtPrice(fib.fib382)}   50.0%: ${fmtPrice(fib.fib50)}   61.8%: ${fmtPrice(fib.fib618)}

SUGGESTED TRADE LEVELS:
  Entry:     ${fmtPrice(stockData?.suggestedEntry)}
  Stop Loss: ${fmtPrice(stockData?.suggestedStopLoss)}
  Target 1:  ${fmtPrice(stockData?.suggestedTarget1)}
  Target 2:  ${fmtPrice(stockData?.suggestedTarget2)}`;
}

function scoreSection(gateResult) {
  const breakdown = (gateResult?.scoreBreakdown ?? [])
    .map((b) => `  ${b.points > 0 ? '+' : ''}${b.points}  ${b.label}`)
    .join('\n');
  const tags = (gateResult?.tags ?? []).join(', ') || 'none';
  return `═══════════════ COMPOSITE SCORE ═══════════════
Score: ${gateResult?.compositeScore ?? 'N/A'}/100   (≥70 HIGH, 50–69 MEDIUM, <50 LOW)
Active signals/tags: ${tags}
Breakdown:
${breakdown || '  (base only)'}`;
}

function sizingSection(stockData, capital) {
  const entry = stockData?.suggestedEntry ?? 0;
  const sl = stockData?.suggestedStopLoss ?? 0;
  const maxRisk = (capital ?? 0) * (DEFAULT_RISK_PCT / 100);
  const riskPerShare = entry - sl;
  const shares = riskPerShare > 0 ? Math.floor(maxRisk / riskPerShare) : 0;
  const deployed = shares * entry;
  const deployedPct = capital ? (deployed / capital) * 100 : 0;
  return `═══════════════ CAPITAL & POSITION SIZING ═══════════════
Total Capital:  ${fmtPrice(capital)}
Max Risk (${DEFAULT_RISK_PCT}%): ${fmtPrice(maxRisk)}
Calc Shares:    ${shares}    Capital to Deploy: ${fmtPrice(deployed)} (${fmt(deployedPct)}%)`;
}

const RESPONSE_SPEC = `═══════════════ RESPONSE FORMAT ═══════════════
Return EXACTLY this JSON (no markdown, no extra prose):
{
  "verdict": "BUY" | "WAIT" | "SKIP",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "setupType": "MOMENTUM_BREAKOUT" | "PULLBACK_TO_SUPPORT" | "MEAN_REVERSION" | "PEAD" | "VOLUME_ANOMALY" | "SECTOR_ROTATION" | "OTHER",
  "entryZone": { "low": <number>, "high": <number> },
  "entryTrigger": "<specific candle/level/event that must occur before entering>",
  "stopLoss": <number>,
  "stopLossReason": "<why this level>",
  "target1": <number>,
  "target1Reason": "<why this level>",
  "target2": <number>,
  "target2Reason": "<why this level>",
  "riskReward": <number>,
  "signalValidDays": <number>,
  "exitBeforeDate": "<YYYY-MM-DD or null>",
  "waitCondition": "<condition to watch, or null>",
  "skipReason": "<reason not viable, or null>",
  "keyRisks": ["<risk 1>", "<risk 2>"],
  "tailwindFactors": ["<factor 1>", "<factor 2>"],
  "simonsSignals": ["<active Simons signals>"],
  "compositeScoreAssessment": "<your read on the composite score>",
  "reasoning": "<3–4 sentences: trend, momentum, risk, why this verdict>"
}

RULES:
- verdict=BUY ONLY with confidence=HIGH. Never BUY with MEDIUM or LOW.
- If in doubt, WAIT (give the condition) or SKIP (give the reason).
- All prices ≥ 0.01, rounded to 2 dp. riskReward = (target1 − entryZone.high) / (entryZone.high − stopLoss).`;

// ── Prompt builder ──────────────────────────────────────────────────────────────
/**
 * Build the full Claude prompt from analysis, news, gate results, and capital.
 *
 * @param {object} stockData  - StockAnalysis (+ Simons enrichment fields if present)
 * @param {object} marketData - Market snapshot (+ fiiTrend, pcRatio if present)
 * @param {object} newsData   - { sentiment, headlines, score }
 * @param {object} gateResult - Full runAllGates() result (gateDetails, gatesPassed, compositeScore…)
 * @param {number} capital    - Trading capital in INR (for position sizing)
 * @returns {string} The prompt
 */
export const buildClaudePrompt = (stockData, marketData, newsData, gateResult, capital) => {
  const headlines = (newsData?.headlines ?? []).length
    ? newsData.headlines.map((h, i) => `  ${i + 1}. ${h}`).join('\n')
    : '  No recent headlines';
  const earningsNote = gateResult?.earningsWarning
    ? '\n⚠️ Earnings within the 15–20 day caution window — factor gap risk into validity.'
    : '';

  return `You are TradeZen — an expert NSE swing trading analyst inspired by Jim Simons'
quantitative approach. Analyze ONLY the data below and return ONLY valid JSON.

${marketSection(marketData)}

${stockSection(stockData)}

${levelsSection(stockData)}

═══════════════ SAFETY GATES ═══════════════
${formatGateLines(gateResult?.gateDetails)}
Gates Passed: ${gateResult?.gatesPassed ?? 0}/7${earningsNote}

${scoreSection(gateResult)}

═══════════════ NEWS SENTIMENT ═══════════════
Sentiment: ${newsData?.sentiment ?? 'NEUTRAL'}   Score: ${fmt(newsData?.score ?? newsData?.sentimentScore, 0)}
${headlines}

${sizingSection(stockData, capital)}

${RESPONSE_SPEC}`;
};

// ── Response parser ───────────────────────────────────────────────────────────
function coerceArray(val) {
  return Array.isArray(val) ? val : [];
}

function coerceNull(val) {
  return val === 'null' || val === undefined ? null : val;
}

/**
 * Strip markdown fences, parse, and validate Claude's JSON response.
 * Throws on parse/validation failure so the caller can retry.
 *
 * @param {string} rawText - Raw text from the Claude message
 * @returns {object} Validated, normalized response object
 */
export const parseClaudeResponse = (rawText) => {
  const stripped = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(`JSON parse failed. Raw: ${rawText.slice(0, 300)}`);
  }

  if (!Object.values(VERDICTS).includes(parsed.verdict)) {
    throw new Error(`Invalid verdict "${parsed.verdict}". Raw: ${rawText.slice(0, 200)}`);
  }
  if (!Object.values(CONFIDENCE_LEVELS).includes(parsed.confidence)) {
    throw new Error(`Invalid confidence "${parsed.confidence}". Raw: ${rawText.slice(0, 200)}`);
  }
  if (!parsed.reasoning || typeof parsed.reasoning !== 'string') {
    throw new Error('Missing reasoning field');
  }
  if (
    !parsed.entryZone ||
    typeof parsed.entryZone.low !== 'number' ||
    typeof parsed.entryZone.high !== 'number'
  ) {
    throw new Error('Invalid entryZone — must have numeric low and high');
  }
  for (const field of ['stopLoss', 'target1', 'target2', 'riskReward']) {
    const val = parsed[field];
    if (val !== undefined && val !== null && (typeof val !== 'number' || val < 0)) {
      throw new Error(`Field "${field}" must be a non-negative number, got: ${val}`);
    }
  }

  return normalizeParsed(parsed);
};

/**
 * Apply defaults, coerce loose values, and enforce the BUY=HIGH rule.
 *
 * @param {object} parsed - Validated raw parsed object
 * @returns {object} Normalized response
 */
function normalizeParsed(parsed) {
  if (!SETUP_TYPES.includes(parsed.setupType)) parsed.setupType = 'OTHER';
  parsed.waitCondition = coerceNull(parsed.waitCondition);
  parsed.skipReason = coerceNull(parsed.skipReason);
  parsed.exitBeforeDate = coerceNull(parsed.exitBeforeDate);
  parsed.keyRisks = coerceArray(parsed.keyRisks);
  parsed.tailwindFactors = coerceArray(parsed.tailwindFactors);
  parsed.simonsSignals = coerceArray(parsed.simonsSignals);
  if (typeof parsed.signalValidDays !== 'number') parsed.signalValidDays = null;

  // Enforce: a BUY must be HIGH confidence — downgrade to WAIT otherwise.
  if (parsed.verdict === VERDICTS.BUY && parsed.confidence !== CONFIDENCE_LEVELS.HIGH) {
    logger.warn('Claude returned BUY with non-HIGH confidence — downgrading to WAIT', {
      confidence: parsed.confidence,
    });
    parsed.verdict = VERDICTS.WAIT;
    parsed.waitCondition =
      parsed.waitCondition ?? 'Wait for a higher-confidence entry signal before committing capital';
  }
  return parsed;
}

/**
 * Build a structured SKIP result for unrecoverable Claude failures.
 *
 * @param {string} reason - Why the call could not produce a verdict
 * @returns {object} SKIP-shaped result with zeroed trade fields
 */
function buildSkipResult(reason) {
  return {
    verdict: VERDICTS.SKIP,
    confidence: CONFIDENCE_LEVELS.LOW,
    setupType: 'OTHER',
    entryZone: null,
    entryTrigger: null,
    stopLoss: null,
    stopLossReason: null,
    target1: null,
    target1Reason: null,
    target2: null,
    target2Reason: null,
    riskReward: null,
    signalValidDays: null,
    exitBeforeDate: null,
    waitCondition: null,
    skipReason: reason,
    keyRisks: [],
    tailwindFactors: [],
    simonsSignals: [],
    compositeScoreAssessment: null,
    reasoning: reason,
    tokensUsed: 0,
    costInr: 0,
  };
}

// ── Cost estimator ────────────────────────────────────────────────────────────
/**
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @returns {number} Cost in INR, rounded to 4 dp
 */
export const estimateCostInr = (inputTokens, outputTokens) =>
  parseFloat(
    (inputTokens * INPUT_COST_PER_TOKEN_INR + outputTokens * OUTPUT_COST_PER_TOKEN_INR).toFixed(4)
  );

// ── API call ──────────────────────────────────────────────────────────────────
/**
 * Call Claude Sonnet deterministically, parse JSON, and retry on failure.
 *
 * On HTTP 429 it waits CLAUDE_RATE_LIMIT_WAIT_MS; on a parse failure it appends a
 * "JSON only" reminder for the next attempt. After all retries are exhausted it
 * returns a structured SKIP result (it does NOT throw), so the scan continues.
 *
 * @param {string} prompt - Full prompt from buildClaudePrompt()
 * @returns {Promise<object>} Parsed verdict object + { tokensUsed, costInr }
 */
export const callClaudeAPI = async (prompt) => {
  const client = getClient();
  const model = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';
  let parseFailed = false;
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const jitter = Math.floor(Math.random() * 500);
      const delay =
        lastError?.status === 429 ? CLAUDE_RATE_LIMIT_WAIT_MS : RETRY_DELAY_MS * attempt + jitter;
      logger.warn(`Claude API retry ${attempt}/${MAX_RETRIES}`, {
        delay,
        rateLimited: lastError?.status === 429,
      });
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const response = await client.messages.create({
        model,
        max_tokens: CLAUDE_MAX_TOKENS,
        temperature: CLAUDE_TEMPERATURE,
        system:
          'You are TradeZen — an expert NSE swing trader. Always respond with valid JSON only. No commentary outside the JSON object.',
        messages: [{ role: 'user', content: parseFailed ? prompt + JSON_REMINDER : prompt }],
      });

      const rawText = response.content?.[0]?.text ?? '';
      const parsed = parseClaudeResponse(rawText);
      const inputTokens = response.usage?.input_tokens ?? 0;
      const outputTokens = response.usage?.output_tokens ?? 0;
      const costInr = estimateCostInr(inputTokens, outputTokens);

      logger.info('Claude API call succeeded', {
        model,
        verdict: parsed.verdict,
        confidence: parsed.confidence,
        setupType: parsed.setupType,
        inputTokens,
        outputTokens,
        costInr,
      });
      return { ...parsed, tokensUsed: inputTokens + outputTokens, costInr };
    } catch (err) {
      lastError = err;
      parseFailed = /parse|verdict|confidence|entryZone|reasoning|number/i.test(err.message ?? '');
      logger.warn(`Claude API attempt ${attempt + 1} failed`, { error: err.message });
    }
  }

  const reason = `Claude unavailable after ${MAX_RETRIES + 1} attempts: ${lastError?.message ?? 'unknown error'}`;
  logger.error('Claude API failed — returning SKIP', { error: lastError?.message });
  return buildSkipResult(reason);
};
