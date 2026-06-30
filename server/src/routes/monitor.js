/**
 * @file monitor.js
 * @description Scan & DB monitoring API powering the Monitor dashboard. Aggregates
 *   live scan progress, the stock inventory + scan status, database statistics, data
 *   health, signal-generation analytics, scanning-performance insights, sector status,
 *   a recent-events feed, and scan/scanner controls.
 *
 *   GET   /api/monitor/overview   — stats + health + analytics + sectors + scanner + progress + events
 *   GET   /api/monitor/inventory  — every stock we track + its latest scan status & signal
 *   GET   /api/monitor/progress   — live scan progress snapshot (socket-pushed too)
 *   GET   /api/monitor/events     — recent monitor events (alerts feed)
 *   POST  /api/monitor/scan       — trigger a full scan now (forceRun)
 *   PATCH /api/monitor/scanner    — enable/disable the automatic scanner
 * @author TradeZen Team
 * @created 2026-06-27
 */

import express from 'express';
import Joi from 'joi';
import Config from '../models/Config.js';
import Signal from '../models/Signal.js';
import Trade from '../models/Trade.js';
import ScanResult from '../models/ScanResult.js';
import Stock from '../models/Stock.js';
import { validateBody } from '../middleware/validateRequest.js';
import { logger } from '../config/logger.js';
import { runFullScan } from '../scheduler/scanPipeline.js';
import { fetchUniverse } from '../services/pythonBridge.js';
import { getScanState, getRecentEvents, emitMonitorEvent } from '../services/scanState.js';
import { getDecisionQualityReport } from '../services/decisionQuality.js';

const router = express.Router();

const SCAN_INTERVAL_MIN = parseInt(process.env.SCAN_INTERVAL_MINUTES ?? '15', 10);
const HISTORY_WINDOW = 20; // scans considered for analytics/health
const CATALOG_SCAN_WINDOW = 5; // recent LIVE scans merged to find each symbol's latest status

// The scan universe is a near-static list; cache it in-process to avoid hitting the
// Python service on every catalog load.
let _universeCache = { symbols: [], at: 0 };
const UNIVERSE_TTL_MS = 60 * 60 * 1000; // 1 hour
async function getUniverse() {
  if (_universeCache.symbols.length && Date.now() - _universeCache.at < UNIVERSE_TTL_MS) {
    return _universeCache.symbols;
  }
  try {
    const symbols = await fetchUniverse();
    if (symbols?.length) _universeCache = { symbols, at: Date.now() };
  } catch (err) {
    logger.warn('catalog: fetchUniverse failed', { error: err.message });
  }
  return _universeCache.symbols;
}

// Best-effort sector tags for common NSE large-caps; the user's watchlist sectors
// (Config.watchlist[].sector) take precedence over this fallback.
const STATIC_SECTORS = {
  TCS: 'IT', INFY: 'IT', WIPRO: 'IT', HCLTECH: 'IT', TECHM: 'IT', LTIM: 'IT',
  HDFCBANK: 'Finance', ICICIBANK: 'Finance', AXISBANK: 'Finance', KOTAKBANK: 'Finance',
  SBIN: 'Finance', INDUSINDBK: 'Finance', BAJFINANCE: 'Finance', BAJAJFINSV: 'Finance',
  SUNPHARMA: 'Pharma', CIPLA: 'Pharma', DRREDDY: 'Pharma', DIVISLAB: 'Pharma', LUPIN: 'Pharma',
  MARUTI: 'Auto', TATAMOTORS: 'Auto', M_M: 'Auto', BAJAJ_AUTO: 'Auto', EICHERMOT: 'Auto', HEROMOTOCO: 'Auto',
  NESTLEIND: 'FMCG', BRITANNIA: 'FMCG', ITC: 'FMCG', HINDUNILVR: 'FMCG', DABUR: 'FMCG',
  RELIANCE: 'Energy', ONGC: 'Energy', NTPC: 'Energy', POWERGRID: 'Energy', BPCL: 'Energy', IOC: 'Energy',
  TATASTEEL: 'Metals', JSWSTEEL: 'Metals', HINDALCO: 'Metals', VEDL: 'Metals', COALINDIA: 'Metals',
  LT: 'Infra', ULTRACEMCO: 'Cement', GRASIM: 'Cement', SHREECEM: 'Cement',
  BHARTIARTL: 'Telecom', ASIANPAINT: 'Consumer', TITAN: 'Consumer',
};

