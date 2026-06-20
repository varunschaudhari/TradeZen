/**
 * @file marketScanner.js
 * @description 15-minute cron scan cycle — fetches market/stock data, runs 8 gates,
 *              calls Claude, enforces capital rules, saves signals, emits socket events
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-14
 */

import cron from 'node-cron';
import Signal from '../models/Signal.js';
import Trade from '../models/Trade.js';
import Config from '../models/Config.js';
import { logger } from '../config/logger.js';
import {
  DAILY_LOSS_PAUSE_PCT,
  DEDUPLICATION_HOURS,
  MARKET_CLOSE_HOUR,
  MARKET_CLOSE_MINUTE,
  MARKET_MODES,
  MARKET_OPEN_HOUR,
  MARKET_OPEN_MINUTE,
  MAX_CANDIDATES_TO_ANALYZE,
  MAX_CAPITAL_DEPLOYED_PCT,
  MAX_OPEN_TRADES,
  SCREEN_ENABLED,
  SCREEN_TIERS,
  SL_WARNING_PCT,
  VERDICTS,
} from '../config/constants.js';
import { analyzeStocks, fetchMarketData, screenUniverse } from '../services/pythonBridge.js';
import { runAllGates, checkGate7 } from '../services/gateChecker.js';
import { buildClaudePrompt, callClaudeAPI } from '../services/claudeEngine.js';
import { fetchNewsAndSentiment } from '../services/newsFetcher.js';
import { sendBuyAlert, sendBearModeAlert, sendSlWarning, sendVixSpikeAlert } from '../services/notifier.js';
import { emitEvent, SOCKET_EVENTS } from '../socket/socketHandlers.js';

// ── IST time helpers ─────────────────────────────────────────────────────────
// Returns a Date whose UTC fields read as IST time (UTC+5:30).
// Use getUTCHours() / getUTCDay() on the result to get IST hour / weekday.
function getNowIST() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

function isMarketOpen() {
  const ist = getNowIST();
  const day = ist.getUTCDay(); // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return false;
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const OPEN = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE;   // 9:15 AM IST
  const CLOSE = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MINUTE; // 3:30 PM IST
  return mins >= OPEN && mins <= CLOSE;
}

function getSignalExpiry(verdict) {
  const now = new Date();
  if (verdict === VERDICTS.BUY) {
    // Expire at today's close: 3:30 PM IST = 10:00 AM UTC
    const expiry = new Date(now);
    expiry.setUTCHours(10, 0, 0, 0);
    if (expiry <= now) expiry.setDate(expiry.getDate() + 1); // already past close
    return expiry;
  }
  // WAIT signals expire in 3 days
  return new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
}

// ── Market mode ──────────────────────────────────────────────────────────────
function determineMarketMode(marketData) {
  const nifty = marketData?.nifty50;
  if (!nifty || !nifty.aboveEma20) return MARKET_MODES.BEAR;
  if ((marketData?.vix ?? 0) > 20 || (marketData?.adRatio ?? 0.5) < 0.4) {
    return MARKET_MODES.CAUTION;
  }
  return MARKET_MODES.BULL;
}

// ── Position sizing ──────────────────────────────────────────────────────────
// riskPct: percentage of capital to risk per trade (e.g. 1 = 1%)
// Shares = floor(maxRisk / riskPerShare).  Never risk more than riskPct of capital.
function computePositionSize(entry, stopLoss, capital, riskPct) {
  const maxRisk = capital * (riskPct / 100);
  const riskPerShare = Math.max(entry - stopLoss, 0.01);
  const shares = Math.max(Math.floor(maxRisk / riskPerShare), 0);
  return {
    shares,
    capitalDeployed: Math.round(shares * entry * 100) / 100,
    maxLoss: Math.round(shares * riskPerShare * 100) / 100,
  };
}

