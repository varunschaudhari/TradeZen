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
  SIMONS_OVERRIDE_THRESHOLD,
} from '../config/constants.js';
import { logger } from '../config/logger.js';
import {
  analyzeStocks,
  fetchMarketData,
  fetchNiftyHistory,
  screenUniverse,
} from './pythonBridge.js';
import { fetchNewsAndSentiment } from './newsFetcher.js';
import { getNseEarningsOverride } from './earningsCalendar.js';
import { calculateSimonsSignals, fetchSymbolHistory } from './simonsSignals.js';
import { runAllGates } from './gateChecker.js';
import { determineMarketMode } from './marketHealthService.js';
import { getMarketSignals } from './marketSignals.js';
import Stock from '../models/Stock.js';

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
 * Attach each stock's sector from the Stock master collection (99%+ coverage — synced
 * from the universe catalog, not from Python's bulk /analyze response, which never
 * returns sector at all — that only exists on the single-symbol /stock detail schema).
 * Without this, every downstream consumer of stockData.sector — the Signal document,
 * evaluated[]'s Stocks-catalog row, and enrichAndGate's sector-rotation check — silently
 * saw null/undefined forever. Mutates and returns the same array for convenience.
 *
 * @param {object[]} stocks - StockAnalysis objects (or anything with a `symbol`)
 * @returns {Promise<object[]>} same array, each with `.sector` set (null if unknown)
 */
async function attachSectors(stocks) {
  if (!stocks.length) return stocks;
  try {
    const rows = await Stock.find({ symbol: { $in: stocks.map((s) => s.symbol) } })
      .select('symbol sector')
      .lean();
    const bySymbol = new Map(rows.map((r) => [r.symbol, r.sector && r.sector !== 'Unknown' ? r.sector : null]));
    for (const s of stocks) s.sector = bySymbol.get(s.symbol) ?? null;
  } catch (err) {
    logger.error('attachSectors failed — proceeding without sector data', { error: err.message });
  }
  return stocks;
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
  const [newsData, history, nseEarningsTs] = await Promise.all([
    fetchNewsAndSentiment(symbol),
    fetchSymbolHistory(symbol),
    getNseEarningsOverride(symbol),
  ]);
  // marketData already carries fiiTrend/pcRatio/topSectors/bottomSectors (from
  // getMarketSignals() — see scanPipeline.js and evaluateSymbols() above) and stockData
  // now carries its own sector (attachSectors()) — this was previously discarded by a
  // hardcoded `external: {}`, silently zeroing out signals 6–9 (sector/FII/P-C) no
  // matter what data existed. MarketSignals has no populated document yet as of
  // 2026-08-21, so this doesn't change today's output — it's correct plumbing that
  // activates automatically the moment that collection gets real data.
  const simons = calculateSimonsSignals({
    indicators: stockData.indicators,
    currentPrice: stockData.currentPrice,
    high52w: stockData.high52w,
    closes: history?.closes,
    highs: history?.highs,
    lows: history?.lows,
    volumes: history?.volumes,
    niftyCloses,
    external: {
      stockSector: stockData.sector ?? null,
      sectorRanking: { topSectors: marketData?.topSectors ?? [], bottomSectors: marketData?.bottomSectors ?? [] },
      fiiData: marketData?.fiiTrend ? { trend: marketData.fiiTrend } : null,
      pcRatio: marketData?.pcRatio ?? null,
    },
  });
  const enriched = { ...stockData, ...simons.enrichment };
  // Gate 3 input: a fresh NSE event-calendar date is authoritative over yfinance's
  if (nseEarningsTs != null) enriched.earningsTimestamp = nseEarningsTs;
  const gateResult = runAllGates(enriched, marketData, newsData);
  return { symbol, stockData: enriched, newsData, simons, gateResult };
}

/**
 * Stage 7 selection: keep stocks that pass ≥ GATES_REQUIRED_FOR_CLAUDE without a hard
 * block. Additionally, if Simons score ≥ SIMONS_OVERRIDE_THRESHOLD, also accept stocks
 * with gatesPassed ≥ 4 (soft-gate failures only). Rank by composite score and cap.
 *
 * @param {object[]} gated - Output of enrichAndGate per candidate
 * @param {number} claudeCap - Max candidates to forward to Claude
 * @returns {object[]} Ranked, capped candidate list with optional simonOverride flag
 */