/** Build a symbol→sector lookup, watchlist sectors first then the static fallback. */
function buildSectorLookup(watchlist) {
  const map = {};
  for (const w of watchlist ?? []) {
    if (w.symbol && w.sector) map[w.symbol] = w.sector;
  }
  return (symbol) => map[symbol] ?? STATIC_SECTORS[symbol] ?? 'Unknown';
}

const round1 = (n) => Math.round(n * 10) / 10;
const startOfTodayUTC = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

// ── Feature 4: Database statistics ──────────────────────────────────────────────
async function buildStats(config, latest) {
  const [
    activeAgg,
    openTrades,
    closedTrades,
    signalCount,
    tradeCount,
    scanCount,
    scansToday,
  ] = await Promise.all([
    Signal.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$verdict', n: { $sum: 1 } } },
    ]),
    Trade.countDocuments({ status: 'OPEN' }),
    Trade.find({ status: 'CLOSED' }).select('realizedPnl').lean(),
    Signal.estimatedDocumentCount(),
    Trade.estimatedDocumentCount(),
    ScanResult.estimatedDocumentCount(),
    ScanResult.countDocuments({ createdAt: { $gte: startOfTodayUTC() } }),
  ]);

  const activeByVerdict = { BUY: 0, WAIT: 0, SKIP: 0 };
  for (const row of activeAgg) if (row._id) activeByVerdict[row._id] = row.n;

  const wins = closedTrades.filter((t) => (t.realizedPnl ?? 0) > 0).length;
  const winRate = closedTrades.length ? round1((wins / closedTrades.length) * 100) : null;

  return {
    watchlistCount: config?.watchlist?.length ?? 0,
    universeCount: latest?.funnel?.universe ?? null,
    activeSignals: activeByVerdict.BUY + activeByVerdict.WAIT,
    activeByVerdict,
    openTrades,
    closedTrades: closedTrades.length,
    winRate,
    collections: { signals: signalCount, trades: tradeCount, scanResults: scanCount },
    scansToday,
  };
}

// ── Feature 9 + 10: Signal analytics + scanning performance ─────────────────────
function buildAnalytics(history, latest) {
  if (!history.length) {
    return { available: false, message: 'No scans recorded yet' };
  }
  const durations = history.map((s) => s.durationMs ?? 0).filter((d) => d > 0);
  const totalSignals = history.reduce((s, r) => s + (r.signalsSaved ?? 0), 0);
  const totalBuys = history.reduce((s, r) => s + (r.buySignals ?? 0), 0);
  const totalClaude = history.reduce((s, r) => s + (r.claudeCalls ?? 0), 0);
  const totalCost = history.reduce((s, r) => s + (r.totalCostInr ?? 0), 0);
  const totalAnalyzed = history.reduce((s, r) => s + (r.funnel?.analyzed ?? 0), 0);

  // Aggregate screen-rejection reasons across the window (why stocks were dropped).
  const dropReasons = {};
  for (const s of history) {
    for (const [reason, n] of Object.entries(s.screenRejections ?? {})) {
      dropReasons[reason] = (dropReasons[reason] ?? 0) + n;
    }
  }
  const topDropReasons = Object.entries(dropReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([reason, count]) => ({ reason, count }));

  return {
    available: true,
    window: history.length,
    signalGen: {
      totalSignals,
      totalBuys,
      avgSignalsPerScan: round1(totalSignals / history.length),
      buyConversionPct: totalAnalyzed ? round1((totalBuys / totalAnalyzed) * 100) : 0,
      claudeCalls: totalClaude,
      lastScanSignals: latest?.signalsSaved ?? 0,
      lastScanBuys: latest?.buySignals ?? 0,
    },
    performance: {
      avgDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      fastestMs: durations.length ? Math.min(...durations) : null,
      slowestMs: durations.length ? Math.max(...durations) : null,
      totalClaudeCalls: totalClaude,
      totalCostInr: round1(totalCost),
      avgCostPerScanInr: round1(totalCost / history.length),
    },
    topDropReasons,
  };
}

