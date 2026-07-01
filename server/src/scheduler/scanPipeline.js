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
  EOD_PREP_MAX_CANDIDATES,
  GATES_REQUIRED_FOR_CLAUDE,
  MARKET_CLOSE_HOUR,
  MARKET_CLOSE_MINUTE,
  MARKET_MODES,
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
import { getMarketSignals } from '../services/marketSignals.js';
import { runStockDiscovery } from '../services/stockDiscovery.js';
import { buildClaudePrompt, callClaudeAPI } from '../services/claudeEngine.js';
import { checkGate7 } from '../services/gateChecker.js';
import { saveSignal } from '../services/signalManager.js';
import { monitorOpenTrades, autoOpenPaperTrade } from '../services/tradeTracker.js';
import {
  sendBuyAlert,
  sendBearModeAlert,
  sendVixSpikeAlert,
  sendWaitToBuyUpgrade,
  sendWatchlistPrep,
} from '../services/notifier.js';
import { emitEvent, SOCKET_EVENTS } from '../socket/socketHandlers.js';
import * as scanState from '../services/scanState.js';
import { upsertStockStatuses } from '../services/stockMaster.js';

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
export function isTradingDay(ist = getNowIST()) {
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return false; // weekend
  if (NSE_HOLIDAYS.has(ist.toISOString().slice(0, 10))) return false; // NSE holiday (IST date)
  return true;
}