// ── Daily loss guard ─────────────────────────────────────────────────────────
async function isDailyLossPaused(capital) {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const lossTrades = await Trade.find({
    status: 'CLOSED',
    exitDate: { $gte: todayStart },
    realizedPnl: { $lt: 0 },
  }).lean();

  const totalLoss = lossTrades.reduce((s, t) => s + (t.realizedPnl ?? 0), 0);
  const threshold = -(capital * (DAILY_LOSS_PAUSE_PCT / 100));

  if (totalLoss <= threshold) {
    logger.warn('Daily loss limit reached — BUY signals paused for the day', {
      totalLossInr: Math.round(totalLoss),
      thresholdInr: Math.round(threshold),
    });
    return true;
  }
  return false;
}

// ── Universe screening (Step 2) ────────────────────────────────────────────────
/**
 * Screen the static NSE universe down to candidate symbols for the heavy pipeline.
 *
 * Watchlist symbols are passed as an overlay (always screened) AND unioned back in
 * afterwards, so a manually-added stock is always analyzed even if it fails a filter.
 * Survivors are capped at MAX_CANDIDATES_TO_ANALYZE (they arrive momentum-ranked).
 * On any screen failure the scan degrades gracefully to the watchlist alone.
 *
 * @param {string[]} watchlistSymbols - Bare NSE symbols from Config.watchlist
 * @returns {Promise<string[]>} Deduplicated candidate symbols to analyze
 */
async function screenCandidates(watchlistSymbols) {
  try {
    const screen = await screenUniverse({ tiers: SCREEN_TIERS, extraSymbols: watchlistSymbols });
    const ranked = (screen.candidates ?? [])
      .slice(0, MAX_CANDIDATES_TO_ANALYZE)
      .map((candidate) => candidate.symbol);
    logger.info('Universe screen complete', {
      universeCount: screen.universeCount,
      screenedCount: screen.screenedCount,
      candidateCount: screen.candidateCount,
      analyzing: ranked.length,
      rejections: screen.rejectionCounts,
    });
    return [...new Set([...ranked, ...watchlistSymbols])];
  } catch (err) {
    logger.error('Universe screen failed — falling back to watchlist', { error: err.message });
    return watchlistSymbols;
  }
}

// ── Main scan cycle ──────────────────────────────────────────────────────────
/**
 * Run one full market scan cycle.
 *
 * Flow:
 *  1. Load config + check scanner enabled + market hours
 *  2. Fetch live market data (Nifty, VIX, A/D) from Python service
 *  3. Determine market mode, emit market:update
 *  4. Daily loss check + open-trade capacity check
 *  5. Batch-fetch stock analysis from Python for all watchlist symbols
 *  6. Per stock: news → gates → Claude → save signal → emit signal:new → notify
 *  7. Emit scan:complete with metrics
 *
 * Failures are isolated per stock — one bad symbol does not abort the scan.
 *
 * @returns {Promise<void>}
 */
/**
 * @param {object}   [opts]
 * @param {boolean}  [opts.forceRun=false]       - Skip market-hours and scanner-enabled guards (test/manual use)
 * @param {string[]} [opts.overrideSymbols=null]  - Use these symbols instead of the watchlist
 */