export function selectTopCandidates(gated, claudeCap) {
  const qualified = gated.filter((c) => {
    const { gatesPassed, hardBlockFired } = c.gateResult;
    const simonsScore = c.simons?.score ?? 0;

    // Normal path: 5+ gates and no hard blocks
    if (gatesPassed >= GATES_REQUIRED_FOR_CLAUDE && !hardBlockFired) {
      return true;
    }

    // Simons override: 4+ gates, no hard blocks, Simons ≥ 80
    if (
      gatesPassed >= 4 &&
      !hardBlockFired &&
      simonsScore >= SIMONS_OVERRIDE_THRESHOLD
    ) {
      c.simonOverride = {
        reason: `Soft gates failed but Simons score ${Math.round(simonsScore)} ≥ ${SIMONS_OVERRIDE_THRESHOLD}, proceeding to Claude`,
        score: simonsScore,
      };
      return true;
    }

    return false;
  });

  return qualified
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
  // Optional progress hooks (no-ops if absent) so callers like runFullScan can drive a
  // live progress bar: onProgress.phase(name, note), .begin(total, note), .tick(symbol).
  const onProgress = opts.onProgress ?? {};
  const marketData = opts.marketData ?? (await fetchMarketData());
  const funnel = {};

  // Stages 1–6 (Python screen)
  onProgress.phase?.('Screening the NSE universe…');
  const screen = await screenUniverse({ tiers, extraSymbols: watchlistSymbols });
  funnel.universe = screen.universeCount;
  funnel.screened = screen.candidateCount;
  funnel.screenRejections = screen.rejectionCounts;
  const symbols = (screen.candidates ?? []).slice(0, maxAnalyze).map((c) => c.symbol);

  // Per-symbol record of everything that didn't reach analysis: pre-filter rejects +
  // screened-in survivors that fell beyond the analyze cap.
  const screenedOut = [
    ...(screen.rejected ?? []).map((r) => ({
      symbol: r.symbol,
      currentPrice: r.currentPrice,
      droppedAtStage: 'SCREEN',
      reason: r.stage,
    })),
    ...(screen.candidates ?? []).slice(maxAnalyze).map((c) => ({
      symbol: c.symbol,
      currentPrice: c.currentPrice,
      droppedAtStage: 'ANALYZE_CAP',
      reason: null,
    })),
  ];

  if (!symbols.length) {
    logger.info('Discovery: no candidates after screen', { funnel });
    return { candidates: [], funnel, screenedOut };
  }

  // Full analysis for survivors
  onProgress.phase?.(`Fetching analysis for ${symbols.length} screened stocks…`);
  const analysis = await analyzeStocks(symbols, capital, riskPct);
  const valid = await attachSectors((analysis.results ?? []).filter((r) => !r.error));
  funnel.analyzed = valid.length;

  // Nifty closes power the relative-strength signal — fetch once, share across candidates
  const closes = niftyCloses ?? (await fetchNiftyHistory());

  // Enrich (news + Simons) and run Stage 7 gates with bounded concurrency. Tick per stock
  // so callers can render "scoring 12/45 · TCS" progress through the heaviest phase.
  onProgress.begin?.(valid.length, `Scoring ${valid.length} stocks through the 8 gates…`);
  const gated = await mapWithConcurrency(valid, DISCOVERY_CONCURRENCY, async (stock) => {
    const result = await enrichAndGate(stock, marketData, closes);
    onProgress.tick?.(stock.symbol);
    return result;
  });
  funnel.gatePassed = gated.filter(
    (c) => c.gateResult.gatesPassed >= GATES_REQUIRED_FOR_CLAUDE && !c.gateResult.hardBlockFired
  ).length;

  // Stage 7 selection → Stage 8 budget
  const candidates = selectTopCandidates(gated, claudeCap);
  funnel.selected = candidates.length;

  // Compact per-stock record of everything analyzed (for the scan snapshot/visibility).
  // hardBlockReason/stop/sector feed the discipline ledger for near-candidates.
  const HARD_GATES = ['gate1', 'gate2', 'gate3', 'gate6', 'gate8'];
  const evaluated = gated.map((c) => ({
    symbol: c.symbol,
    currentPrice: c.stockData.currentPrice,
    gatesPassed: c.gateResult.gatesPassed,
    compositeScore: c.gateResult.compositeScore,
    hardBlockFired: c.gateResult.hardBlockFired,
    shouldCallClaude: c.gateResult.shouldCallClaude,
    hardBlockReason: c.gateResult.hardBlockFired
      ? HARD_GATES.map((g) => c.gateResult.gateDetails?.[g]).find((d) => d && !d.passed)?.reason ??
        'Hard-block gate fired'
      : null,
    suggestedStopLoss: c.stockData.suggestedStopLoss ?? null,
    sector: c.stockData.sector ?? null,
  }));

  logger.info('Stock discovery complete', { funnel, marketMode: marketData?.marketMode });
  return { candidates, funnel, marketData, evaluated, screenedOut };
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
  const signals = await getMarketSignals();
  const marketData = {
    ...rawMarket,
    marketMode: classified.mode,
    narrowMarket: classified.mode === MARKET_MODES.MIXED,
    fiiTrend: signals.fiiTrend,
    pcRatio: signals.pcRatio,
    topSectors: signals.topSectors,
    bottomSectors: signals.bottomSectors,
  };
  const capital = opts.capital ?? 1_000_000;
  const riskPct = opts.riskPct ?? 1;
  const [analysis, niftyCloses] = await Promise.all([
    analyzeStocks(symbols, capital, riskPct),
    opts.niftyCloses ? Promise.resolve(opts.niftyCloses) : fetchNiftyHistory(),
  ]);
  await attachSectors((analysis.results ?? []).filter((r) => !r.error));

  const candidates = [];
  for (const stock of analysis.results ?? []) {
    if (stock.error) {
      candidates.push({ symbol: stock.symbol, error: stock.error });
      continue;
    }
    try {
      candidates.push(await enrichAndGate(stock, marketData, niftyCloses));
    } catch (err) {
      candidates.push({ symbol: stock.symbol, error: err.message });
    }
  }
  return { marketData, candidates };
};
