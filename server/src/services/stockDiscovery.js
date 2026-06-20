/**
 * @file stockDiscovery.js
 * @description Flow 2 — the 8-stage discovery funnel (350 NSE stocks → ~15 candidates).
 *
 * Stages 1–6 (liquidity, market-cap tier, long-term trend, momentum, ATR, earnings)
 * run inside the Python /screen endpoint (screener.py) for efficiency — that avoids
 * shipping 350 stocks' OHLCV into Node. This service orchestrates the rest:
 *   Stage 1–6  → screenUniverse() (Python)
 *   (analyze)  → full StockAnalysis for survivors
 *   (enrich)   → Simons signals + news merged into each stock
 *   Stage 7    → runAllGates(); keep gatesPassed ≥ 5 and no hard block
 *   rank/cap   → top MAX_CLAUDE_CALLS_PER_SCAN by composite score
 *   Stage 8    → Claude (performed by the caller on the returned candidates)
 *
 * @author TradeZen Team
 * @created 2026-06-20
 * @lastModified 2026-06-20
 */

import {
  DISCOVERY_CONCURRENCY,
  GATES_REQUIRED_FOR_CLAUDE,
  MARKET_MODES,
  MAX_CANDIDATES_TO_ANALYZE,
  MAX_CLAUDE_CALLS_PER_SCAN,
  SCREEN_TIERS,
} from '../config/constants.js';
import { logger } from '../config/logger.js';
import { analyzeStocks, fetchMarketData, screenUniverse } from './pythonBridge.js';
import { fetchNewsAndSentiment } from './newsFetcher.js';
import { calculateSimonsSignals, fetchSymbolHistory } from './simonsSignals.js';
import { runAllGates } from './gateChecker.js';
import { determineMarketMode } from './marketHealthService.js';

/**
 * Run async `fn` over `items` with a bounded number of concurrent workers.
 * Failed tasks resolve to null and are filtered out.
 *
 * @param {any[]} items - Work items
 * @param {number} limit - Max concurrent workers
 * @param {(item:any)=>Promise<any>} fn - Async task
 * @returns {Promise<any[]>} Successful results (nulls removed)
 */