// ── Feature 5: Data health / quality ────────────────────────────────────────────
function buildHealth(history, latest) {
  const issues = [];
  let score = 100;

  // Staleness: how long since the last scan vs the scan interval.
  const lastAt = latest ? new Date(latest.createdAt).getTime() : null;
  const ageMin = lastAt ? Math.round((Date.now() - lastAt) / 60000) : null;
  const staleThreshold = SCAN_INTERVAL_MIN * 3;
  if (ageMin == null) {
    issues.push({ severity: 'warn', message: 'No scans recorded yet' });
    score -= 30;
  } else if (ageMin > staleThreshold) {
    issues.push({ severity: 'warn', message: `Last scan ${ageMin} min ago (stale — interval is ${SCAN_INTERVAL_MIN} min)` });
    score -= 20;
  }

  // Error rate across the window.
  const totalErrors = history.reduce((s, r) => s + (r.errors ?? 0), 0);
  const totalAnalyzed = history.reduce((s, r) => s + (r.funnel?.analyzed ?? 0), 0);
  const errorRate = totalAnalyzed ? round1((totalErrors / totalAnalyzed) * 100) : 0;
  if (errorRate > 10) {
    issues.push({ severity: 'error', message: `High analysis error rate: ${errorRate}% over last ${history.length} scans` });
    score -= 25;
  } else if (errorRate > 3) {
    issues.push({ severity: 'warn', message: `Elevated error rate: ${errorRate}%` });
    score -= 10;
  }

  // Per-symbol python errors in the latest scan (stocks with a SCREEN reason).
  const latestErrors = (latest?.stocks ?? []).filter(
    (s) => s.droppedAtStage === 'SCREEN' && /error|fail|nan|no data/i.test(s.reason ?? '')
  );
  if (latestErrors.length) {
    issues.push({ severity: 'warn', message: `${latestErrors.length} stock(s) had data errors in the last scan` });
    score -= Math.min(15, latestErrors.length);
  }

  // Liquidity rejections (informational — these are intentional filters).
  const liqRej =
    (latest?.screenRejections?.liquidity ?? 0) +
    (latest?.screenRejections?.turnover ?? 0) +
    (latest?.screenRejections?.volume ?? 0);

  score = Math.max(0, score);
  const rating = score >= 85 ? 'HEALTHY' : score >= 60 ? 'DEGRADED' : 'UNHEALTHY';

  return {
    score,
    rating,
    lastScanAgeMin: ageMin,
    errorRate,
    totalErrors,
    lowLiquidityRejected: liqRej,
    dataErrorStocks: latestErrors.map((s) => ({ symbol: s.symbol, reason: s.reason })).slice(0, 10),
    issues,
  };
}

// ── Feature 8: Sector-wise scan status ──────────────────────────────────────────
function buildSectors(latest, sectorOf) {
  const stocks = latest?.stocks ?? [];
  const groups = {};
  for (const s of stocks) {
    const sector = sectorOf(s.symbol);
    if (!groups[sector]) groups[sector] = { sector, scanned: 0, signals: 0, gatePassed: 0, analyzed: 0 };
    groups[sector].scanned += 1;
    if (s.verdict === 'BUY' || s.verdict === 'WAIT') groups[sector].signals += 1;
    if (s.reachedClaude) groups[sector].analyzed += 1;
    if ((s.gatesPassed ?? 0) >= 5 && !s.hardBlockFired) groups[sector].gatePassed += 1;
  }
  return Object.values(groups).sort((a, b) => b.scanned - a.scanned);
}

// ── Feature 6: Scanner config / schedule ────────────────────────────────────────
function buildScanner(config, latest) {
  const lastAt = latest ? new Date(latest.createdAt).getTime() : null;
  const nextAt = lastAt ? lastAt + SCAN_INTERVAL_MIN * 60000 : null;
  return {
    enabled: config?.scannerEnabled ?? false,
    intervalMinutes: SCAN_INTERVAL_MIN,
    marketMode: config?.marketMode ?? latest?.marketMode ?? null,
    lastScanAt: latest?.createdAt ?? null,
    nextScanAt: nextAt ? new Date(nextAt).toISOString() : null,
  };
}

// ── GET /api/monitor/overview ────────────────────────────────────────────────────
router.get('/overview', async (_req, res, next) => {
  try {
    const [config, latest, history] = await Promise.all([
      Config.findOne().lean(),
      ScanResult.findOne({ scanType: 'LIVE' }).sort({ createdAt: -1 }).lean(),
      ScanResult.find({ scanType: 'LIVE' })
        .sort({ createdAt: -1 })
        .limit(HISTORY_WINDOW)
        .select('-stocks -watchlist')
        .lean(),
    ]);
    const sectorOf = buildSectorLookup(config?.watchlist);

    const stats = await buildStats(config, latest);

    res.json({
      success: true,
      data: {
        stats,
        analytics: buildAnalytics(history, latest),
        health: buildHealth(history, latest),
        sectors: buildSectors(latest, sectorOf),
        scanner: buildScanner(config, latest),
        progress: getScanState(),
        events: getRecentEvents(20),
      },
      message: 'Monitor overview',
    });
  } catch (err) {
    logger.error('GET /api/monitor/overview failed', { error: err.message });
    next(err);
  }
});