export const runScanCycle = async ({ forceRun = false, overrideSymbols = null } = {}) => {
  const startTime = Date.now();
  logger.info('Market scan cycle started', { forceRun, overrideSymbols });

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
    // ── 1. Config ────────────────────────────────────────────────────────────
    let config = await Config.findOne().lean();
    if (!config) {
      if (!forceRun) {
        logger.warn('No Config document — scan aborted (run db:seed first)');
        return;
      }
      // forceRun mode: use safe in-memory defaults so test scripts work without seeding
      config = {
        capital: 1_000_000,
        riskPercentage: 1,
        maxOpenTrades: 3,
        maxCapitalDeployedPct: 60,
        watchlist: [],
        scannerEnabled: true,
        paperTradeMode: true,
        marketMode: MARKET_MODES.BULL,
      };
      logger.warn('No Config document — using in-memory defaults for force-run');
    }
    if (!forceRun && !config.scannerEnabled) {
      logger.info('Scanner disabled in config — skipping cycle');
      return;
    }

    // ── 2. Market hours ──────────────────────────────────────────────────────
    if (!forceRun && !isMarketOpen()) {
      logger.info('Outside market hours (9:15–15:30 IST weekdays) — scan skipped');
      return;
    }

    // ── 3. Market data ───────────────────────────────────────────────────────
    let marketData;
    try {
      marketData = await fetchMarketData();
    } catch (err) {
      logger.error('Market data unavailable — scan aborted', { error: err.message });
      return;
    }

    const marketMode = determineMarketMode(marketData);
    const prevMode = config.marketMode;

    if (marketMode === MARKET_MODES.BEAR && prevMode !== MARKET_MODES.BEAR) {
      emitEvent(SOCKET_EVENTS.MARKET_BEARMODE, { marketMode, timestamp: new Date().toISOString() });
      sendBearModeAlert().catch((e) =>
        logger.error('sendBearModeAlert failed', { error: e.message })
      );
    }

    if ((marketData?.vix ?? 0) > 20) {
      emitEvent(SOCKET_EVENTS.MARKET_VIXSPIKE, { vix: marketData.vix, timestamp: new Date().toISOString() });
      sendVixSpikeAlert(marketData.vix).catch((e) =>
        logger.error('sendVixSpikeAlert failed', { error: e.message })
      );
    }

    emitEvent(SOCKET_EVENTS.MARKET_UPDATE, { ...marketData, marketMode });
    Config.updateOne({}, { $set: { marketMode } }).catch(() => {});

    // ── 4. Capital & loss guards ─────────────────────────────────────────────
    const lossLimitHit = await isDailyLossPaused(config.capital);

    const openTrades = await Trade.find({ status: 'OPEN' }).lean();
    const openTradesCount = openTrades.length;
    const totalDeployed = openTrades.reduce((s, t) => s + (t.capitalDeployed ?? 0), 0);
    const maxDeployable = config.capital * (MAX_CAPITAL_DEPLOYED_PCT / 100);
    const tradesAtMax = openTradesCount >= MAX_OPEN_TRADES;
    const capitalExhausted = totalDeployed >= maxDeployable;

    // ── 5. Build candidate symbol list ───────────────────────────────────────
    // Priority: explicit overrideSymbols (test/manual) → universe screen → watchlist.
    // In BEAR mode Gate 1 hard-blocks every BUY, so skip the expensive universe
    // screen and fall back to the watchlist (keeps open-trade monitoring running).
    const watchlistSymbols = (config.watchlist ?? []).map((w) => w.symbol);
    let symbols;

    if (overrideSymbols) {
      // Strip .NS suffix and uppercase (test scripts may pass full ticker names)
      symbols = overrideSymbols.map((s) => s.replace(/\.NS$/i, '').toUpperCase());
    } else if (SCREEN_ENABLED && marketMode !== MARKET_MODES.BEAR) {
      symbols = await screenCandidates(watchlistSymbols);
    } else {
      symbols = watchlistSymbols;
    }

    if (!symbols.length) {
      logger.info(
        overrideSymbols ? 'overrideSymbols is empty — nothing to scan' : 'No candidates after screen/watchlist — nothing to scan'
      );
      return;
    }

    let pythonResponse;
    try {
      pythonResponse = await analyzeStocks(symbols, config.capital, config.riskPercentage);
    } catch (err) {
      logger.error('Python analyzeStocks failed — scan aborted', { error: err.message });
      return;
    }

    const stockResults = pythonResponse?.results ?? [];
    metrics.stocksScanned = stockResults.length;

    // ── 6. Per-stock loop ────────────────────────────────────────────────────
    for (const stockData of stockResults) {
      if (stockData.error) {
        logger.warn(`Skip ${stockData.symbol} — Python analysis error: ${stockData.error}`);
        metrics.errors++;
        continue;
      }

      const symbol = stockData.symbol;
      try {
        // 6a. News (Gate 8 input)
        const newsData = await fetchNewsAndSentiment(symbol);

        // 6a-ii. SL proximity check for any open trades on this symbol
        const currentPrice = stockData.currentPrice; // Python schema field is currentPrice, not price
        if (currentPrice) {
          const tradesForSymbol = openTrades.filter((t) => t.symbol === symbol);
          for (const trade of tradesForSymbol) {
            if (!trade.stopLoss) continue;
            const distancePct = ((currentPrice - trade.stopLoss) / trade.stopLoss) * 100;
            if (distancePct >= 0 && distancePct <= SL_WARNING_PCT) {
              const unrealizedPnl = (currentPrice - trade.entryPrice) * trade.shares;
              const unrealizedPnlPct =
                trade.capitalDeployed > 0 ? (unrealizedPnl / trade.capitalDeployed) * 100 : 0;
              emitEvent(SOCKET_EVENTS.TRADE_SL_WARNING, {
                tradeId: trade._id,
                symbol,
                currentPrice,
                stopLoss: trade.stopLoss,
                distancePct: Math.round(distancePct * 100) / 100,
              });
              sendSlWarning({ ...trade, currentPrice, unrealizedPnl, unrealizedPnlPct }).catch(
                (e) => logger.error(`sendSlWarning failed for ${symbol}`, { error: e.message })
              );
            }
          }
        }

        // 6b. Pre-Claude gates (1-6, 8) — keep the full result for the Claude prompt
        const gateResult = runAllGates(stockData, marketData, newsData);
        const { gatesPassed, gateDetails, shouldCallClaude } = gateResult;

        // 6c. Claude call
        let claudeResult = null;
        let gate7Result = { passed: false, reason: 'Claude not called — gates insufficient' };

        if (shouldCallClaude) {
          try {
            const prompt = buildClaudePrompt(
              stockData,
              marketData,
              newsData,
              gateResult,
              config.capital
            );
            claudeResult = await callClaudeAPI(prompt);
            gate7Result = checkGate7(claudeResult);
            metrics.claudeCalls++;
            metrics.totalTokens += claudeResult.tokensUsed ?? 0;
            metrics.totalCostInr += claudeResult.costInr ?? 0;
          } catch (err) {
            logger.error(`Claude failed for ${symbol}`, { error: err.message });
            gate7Result = { passed: false, reason: `Claude API error: ${err.message}` };
            metrics.errors++;
          }
        }

        // Only persist signals that went through Claude
        if (!claudeResult) continue;

        // 6d. Effective verdict (capital rules can downgrade BUY → WAIT)
        let verdict = claudeResult.verdict;
        let waitCondition = claudeResult.waitCondition ?? null;

        if (verdict === VERDICTS.BUY) {
          if (lossLimitHit) {
            verdict = VERDICTS.WAIT;
            waitCondition = `Daily loss limit (${DAILY_LOSS_PAUSE_PCT}% of capital) reached — resuming next session`;
          } else if (tradesAtMax) {
            verdict = VERDICTS.WAIT;
            waitCondition = `${MAX_OPEN_TRADES} simultaneous positions open — wait for one to close`;
          } else if (capitalExhausted) {
            verdict = VERDICTS.WAIT;
            waitCondition = `${MAX_CAPITAL_DEPLOYED_PCT}% capital deployed — no capacity for new position`;
          }
        }

        // 6e. Deduplication — skip if BUY already emitted for this symbol within 4 hours
        if (verdict === VERDICTS.BUY) {
          const recent = await Signal.exists({
            symbol,
            verdict: VERDICTS.BUY,
            createdAt: { $gte: new Date(Date.now() - DEDUPLICATION_HOURS * 3_600_000) },
          });
          if (recent) {
            logger.info(`Dedup skip: ${symbol} BUY already sent within ${DEDUPLICATION_HOURS}h`);
            continue;
          }
        }

        // 6f. Position sizing
        let shares = 0, capitalDeployed = 0, maxLoss = 0, maxProfit = 0;
        if (verdict === VERDICTS.BUY) {
          const entry = claudeResult.entryZone?.high ?? stockData.suggestedEntry ?? 0;
          const sl = claudeResult.stopLoss ?? stockData.suggestedStopLoss ?? entry * 0.97;
          const t2 = claudeResult.target2 ?? stockData.suggestedTarget2 ?? entry * 1.06;
          ({ shares, capitalDeployed, maxLoss } = computePositionSize(
            entry, sl, config.capital, config.riskPercentage
          ));
          maxProfit = Math.round(shares * (t2 - entry) * 100) / 100;
        }

        // 6g. Save signal
        const gateDetailsWithG7 = { ...gateDetails, gate7: gate7Result };
        const totalGatesPassed = gatesPassed + (gate7Result.passed ? 1 : 0);

        const signal = await Signal.create({
          symbol,
          verdict,
          confidence: claudeResult.confidence,
          entryZone: claudeResult.entryZone,
          stopLoss: claudeResult.stopLoss ?? stockData.suggestedStopLoss,
          target1: claudeResult.target1 ?? stockData.suggestedTarget1,
          target2: claudeResult.target2 ?? stockData.suggestedTarget2,
          riskReward: claudeResult.riskReward,
          shares,
          capitalDeployed,
          maxLoss,
          maxProfit,
          signalValidTill: getSignalExpiry(verdict),
          waitCondition,
          skipReason: claudeResult.skipReason ?? null,
          reasoning: claudeResult.reasoning,
          keyRisks: claudeResult.keyRisks ?? [],
          entryTrigger: claudeResult.entryTrigger ?? null,
          gatesPassed: totalGatesPassed,
          gateDetails: gateDetailsWithG7,
          indicators: {
            ema20: stockData.indicators?.ema20,
            ema50: stockData.indicators?.ema50,
            ema200: stockData.indicators?.ema200,
            rsi: stockData.indicators?.rsi14,
            macd: stockData.indicators?.macd,
            macdSignal: stockData.indicators?.macdSignal,
            volRatio: stockData.indicators?.volRatio,
            atr: stockData.indicators?.atr14,
            bollingerB: stockData.indicators?.bbPctB,
          },
          marketContext: {
            niftyPrice: marketData?.nifty50?.price,
            vix: marketData?.vix,
            marketMode,
            adRatio: marketData?.adRatio,
          },
          newsSentiment: newsData.sentiment,
          newsHeadlines: newsData.headlines,
          isActive: verdict === VERDICTS.BUY || verdict === VERDICTS.WAIT,
          claudeTokensUsed: claudeResult.tokensUsed ?? 0,
          claudeCostInr: claudeResult.costInr ?? 0,
        });

        metrics.signalsSaved++;
        if (verdict === VERDICTS.BUY) metrics.buySignals++;

        // 6h. Emit to dashboard
        emitEvent(SOCKET_EVENTS.SIGNAL_NEW, signal.toObject());

        // 6i. Notify (implementation in STEP 6)
        if (verdict === VERDICTS.BUY) {
          sendBuyAlert(signal).catch((e) =>
            logger.error(`sendBuyAlert failed for ${symbol}`, { error: e.message })
          );
        }
      } catch (stockErr) {
        logger.error(`Unhandled error for ${symbol}`, {
          error: stockErr.message,
          stack: stockErr.stack,
        });
        metrics.errors++;
      }
    }

    // ── 7. Scan complete ─────────────────────────────────────────────────────
    const durationMs = Date.now() - startTime;
    metrics.totalCostInr = Math.round(metrics.totalCostInr * 10_000) / 10_000;

    logger.info('Market scan complete', { ...metrics, durationMs });
    emitEvent(SOCKET_EVENTS.SCAN_COMPLETE, {
      ...metrics,
      durationMs,
      marketMode,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Market scan cycle crashed', { error: err.message, stack: err.stack });
  }
};

// ── Cron registration ────────────────────────────────────────────────────────
/**
 * Register the 15-minute market scanner cron job.
 * Call this once after MongoDB connects (from app.js startServer).
 */
export const startMarketScanner = () => {
  const interval = parseInt(process.env.SCAN_INTERVAL_MINUTES ?? '15', 10);
  // Explicitly pass empty options so future signature changes don't break cron invocations
  cron.schedule(`*/${interval} * * * *`, () => runScanCycle());
  logger.info(`Market scanner scheduled every ${interval} min (market hours only)`);
};