async function mapWithConcurrency(items, limit, fn) {
  const results = [];
  let cursor = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      try {
        results[idx] = await fn(items[idx]);
      } catch (err) {
        logger.error('Discovery task failed', { error: err.message });
        results[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return results.filter(Boolean);
}

/**
 * Enrich one analyzed stock with news + Simons signals, then run the 8 gates.
 *
 * @param {object} stockData - StockAnalysis from Python /analyze
 * @param {object} marketData - Market snapshot
 * @param {number[]|null} niftyCloses - Nifty daily closes for relative strength
 * @returns {Promise<{ symbol:string, stockData:object, newsData:object, simons:object, gateResult:object }>}
 */
export async function enrichAndGate(stockData, marketData, niftyCloses) {
  const symbol = stockData.symbol;
  const [newsData, history] = await Promise.all([
    fetchNewsAndSentiment(symbol),
    fetchSymbolHistory(symbol),
  ]);
  const simons = calculateSimonsSignals({
    indicators: stockData.indicators,
    currentPrice: stockData.currentPrice,
    high52w: stockData.high52w,
    closes: history?.closes,
    highs: history?.highs,
    lows: history?.lows,
    volumes: history?.volumes,
    niftyCloses,
    external: {},
  });
  const enriched = { ...stockData, ...simons.enrichment };
  const gateResult = runAllGates(enriched, marketData, newsData);
  return { symbol, stockData: enriched, newsData, simons, gateResult };
}

/**
 * Stage 7 selection: keep stocks that pass ≥ GATES_REQUIRED_FOR_CLAUDE without a hard
 * block, rank by composite score, and cap to `claudeCap` (the stage-8 budget).
 *
 * @param {object[]} gated - Output of enrichAndGate per candidate
 * @param {number} claudeCap - Max candidates to forward to Claude
 * @returns {object[]} Ranked, capped candidate list
 */
export function selectTopCandidates(gated, claudeCap) {
  return gated
    .filter(
      (c) => c.gateResult.gatesPassed >= GATES_REQUIRED_FOR_CLAUDE && !c.gateResult.hardBlockFired
    )
    .sort((a, b) => b.gateResult.compositeScore - a.gateResult.compositeScore)
    .slice(0, claudeCap);
}

/**
 * Run the full discovery funnel and return the candidates ready for Claude.
 *
 * @param {object} [opts]
 * @param {object}   [opts.marketData]        - Market snapshot (fetched if omitted)
 * @param {string[]} [opts.watchlistSymbols]  - Watchlist overlay (always screened)
 * @param {number[]} [opts.niftyCloses]       - Nifty daily closes (enables relative strength)
 * @param {number}   [opts.capital]           - Capital for analyze/position sizing
 * @param {number}   [opts.riskPct]           - Risk % for analyze
 * @param {string[]|null} [opts.tiers]        - Index tiers to screen (default all)
 * @param {number}   [opts.maxAnalyze]        - Cap survivors sent to /analyze
 * @param {number}   [opts.claudeCap]         - Cap candidates returned for Claude
 * @returns {Promise<{ candidates: object[], funnel: object }>}
 */
export const runStockDiscovery = async (opts = {}) => {
  const {
    watchlistSymbols = [],
    niftyCloses = null,
    capital = 1_000_000,
    riskPct = 1,
    tiers = SCREEN_TIERS,
    maxAnalyze = MAX_CANDIDATES_TO_ANALYZE,
    claudeCap = MAX_CLAUDE_CALLS_PER_SCAN,
  } = opts;
  const marketData = opts.marketData ?? (await fetchMarketData());
  const funnel = {};

  // Stages 1–6 (Python screen)
  const screen = await screenUniverse({ tiers, extraSymbols: watchlistSymbols });
  funnel.universe = screen.universeCount;
  funnel.screened = screen.candidateCount;
  funnel.screenRejections = screen.rejectionCounts;
  const symbols = (screen.candidates ?? []).slice(0, maxAnalyze).map((c) => c.symbol);
  if (!symbols.length) {
    logger.info('Discovery: no candidates after screen', { funnel });
    return { candidates: [], funnel };
  }

  // Full analysis for survivors
  const analysis = await analyzeStocks(symbols, capital, riskPct);
  const valid = (analysis.results ?? []).filter((r) => !r.error);
  funnel.analyzed = valid.length;

  // Enrich (news + Simons) and run Stage 7 gates with bounded concurrency
  const gated = await mapWithConcurrency(valid, DISCOVERY_CONCURRENCY, (stock) =>
    enrichAndGate(stock, marketData, niftyCloses)
  );
  funnel.gatePassed = gated.filter(
    (c) => c.gateResult.gatesPassed >= GATES_REQUIRED_FOR_CLAUDE && !c.gateResult.hardBlockFired
  ).length;

  // Stage 7 selection → Stage 8 budget
  const candidates = selectTopCandidates(gated, claudeCap);
  funnel.selected = candidates.length;

  // Compact per-stock record of everything analyzed (for the scan snapshot/visibility)
  const evaluated = gated.map((c) => ({
    symbol: c.symbol,
    currentPrice: c.stockData.currentPrice,
    gatesPassed: c.gateResult.gatesPassed,
    compositeScore: c.gateResult.compositeScore,
    hardBlockFired: c.gateResult.hardBlockFired,
    shouldCallClaude: c.gateResult.shouldCallClaude,
  }));

  logger.info('Stock discovery complete', { funnel, marketMode: marketData?.marketMode });
  return { candidates, funnel, marketData, evaluated };
};

/**
 * Evaluate an explicit symbol list through analyze → enrich → 8 gates (no screening,
 * no Claude). Shared by the /api/signals/test and /api/scanner/run routes; the caller
 * runs Claude on the candidates whose gateResult.shouldCallClaude is true.
 *
 * @param {string[]} symbols - NSE symbols to evaluate
 * @param {object} [opts] - { marketData, capital, riskPct, niftyCloses }
 * @returns {Promise<{ marketData: object, candidates: object[] }>}
 *          candidates: { symbol, stockData, newsData, simons, gateResult } | { symbol, error }
 */
export const evaluateSymbols = async (symbols, opts = {}) => {
  const rawMarket = opts.marketData ?? (await fetchMarketData());
  // Classify market mode (pure, no side effects) so MIXED/narrow-rally surfaces here too.
  const classified = determineMarketMode({
    niftyPrice: rawMarket?.nifty50?.price,
    niftyEma20: rawMarket?.nifty50?.ema20,
    vix: rawMarket?.vix,
    adRatio: rawMarket?.adRatio,
  });
  const marketData = {
    ...rawMarket,
    marketMode: classified.mode,
    narrowMarket: classified.mode === MARKET_MODES.MIXED,
  };
  const capital = opts.capital ?? 1_000_000;
  const riskPct = opts.riskPct ?? 1;
  const analysis = await analyzeStocks(symbols, capital, riskPct);

  const candidates = [];
  for (const stock of analysis.results ?? []) {
    if (stock.error) {
      candidates.push({ symbol: stock.symbol, error: stock.error });
      continue;
    }
    try {
      candidates.push(await enrichAndGate(stock, marketData, opts.niftyCloses ?? null));
    } catch (err) {
      candidates.push({ symbol: stock.symbol, error: err.message });
    }
  }
  return { marketData, candidates };
};