// ── Feature 1: Stock inventory + scan status ─────────────────────────────────────
// GET /api/monitor/inventory
router.get('/inventory', async (_req, res, next) => {
  try {
    const [config, latest, activeSignals] = await Promise.all([
      Config.findOne().lean(),
      ScanResult.findOne({ scanType: 'LIVE' }).sort({ createdAt: -1 }).lean(),
      Signal.find({ isActive: true })
        .sort({ createdAt: -1 })
        .select('symbol verdict confidence createdAt')
        .lean(),
    ]);
    const sectorOf = buildSectorLookup(config?.watchlist);
    const watchSet = new Set((config?.watchlist ?? []).map((w) => w.symbol));

    // Latest active signal per symbol.
    const signalBy = {};
    for (const s of activeSignals) {
      if (!signalBy[s.symbol]) {
        signalBy[s.symbol] = { verdict: s.verdict, confidence: s.confidence, at: s.createdAt };
      }
    }

    const rows = [];
    const seen = new Set();

    // 1) Stocks from the latest scan (these were actually scanned).
    for (const s of latest?.stocks ?? []) {
      seen.add(s.symbol);
      rows.push({
        symbol: s.symbol,
        sector: sectorOf(s.symbol),
        inWatchlist: watchSet.has(s.symbol),
        scanned: true,
        currentPrice: s.currentPrice ?? null,
        gatesPassed: s.gatesPassed ?? null,
        compositeScore: s.compositeScore ?? null,
        droppedAtStage: s.droppedAtStage ?? null,
        scanVerdict: s.verdict ?? null,
        reachedClaude: !!s.reachedClaude,
        signal: signalBy[s.symbol] ?? null,
      });
    }

    // 2) Watchlist stocks that weren't in the latest scan (not scanned this cycle).
    for (const w of config?.watchlist ?? []) {
      if (seen.has(w.symbol)) continue;
      rows.push({
        symbol: w.symbol,
        sector: sectorOf(w.symbol),
        inWatchlist: true,
        scanned: false,
        currentPrice: null,
        gatesPassed: null,
        compositeScore: null,
        droppedAtStage: null,
        scanVerdict: null,
        reachedClaude: false,
        signal: signalBy[w.symbol] ?? null,
      });
    }

    rows.sort((a, b) => (b.compositeScore ?? -1) - (a.compositeScore ?? -1));

    res.json({
      success: true,
      data: {
        stocks: rows,
        total: rows.length,
        scannedCount: rows.filter((r) => r.scanned).length,
        notScannedCount: rows.filter((r) => !r.scanned).length,
        lastScanAt: latest?.createdAt ?? null,
      },
      message: `${rows.length} stocks tracked`,
    });
  } catch (err) {
    logger.error('GET /api/monitor/inventory failed', { error: err.message });
    next(err);
  }
});

// ── Full universe catalog: every scannable symbol + its most-recent status ───────
// GET /api/monitor/catalog
router.get('/catalog', async (_req, res, next) => {
  try {
    // Primary source is now the durable Stock master (persists across the ScanResult
    // TTL, carries accurate sectors + fundamentals). Universe fills in symbols not yet
    // catalogued (shown as pending); active signals are merged on top.
    const [config, stocks, activeSignals, universe] = await Promise.all([
      Config.findOne().lean(),
      Stock.find({}).lean(),
      Signal.find({ isActive: true })
        .sort({ createdAt: -1 })
        .select('symbol verdict confidence createdAt')
        .lean(),
      getUniverse(),
    ]);

    const sectorOf = buildSectorLookup(config?.watchlist);
    const watchSet = new Set((config?.watchlist ?? []).map((w) => w.symbol));
    const universeSet = new Set(universe);

    const stockBy = {};
    for (const s of stocks) stockBy[s.symbol] = s;

    const signalBy = {};
    for (const s of activeSignals) {
      if (!signalBy[s.symbol]) {
        signalBy[s.symbol] = { verdict: s.verdict, confidence: s.confidence, at: s.createdAt };
      }
    }

    // Catalog = universe ∪ everything in the Stock master ∪ watchlist.
    const allSymbols = new Set([...universe, ...Object.keys(stockBy), ...watchSet]);

    let mostRecentScan = null;
    const rows = [];
    for (const symbol of allSymbols) {
      const st = stockBy[symbol];
      const ls = st?.lastScan;
      const scanned = !!(ls && ls.at);
      if (scanned && (!mostRecentScan || new Date(ls.at) > new Date(mostRecentScan))) {
        mostRecentScan = ls.at;
      }
      rows.push({
        symbol,
        // Prefer the stored sector; fall back to the static map only when missing/Unknown.
        sector: st?.sector && st.sector !== 'Unknown' ? st.sector : sectorOf(symbol),
        inWatchlist: watchSet.has(symbol),
        inUniverse: universeSet.has(symbol),
        scanned,
        lastScanAt: ls?.at ?? null,
        currentPrice: st?.currentPrice ?? null,
        gatesPassed: ls?.gatesPassed ?? null,
        compositeScore: ls?.compositeScore ?? null,
        scanVerdict: ls?.verdict ?? null,
        droppedAtStage: ls?.droppedAtStage ?? null,
        reachedClaude: ls?.reachedClaude ?? false,
        peRatio: st?.peRatio ?? null,
        marketCap: st?.marketCap ?? null,
        signal: signalBy[symbol] ?? null,
      });
    }

    // Scanned first (by composite score desc), then pending symbols alphabetically.
    rows.sort((a, b) => {
      if (a.scanned !== b.scanned) return a.scanned ? -1 : 1;
      if (a.scanned) return (b.compositeScore ?? -1) - (a.compositeScore ?? -1);
      return a.symbol.localeCompare(b.symbol);
    });

    res.json({
      success: true,
      data: {
        stocks: rows,
        total: rows.length,
        universeCount: universe.length,
        catalogued: stocks.length,
        scannedCount: rows.filter((r) => r.scanned).length,
        pendingCount: rows.filter((r) => !r.scanned).length,
        lastScanAt: mostRecentScan,
      },
      message: `${rows.length} stocks in catalog`,
    });
  } catch (err) {
    logger.error('GET /api/monitor/catalog failed', { error: err.message });
    next(err);
  }
});