export function isMarketOpen(ist = getNowIST()) {
  if (!isTradingDay(ist)) return false;
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

  const gate7Result = checkGate7(claudeResult, marketData);
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
    let effectiveRiskPct = config.riskPercentage * sizeFactor;

    // NEW: Scale position size by Simons score confidence
    // High Simons = stronger setup = larger position
    const simonsScore = simons?.score ?? 50;
    const simonsMultiplier = simonsScore >= 85 ? 1.25 : simonsScore >= 75 ? 1.0 : 0.75;
    effectiveRiskPct *= simonsMultiplier;

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
    simonOverride: candidate.simonOverride ?? null,
  });
  const decision = { symbol: stockData.symbol, verdict, confidence: claudeResult.confidence };
  if (action === 'duplicate') return decision;

  emitEvent(SOCKET_EVENTS.SIGNAL_NEW, signal.toObject ? signal.toObject() : signal);
  metrics.signalsSaved += 1;
  scanState.recordSignal(verdict, stockData.symbol);
  if (verdict === VERDICTS.BUY) {
    metrics.buySignals += 1;
    const notify = action === 'upgraded' ? sendWaitToBuyUpgrade : sendBuyAlert;
    notify(signal).catch((e) =>
      logger.error(`Notify failed for ${stockData.symbol}`, { error: e.message })
    );
    // Auto-open a paper trade (opt-in + paper-mode only) so BUYs build a forward track
    // record for calibration. Fire-and-forget; it self-gates on guards and never blocks.
    autoOpenPaperTrade(signal.toObject ? signal.toObject() : signal, config).catch((e) =>
      logger.error(`autoOpenPaperTrade failed for ${stockData.symbol}`, { error: e.message })
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
  screenedOut,
  candidates,
  decisions,
  metrics,
  durationMs,
  scanType = 'LIVE',
  watchlist = [],
}) {
  try {
    const isPrep = scanType === 'EOD_PREP';
    const selected = new Set(candidates.map((c) => c.symbol));
    const verdictBy = new Map((decisions ?? []).filter(Boolean).map((d) => [d.symbol, d]));

    const analyzedStocks = (evaluated ?? []).map((e) => {
      const passedGates = e.gatesPassed >= GATES_REQUIRED_FOR_CLAUDE && !e.hardBlockFired;
      const isSelected = selected.has(e.symbol);
      const d = verdictBy.get(e.symbol);
      // EOD prep never calls Claude — gate-qualified picks become WATCH candidates.
      let droppedAtStage;
      if (isPrep) {
        droppedAtStage = isSelected ? 'WATCH' : passedGates ? 'RANKED_OUT' : 'GATES';
      } else if (isSelected) {
        droppedAtStage = d?.verdict === VERDICTS.BUY ? 'SIGNAL' : 'CLAUDE';
      } else {
        droppedAtStage = passedGates ? 'RANKED_OUT' : 'GATES';
      }
      return {
        symbol: e.symbol,
        currentPrice: e.currentPrice,
        gatesPassed: e.gatesPassed,
        compositeScore: e.compositeScore,
        hardBlockFired: e.hardBlockFired,
        reachedClaude: !isPrep && isSelected,
        verdict: isPrep ? (isSelected ? 'WATCH' : 'SKIP') : d?.verdict ?? (isSelected ? null : 'SKIP'),
        confidence: d?.confidence ?? null,
        droppedAtStage,
        reason: null,
      };
    });

    // Screened-out + analyze-capped stocks (never analyzed) — full per-symbol coverage
    const notAnalyzed = (screenedOut ?? []).map((s) => ({
      symbol: s.symbol,
      currentPrice: s.currentPrice,
      gatesPassed: null,
      compositeScore: null,
      hardBlockFired: false,
      reachedClaude: false,
      verdict: null,
      confidence: null,
      droppedAtStage: s.droppedAtStage,
      reason: s.reason,
    }));
    const stocks = [...analyzedStocks, ...notAnalyzed];

    // Persist the latest scan status into the durable Stock master (fire-and-forget) so
    // the Stocks catalog survives the ScanResult TTL and always reflects the last scan.
    upsertStockStatuses(stocks).catch((e) =>
      logger.error('upsertStockStatuses failed', { error: e.message })
    );

    await ScanResult.create({
      scanType,
      watchlist,
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

    scanState.startScan({ scanType: forceRun ? 'MANUAL' : 'LIVE' });

    const health = await getMarketHealth();

    // Bear-mode transition alert (only on first entry, not on every BEAR scan)
    const prevMode = config.marketMode;
    if (health.marketMode === MARKET_MODES.BEAR && prevMode !== MARKET_MODES.BEAR) {
      emitEvent(SOCKET_EVENTS.MARKET_BEARMODE, {
        marketMode: health.marketMode,
        timestamp: new Date().toISOString(),
      });
      sendBearModeAlert().catch((e) =>
        logger.error('sendBearModeAlert failed', { error: e.message })
      );
    }
    if ((health.vix ?? 0) > 20) {
      emitEvent(SOCKET_EVENTS.MARKET_VIXSPIKE, {
        vix: health.vix,
        timestamp: new Date().toISOString(),
      });
      sendVixSpikeAlert(health.vix).catch((e) =>
        logger.error('sendVixSpikeAlert failed', { error: e.message })
      );
    }
    // Persist market mode so the next scan can detect mode transitions
    Config.updateOne({}, { $set: { marketMode: health.marketMode } }).catch(() => {});

    // Emit flat shape so MarketStatusBar/MarketPulseStrip can read niftyPrice directly.
    // health.nifty50.dayChangePct is % change; derive absolute change from price + pct.
    const _n = health.nifty50 ?? {};
    const _niftyChange = _n.price != null && _n.dayChangePct != null
      ? round2(_n.price * _n.dayChangePct / (100 + _n.dayChangePct))
      : null;
    emitEvent(SOCKET_EVENTS.MARKET_UPDATE, {
      niftyPrice:     _n.price         ?? null,
      niftyChange:    _niftyChange,
      niftyChangePct: _n.dayChangePct   ?? null,
      bankNiftyPrice: health.bankNifty?.price ?? null,
      vix:            health.vix        ?? null,
      adRatio:        health.adRatio    ?? null,
      marketMode:     health.marketMode,
    });

    scanState.setPhase('discovery', health.marketMode);

    if (!health.allowTrading) {
      logger.warn('runFullScan: trading blocked — monitoring open trades only', {
        mode: health.marketMode,
        reason: health.reason,
      });
      scanState.setPhase('monitor', health.marketMode);
      await monitorOpenTrades().catch((e) =>
        logger.error('monitorOpenTrades failed', { error: e.message })
      );
      const durationMs = Date.now() - start;
      scanState.endScan({ ...metrics, durationMs, marketMode: health.marketMode });
      emitEvent(SOCKET_EVENTS.SCAN_COMPLETE, {
        ...metrics,
        durationMs,
        marketMode: health.marketMode,
        skipped: true,
        timestamp: new Date().toISOString(),
      });
      return metrics;
    }

    const marketData = toMarketData(health);
    // Inject market-regime signals (FII flow, P/C ratio, sector ranking) so the
    // composite score (FII +8, P/C +5) and Claude prompt reflect the current regime.
    const signals = await getMarketSignals();
    marketData.fiiTrend = signals.fiiTrend;
    marketData.pcRatio = signals.pcRatio;
    marketData.topSectors = signals.topSectors;
    marketData.bottomSectors = signals.bottomSectors;

    const guards = await resolveGuards(config);
    const watchlistSymbols = (config.watchlist ?? []).map((w) => w.symbol);
    // Drive the live progress bar through the (long) discovery phase: phase notes during
    // screening/analysis, then a per-stock tick as each survivor is scored through the gates.
    const onProgress = {
      phase: (note) => scanState.setPhase('discovery', health.marketMode, note),
      begin: (total, note) => scanState.beginPhase('analysis', total, note),
      tick: (symbol) => scanState.tick(symbol),
    };
    const { candidates, funnel, evaluated, screenedOut } = await runStockDiscovery({
      marketData,
      watchlistSymbols,
      capital: config.capital,
      riskPct: config.riskPercentage,
      onProgress,
      ...(tiers ? { tiers } : {}),
      ...(maxAnalyze ? { maxAnalyze } : {}),
    });
    metrics.stocksScanned = candidates.length;
    // Claude runs on the top picks only — its own counted phase so the bar refills 0→100%.
    scanState.beginPhase('claude', candidates.length, `Running AI analysis on top ${candidates.length} pick(s)…`);

    const decisions = await runWithConcurrency(
      candidates,
      SCAN_CLAUDE_CONCURRENCY,
      async (candidate) => {
        try {
          const decision = await processCandidate(
            candidate,
            marketData,
            config,
            guards,
            metrics,
            health.positionSizeFactor
          );
          scanState.tick(candidate.symbol);
          return decision;
        } catch (err) {
          metrics.errors += 1;
          scanState.recordError(candidate.symbol, err.message);
          scanState.tick(candidate.symbol);
          logger.error(`processCandidate failed for ${candidate.symbol}`, { error: err.message });
          return null;
        }
      }
    );

    scanState.setPhase('monitor', health.marketMode);
    await monitorOpenTrades().catch((e) =>
      logger.error('monitorOpenTrades failed', { error: e.message })
    );

    const durationMs = Date.now() - start;
    metrics.totalCostInr = round2(metrics.totalCostInr);
    await persistScanResult({
      health,
      funnel,
      evaluated,
      screenedOut,
      candidates,
      decisions,
      metrics,
      durationMs,
    });
    scanState.endScan({
      signalsFound: metrics.signalsSaved,
      buySignals: metrics.buySignals,
      errors: metrics.errors,
      durationMs,
      marketMode: health.marketMode,
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
    scanState.endScan({ error: err.message, durationMs: Date.now() - start });
    logger.error('runFullScan crashed', { error: err.message, stack: err.stack });
    return metrics;
  }
};

/**
 * EOD prep scan (JOB 11). Runs after the close on a trading day to build the
 * NEXT SESSION's watchlist from the daily-close data. It reuses the live discovery +
 * gate + composite-score pipeline, but deliberately does NOT call Claude, save tradeable
 * BUY signals, or fire BUY alerts — overnight signals would be stale and expire same-day.
 * Output is a ranked shortlist of gate-qualified candidates to confirm live at the open,
 * persisted as a ScanResult (scanType EOD_PREP) and pushed as a single watchlist alert.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.forceRun=false] - Bypass scanner-enabled / trading-day guards
 * @returns {Promise<{ candidates: number }>}
 */
export const runEodPrep = async ({ forceRun = false } = {}) => {
  const start = Date.now();
  try {
    const config = await Config.findOne().lean();
    if (!config) {
      logger.warn('runEodPrep: no Config — run db:seed first');
      return { candidates: 0 };
    }
    if (!forceRun && !config.scannerEnabled) {
      logger.info('runEodPrep: scanner disabled — skipping');
      return { candidates: 0 };
    }
    if (!forceRun && !isTradingDay()) {
      logger.info('runEodPrep: not a trading day — skipping');
      return { candidates: 0 };
    }

    const health = await getMarketHealth();
    const marketData = toMarketData(health);
    const signals = await getMarketSignals();
    marketData.fiiTrend = signals.fiiTrend;
    marketData.pcRatio = signals.pcRatio;
    marketData.topSectors = signals.topSectors;
    marketData.bottomSectors = signals.bottomSectors;

    const watchlistSymbols = (config.watchlist ?? []).map((w) => w.symbol);
    const { candidates, funnel, evaluated, screenedOut } = await runStockDiscovery({
      marketData,
      watchlistSymbols,
      capital: config.capital,
      riskPct: config.riskPercentage,
    });

    const watchlist = candidates
      .map((c) => {
        const sd = c.stockData ?? {};
        const g = c.gateResult ?? {};
        const entry = sd.suggestedEntry;
        const sl = sd.suggestedStopLoss;
        const t2 = sd.suggestedTarget2;
        const rr = entry && sl && t2 && entry > sl ? round2((t2 - entry) / (entry - sl)) : null;
        return {
          symbol: c.symbol,
          currentPrice: sd.currentPrice,
          compositeScore: g.compositeScore,
          gatesPassed: g.gatesPassed,
          scoreConfidence: g.scoreConfidence,
          sector: sd.sector ?? null,
          rsi: sd.indicators?.rsi14 ?? null,
          suggestedEntry: entry,
          suggestedStopLoss: sl,
          suggestedTarget1: sd.suggestedTarget1,
          suggestedTarget2: t2,
          riskReward: rr,
        };
      })
      .sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0))
      .slice(0, EOD_PREP_MAX_CANDIDATES);

    const durationMs = Date.now() - start;
    await persistScanResult({
      health,
      funnel,
      evaluated,
      screenedOut,
      candidates,
      decisions: [],
      metrics: { signalsSaved: 0, buySignals: 0, claudeCalls: 0, totalCostInr: 0, errors: 0 },
      durationMs,
      scanType: 'EOD_PREP',
      watchlist,
    });

    await sendWatchlistPrep({
      dateStr: getNowIST().toISOString().slice(0, 10),
      marketMode: health.marketMode,
      candidates: watchlist,
    }).catch((e) => logger.error('sendWatchlistPrep failed', { error: e.message }));

    emitEvent(SOCKET_EVENTS.SCAN_COMPLETE, {
      scanType: 'EOD_PREP',
      watchlistCount: watchlist.length,
      marketMode: health.marketMode,
      durationMs,
      timestamp: new Date().toISOString(),
    });
    logger.info('EOD prep complete', { candidates: watchlist.length, durationMs });
    return { candidates: watchlist.length };
  } catch (err) {
    logger.error('runEodPrep crashed', { error: err.message, stack: err.stack });
    return { candidates: 0 };
  }
};
