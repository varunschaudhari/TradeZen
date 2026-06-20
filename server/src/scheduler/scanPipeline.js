/**
 * @file scanPipeline.js
 * @description Flow 11 (JOB 1) — the main 15-minute scan pipeline composing every
 *              Priority 1/2 service: market health → discovery → Claude → signal save
 *              → notify → open-trade monitor. Supersedes the inline marketScanner loop.
 * @author TradeZen Team
 * @created 2026-06-20
 * @lastModified 2026-06-20
 */

import Config from '../models/Config.js';
import Trade from '../models/Trade.js';
import ScanResult from '../models/ScanResult.js';
import {
  DAILY_LOSS_PAUSE_PCT,
  GATES_REQUIRED_FOR_CLAUDE,
  MARKET_CLOSE_HOUR,
  MARKET_CLOSE_MINUTE,
  MARKET_OPEN_HOUR,
  MARKET_OPEN_MINUTE,
  MAX_CAPITAL_DEPLOYED_PCT,
  MAX_OPEN_TRADES,
  NSE_HOLIDAYS,
  SCAN_CLAUDE_CONCURRENCY,
  VERDICTS,
} from '../config/constants.js';
import { logger } from '../config/logger.js';
import { getMarketHealth } from '../services/marketHealthService.js';
import { runStockDiscovery } from '../services/stockDiscovery.js';
import { buildClaudePrompt, callClaudeAPI } from '../services/claudeEngine.js';
import { checkGate7 } from '../services/gateChecker.js';
import { saveSignal } from '../services/signalManager.js';
import { monitorOpenTrades } from '../services/tradeTracker.js';
import { sendBuyAlert, sendWaitToBuyUpgrade } from '../services/notifier.js';
import { emitEvent, SOCKET_EVENTS } from '../socket/socketHandlers.js';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Run async `fn` over `items` with at most `limit` workers in flight.
 * @param {any[]} items - Work items
 * @param {number} limit - Max concurrent workers
 * @param {(item:any)=>Promise<void>} fn - Async task (must handle its own errors)
 * @returns {Promise<void>}
 */