// ── Decision-quality / calibration report ───────────────────────────────────────
// The report is heavy (resolves every stored signal against forward prices), so cache it.
let _calibration = { data: null, at: 0 };
const CALIBRATION_TTL_MS = 30 * 60 * 1000;
// GET /api/monitor/calibration  (?refresh=1 to recompute)
router.get('/calibration', async (req, res, next) => {
  try {
    const fresh = _calibration.data && Date.now() - _calibration.at < CALIBRATION_TTL_MS;
    if (fresh && req.query.refresh !== '1') {
      return res.json({
        success: true,
        data: { ..._calibration.data, cached: true, cacheAgeMin: Math.round((Date.now() - _calibration.at) / 60000) },
        message: 'Calibration (cached)',
      });
    }
    const report = await getDecisionQualityReport();
    _calibration = { data: report, at: Date.now() };
    res.json({ success: true, data: report, message: 'Calibration report' });
  } catch (err) {
    logger.error('GET /api/monitor/calibration failed', { error: err.message });
    next(err);
  }
});

// ── Feature 2: Live scan progress ────────────────────────────────────────────────
// GET /api/monitor/progress
router.get('/progress', (_req, res) => {
  res.json({ success: true, data: getScanState(), message: 'Scan progress' });
});

// ── Feature 7: Recent events / alerts feed ───────────────────────────────────────
// GET /api/monitor/events
router.get('/events', (_req, res) => {
  res.json({ success: true, data: getRecentEvents(50), message: 'Recent monitor events' });
});

// ── Feature 6: Trigger a scan now ────────────────────────────────────────────────
// POST /api/monitor/scan
router.post('/scan', async (_req, res, next) => {
  try {
    const current = getScanState();
    if (current.status === 'running') {
      return res.status(409).json({
        success: false,
        error: 'A scan is already running',
        code: 409,
        data: current,
      });
    }
    // Fire-and-forget; progress is pushed over the socket as it runs.
    runFullScan({ forceRun: true }).catch((err) =>
      logger.error('Manual full scan failed', { error: err.message })
    );
    res.status(202).json({ success: true, data: null, message: 'Scan started' });
  } catch (err) {
    next(err);
  }
});

// ── Feature 6: Enable/disable the automatic scanner ──────────────────────────────
const scannerSchema = Joi.object({ enabled: Joi.boolean().required() });
// PATCH /api/monitor/scanner
router.patch('/scanner', validateBody(scannerSchema), async (req, res, next) => {
  try {
    const { enabled } = req.body;
    await Config.findOneAndUpdate({}, { $set: { scannerEnabled: enabled } }, { upsert: true });
    emitMonitorEvent('scanner', enabled ? 'success' : 'warn', `Automatic scanner ${enabled ? 'enabled' : 'disabled'}`);
    logger.info('Scanner toggled', { enabled });
    res.json({ success: true, data: { enabled }, message: `Scanner ${enabled ? 'enabled' : 'disabled'}` });
  } catch (err) {
    next(err);
  }
});

export default router;