async function runWithConcurrency(items, limit, fn) {
  const results = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      results[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ── Market-hours guard (IST) ────────────────────────────────────────────────────
function getNowIST() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

/**
 * True when current IST time is within 9:15–15:30 on a weekday that is not an
 * NSE trading holiday.
 * @param {Date} [ist] - IST-shifted date (UTC fields read as IST)
 * @returns {boolean}
 */
export function isMarketOpen(ist = getNowIST()) {
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return false; // weekend
  if (NSE_HOLIDAYS.has(ist.toISOString().slice(0, 10))) return false; // NSE holiday (IST date)
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const open = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE;
  const close = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MINUTE;
  return mins >= open && mins <= close;
}

/**
 * Position size from risk budget: never risk more than riskPct of capital (pure).
 * @param {number} entry - Entry price
 * @param {number} stopLoss - Stop loss
 * @param {number} capital - Capital in INR
 * @param {number} riskPct - Risk percent per trade
 * @returns {{ shares: number, capitalDeployed: number, maxLoss: number }}
 */
export function computePositionSize(entry, stopLoss, capital, riskPct) {
  const maxRisk = capital * (riskPct / 100);
  const riskPerShare = Math.max(entry - stopLoss, 0.01);
  const shares = Math.max(Math.floor(maxRisk / riskPerShare), 0);
  return {
    shares,
    capitalDeployed: round2(shares * entry),
    maxLoss: round2(shares * riskPerShare),
  };
}

/**
 * Apply capital-protection rules: downgrade a BUY to WAIT when a guard trips (pure).
 * @param {string} verdict - Claude verdict
 * @param {string|null} waitCondition - Claude wait condition
 * @param {object} guards - { lossLimitHit, tradesAtMax, capitalExhausted }
 * @returns {{ verdict: string, waitCondition: string|null }}
 */
export function effectiveVerdict(verdict, waitCondition, guards) {
  if (verdict !== VERDICTS.BUY) return { verdict, waitCondition };
  if (guards.lossLimitHit) {
    return {
      verdict: VERDICTS.WAIT,
      waitCondition: `Daily loss limit (${DAILY_LOSS_PAUSE_PCT}%) reached — resuming next session`,
    };
  }
  if (guards.tradesAtMax) {
    return {
      verdict: VERDICTS.WAIT,
      waitCondition: `${MAX_OPEN_TRADES} positions open — wait for one to close`,
    };
  }
  if (guards.capitalExhausted) {
    return {
      verdict: VERDICTS.WAIT,
      waitCondition: `${MAX_CAPITAL_DEPLOYED_PCT}% capital deployed — no capacity`,
    };
  }
  return { verdict: VERDICTS.BUY, waitCondition };
}

/**
 * Resolve capital-protection guard flags from open trades and today's closed losses.
 * @param {object} config - Config doc
 * @returns {Promise<{ lossLimitHit: boolean, tradesAtMax: boolean, capitalExhausted: boolean }>}
 */
async function resolveGuards(config) {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const [openTrades, lossTrades] = await Promise.all([
    Trade.find({ status: 'OPEN' }).lean(),
    Trade.find({
      status: 'CLOSED',
      exitDate: { $gte: todayStart },
      realizedPnl: { $lt: 0 },
    }).lean(),
  ]);
  const totalDeployed = openTrades.reduce((s, t) => s + (t.capitalDeployed ?? 0), 0);
  const totalLoss = lossTrades.reduce((s, t) => s + (t.realizedPnl ?? 0), 0);
  return {
    lossLimitHit: totalLoss <= -(config.capital * (DAILY_LOSS_PAUSE_PCT / 100)),
    tradesAtMax: openTrades.length >= MAX_OPEN_TRADES,
    capitalExhausted: totalDeployed >= config.capital * (MAX_CAPITAL_DEPLOYED_PCT / 100),
  };
}

/** Reshape the market-health object into the marketData shape gates/Claude expect. */
function toMarketData(health) {
  const n = health.nifty50 ?? {};
  return {
    nifty50: {
      price: n.price,
      ema20: n.ema20,
      changePct: n.dayChangePct,
      aboveEma20: n.price > n.ema20,
    },
    bankNifty: health.bankNifty,
    vix: health.vix,
    adRatio: health.adRatio,
    marketMode: health.marketMode,
    narrowMarket: health.narrowMarket === true,
  };
}

/**
 * Stage 8 for one candidate: Claude → effective verdict → position size → save → notify.
 * @param {object} candidate - Discovery candidate { stockData, newsData, gateResult, simons }
 * @param {object} marketData - Market snapshot
 * @param {object} config - Config doc
 * @param {object} guards - Capital guard flags
 * @param {object} metrics - Mutable scan metrics
 * @param {number} sizeFactor - Position-size multiplier from market mode (CAUTION/MIXED)
 * @returns {Promise<void>}
 */
async function processCandidate(candidate, marketData, config, guards, metrics, sizeFactor = 1) {
  const { stockData, newsData, gateResult, simons } = candidate;
  const prompt = buildClaudePrompt(stockData, marketData, newsData, gateResult, config.capital);
  const claudeResult = await callClaudeAPI(prompt);
  metrics.claudeCalls += 1;
  metrics.totalTokens += claudeResult.tokensUsed ?? 0;
  metrics.totalCostInr += claudeResult.costInr ?? 0;

  const gate7Result = checkGate7(claudeResult);
  const { verdict, waitCondition } = effectiveVerdict(
    claudeResult.verdict,
    claudeResult.waitCondition,
    guards
  );

  let position = { shares: 0, capitalDeployed: 0, maxLoss: 0, maxProfit: 0 };
  if (verdict === VERDICTS.BUY) {
    const entry = claudeResult.entryZone?.high ?? stockData.suggestedEntry ?? 0;
    const sl = claudeResult.stopLoss ?? stockData.suggestedStopLoss ?? entry * 0.97;
    const t2 = claudeResult.target2 ?? stockData.suggestedTarget2 ?? entry * 1.06;
    // Market mode trims risk in CAUTION (×0.5) / MIXED narrow-rally (×0.7)
    const effectiveRiskPct = config.riskPercentage * sizeFactor;
    const sized = computePositionSize(entry, sl, config.capital, effectiveRiskPct);
    position = { ...sized, maxProfit: round2(sized.shares * (t2 - entry)) };
  }

  const { action, signal } = await saveSignal({
    claudeResult,
    stockData,
    gateResult,
    marketData,
    newsData,
    simons,
    verdict,
    waitCondition,
    position,
    gate7Result,
  });
  const decision = { symbol: stockData.symbol, verdict, confidence: claudeResult.confidence };
  if (action === 'duplicate') return decision;

  emitEvent(SOCKET_EVENTS.SIGNAL_NEW, signal.toObject ? signal.toObject() : signal);
  metrics.signalsSaved += 1;
  if (verdict === VERDICTS.BUY) {
    metrics.buySignals += 1;
    const notify = action === 'upgraded' ? sendWaitToBuyUpgrade : sendBuyAlert;
    notify(signal).catch((e) =>
      logger.error(`Notify failed for ${stockData.symbol}`, { error: e.message })
    );
  }
  return decision;
}

/**
 * Persist a per-cycle ScanResult snapshot: funnel counts + every analyzed stock with
 * its price, gates, score, verdict, and the stage it dropped out at. Never throws.
 *
 * @param {object} ctx - { health, funnel, evaluated, candidates, decisions, metrics, durationMs }
 * @returns {Promise<void>}
 */
async function persistScanResult({
  health,
  funnel,
  evaluated,
  candidates,
  decisions,
  metrics,
  durationMs,
}) {
  try {
    const selected = new Set(candidates.map((c) => c.symbol));
    const verdictBy = new Map((decisions ?? []).filter(Boolean).map((d) => [d.symbol, d]));

    const stocks = (evaluated ?? []).map((e) => {
      const passedGates = e.gatesPassed >= GATES_REQUIRED_FOR_CLAUDE && !e.hardBlockFired;
      const reachedClaude = selected.has(e.symbol);
      const d = verdictBy.get(e.symbol);
      let droppedAtStage = 'GATES';
      if (reachedClaude) droppedAtStage = d?.verdict === VERDICTS.BUY ? 'SIGNAL' : 'CLAUDE';
      else if (passedGates) droppedAtStage = 'RANKED_OUT';
      return {
        symbol: e.symbol,
        currentPrice: e.currentPrice,
        gatesPassed: e.gatesPassed,
        compositeScore: e.compositeScore,
        hardBlockFired: e.hardBlockFired,
        reachedClaude,
        verdict: d?.verdict ?? (reachedClaude ? null : 'SKIP'),
        confidence: d?.confidence ?? null,
        droppedAtStage,
      };
    });

    await ScanResult.create({
      marketMode: health.marketMode,
      adRatio: health.adRatio,
      niftyPrice: health.nifty50?.price,
      durationMs,
      funnel: {
        universe: funnel?.universe,
        screened: funnel?.screened,
        analyzed: funnel?.analyzed,
        gatePassed: funnel?.gatePassed,
        selected: funnel?.selected,
      },
      screenRejections: funnel?.screenRejections ?? {},
      signalsSaved: metrics.signalsSaved,
      buySignals: metrics.buySignals,
      claudeCalls: metrics.claudeCalls,
      totalCostInr: metrics.totalCostInr,
      errors: metrics.errors,
      stocks,
    });
    logger.info('ScanResult snapshot saved', { stocks: stocks.length });
  } catch (err) {
    logger.error('persistScanResult failed', { error: err.message });
  }
}

/**
 * Run one full scan cycle (JOB 1).
 *
 * @param {object} [opts]
 * @param {boolean} [opts.forceRun=false] - Bypass market-hours / scanner-enabled guards
 * @param {string[]|null} [opts.tiers] - Restrict screening to these index tiers (proof/testing)
 * @param {number} [opts.maxAnalyze] - Cap candidates sent to /analyze (proof/testing)
 * @returns {Promise<object>} Scan metrics
 */
export const runFullScan = async ({ forceRun = false, tiers, maxAnalyze } = {}) => {
  const start = Date.now();
  const metrics = {
    stocksScanned: 0,
    signalsSaved: 0,
    buySignals: 0,
    claudeCalls: 0,
    totalTokens: 0,
    totalCostInr: 0,
    errors: 0,
  };
  try {
    const config = await Config.findOne().lean();
    if (!config) {
      logger.warn('runFullScan: no Config — run db:seed first');
      return metrics;
    }
    if (!forceRun && !config.scannerEnabled) {
      logger.info('runFullScan: scanner disabled — skipping');
      return metrics;
    }
    if (!forceRun && !isMarketOpen()) {
      logger.info('runFullScan: outside market hours — skipping');
      return metrics;
    }

    const health = await getMarketHealth();
    emitEvent(SOCKET_EVENTS.MARKET_UPDATE, {
      ...toMarketData(health),
      marketMode: health.marketMode,
    });

    if (!health.allowTrading) {
      logger.warn('runFullScan: trading blocked — monitoring open trades only', {
        mode: health.marketMode,
        reason: health.reason,
      });
      await monitorOpenTrades().catch((e) =>
        logger.error('monitorOpenTrades failed', { error: e.message })
      );
      emitEvent(SOCKET_EVENTS.SCAN_COMPLETE, {
        ...metrics,
        durationMs: Date.now() - start,
        marketMode: health.marketMode,
        skipped: true,
        timestamp: new Date().toISOString(),
      });
      return metrics;
    }

    const marketData = toMarketData(health);
    const guards = await resolveGuards(config);
    const watchlistSymbols = (config.watchlist ?? []).map((w) => w.symbol);
    const { candidates, funnel, evaluated } = await runStockDiscovery({
      marketData,
      watchlistSymbols,
      capital: config.capital,
      riskPct: config.riskPercentage,
      ...(tiers ? { tiers } : {}),
      ...(maxAnalyze ? { maxAnalyze } : {}),
    });
    metrics.stocksScanned = candidates.length;

    const decisions = await runWithConcurrency(
      candidates,
      SCAN_CLAUDE_CONCURRENCY,
      async (candidate) => {
        try {
          return await processCandidate(
            candidate,
            marketData,
            config,
            guards,
            metrics,
            health.positionSizeFactor
          );
        } catch (err) {
          metrics.errors += 1;
          logger.error(`processCandidate failed for ${candidate.symbol}`, { error: err.message });
          return null;
        }
      }
    );

    await monitorOpenTrades().catch((e) =>
      logger.error('monitorOpenTrades failed', { error: e.message })
    );

    const durationMs = Date.now() - start;
    metrics.totalCostInr = round2(metrics.totalCostInr);
    await persistScanResult({
      health,
      funnel,
      evaluated,
      candidates,
      decisions,
      metrics,
      durationMs,
    });
    emitEvent(SOCKET_EVENTS.SCAN_COMPLETE, {
      ...metrics,
      durationMs,
      marketMode: health.marketMode,
      timestamp: new Date().toISOString(),
    });
    logger.info('Full scan complete', { ...metrics, durationMs });
    return metrics;
  } catch (err) {
    logger.error('runFullScan crashed', { error: err.message, stack: err.stack });
    return metrics;
  }
};
