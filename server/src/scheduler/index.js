/**
 * @file scheduler/index.js
 * @description Flow 11 — registers all cron jobs. Times are IST; node-cron uses the
 *              server clock (UTC), so expressions are written in UTC (IST − 5:30).
 *              Jobs 5/7/8 depend on external data feeds (FII/DII, sector indices) not
 *              yet ingested — they are registered as documented placeholders so the
 *              schedule is complete and ready to wire when those sources exist.
 *
 *              Swing (JOB 11 eod-prep) and intraday (JOB 18 intraday-prep) build their
 *              shortlists independently — different universes, different ranking
 *              criteria, different enable flags (Config.scannerEnabled vs
 *              ORB_SCANNER_ENABLED). Do not reintroduce a dependency between them.
 * @author TradeZen Team
 * @created 2026-06-20
 * @lastModified 2026-07-09
 */

import cron from 'node-cron';
import { ENTRY_WATCH_INTERVAL_MINUTES, ORB_SCANNER_ENABLED } from '../config/constants.js';
import { logger } from '../config/logger.js';
import { runFullScan, runEodPrep, isMarketOpen, isTradingDay } from './scanPipeline.js';
import ScanResult from '../models/ScanResult.js';
import IntradayUniverse from '../models/IntradayUniverse.js';
import Config from '../models/Config.js';
import User from '../models/User.js';
import { refreshEarningsCalendar } from '../services/earningsCalendar.js';
import { watchEntryZones } from '../services/entryWatcher.js';
import { buildIntradayUniverse } from '../services/intradayUniverse.js';
import { runOrbScan, settlePaperTrades, remindSquareOff } from '../services/orbScanner.js';
import { evaluateBlockedTrades } from '../services/disciplineLedger.js';
import { refreshOpenPositions } from '../services/positionTracker.js';
import { runStockDiscovery } from '../services/stockDiscovery.js';
import { expireStaleSignals } from '../services/signalManager.js';
import { updatePerformance, reviewSignalDecay } from '../services/performanceEngine.js';
import { getDecisionQualityReport } from '../services/decisionQuality.js';
import {
  generateMorningBrief,
  generateEveningSummary,
  generateWeeklyReport,
} from '../services/reportGenerator.js';
import { checkPriceAlerts } from '../services/alertChecker.js';
import {
  sendMorningBrief,
  sendEveningSummary,
  sendWeeklyReport,
  sendDecisionQualityReport,
} from '../services/notifier.js';

/**
 * Wrap a cron handler so a failure is logged, never crashing the scheduler.
 * @param {string} name - Job name for logs
 * @param {() => Promise<void>} handler - Async job body
 * @returns {() => Promise<void>}
 */
function job(name, handler) {
  return async () => {
    logger.info(`Cron triggered: ${name}`);
    try {
      await handler();
    } catch (err) {
      logger.error(`Cron job "${name}" failed`, { error: err.message });
    }
  };
}

function getNowIST() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

/** Every user's id — the per-user cron reports (morning/evening/weekly) run once each. */
async function allUserIds() {
  const users = await User.find().select('_id').lean().catch(() => []);
  return users.map((u) => String(u._id));
}

/**
 * The most recent daily-job cutoff (given HH:MM IST) on a trading day at or before
 * `nowIst`. Returned as a REAL (unshifted) instant, comparable directly against stored
 * `createdAt` timestamps. Shared by the swing EOD-prep and intraday-universe catch-up
 * nets — both run off the same 16:15 IST post-close slot.
 * @param {Date} nowIst - IST-shifted "now" (see getNowIST)
 * @param {number} [hour=16]
 * @param {number} [minute=15]
 * @returns {Date}
 */
function lastDailyCutoff(nowIst, hour = 16, minute = 15) {
  const cutoffIst = new Date(nowIst);
  cutoffIst.setUTCHours(hour, minute, 0, 0);
  if (cutoffIst > nowIst) cutoffIst.setUTCDate(cutoffIst.getUTCDate() - 1);
  while (!isTradingDay(cutoffIst)) {
    cutoffIst.setUTCDate(cutoffIst.getUTCDate() - 1);
  }
  return new Date(cutoffIst.getTime() - 5.5 * 60 * 60 * 1000);
}

/**
 * Startup safety net for JOB 11. node-cron doesn't catch up missed schedules — if the
 * container isn't running at exactly 16:15 IST, the EOD-prep shortlist silently never
 * gets built, and the ORB scanner (JOB 14) then runs all day evaluating nothing without
 * ever logging an error (this happened for real: two sessions in a row produced zero
 * signals before anyone noticed). Runs a catch-up in the background — never blocks
 * startup/health checks — only when the latest shortlist actually predates the most
 * recent cutoff (a normal restart with a fresh shortlist is a no-op), and only when
 * `Config.scannerEnabled` is on: the manual pause switch is a deliberate "stop all
 * automated activity" control and this net must never override it.
 * @returns {Promise<void>}
 */
export async function catchUpEodPrepIfStale() {
  try {
    const [anyEnabled, latest] = await Promise.all([
      Config.exists({ scannerEnabled: true }),
      ScanResult.findOne({ scanType: 'EOD_PREP' }).sort({ createdAt: -1 }).select('createdAt').lean(),
    ]);
    const cutoff = lastDailyCutoff(getNowIST());
    if (latest && latest.createdAt >= cutoff) return; // fresh — nothing to do
    if (!anyEnabled) {
      logger.warn('EOD-prep shortlist is stale, but no user has the scanner on — catch-up skipped', {
        lastRun: latest?.createdAt ?? null,
      });
      return;
    }

    logger.warn('EOD-prep shortlist missed its 16:15 IST slot — running catch-up now', {
      lastRun: latest?.createdAt ?? null,
      cutoff,
    });
    const { candidates } = await runEodPrep({ forceRun: true });
    logger.info('EOD-prep catch-up done', { candidates });
  } catch (err) {
    logger.error('EOD-prep catch-up failed', { error: err.message });
  }
}

/**
 * Startup safety net for the intraday-prep job — the same missed-schedule problem as
 * catchUpEodPrepIfStale(), for the intraday module's OWN shortlist. Gated on
 * ORB_SCANNER_ENABLED (the intraday module's independent pause flag), NOT
 * Config.scannerEnabled — pausing swing must never pause intraday, or vice versa.
 * @returns {Promise<void>}
 */
export async function catchUpIntradayUniverseIfStale() {
  try {
    const latest = await IntradayUniverse.findOne().sort({ createdAt: -1 }).select('createdAt').lean();
    const cutoff = lastDailyCutoff(getNowIST());
    if (latest && latest.createdAt >= cutoff) return; // fresh — nothing to do
    if (!ORB_SCANNER_ENABLED) {
      logger.warn('Intraday universe is stale, but the intraday module is disabled — catch-up skipped', {
        lastRun: latest?.createdAt ?? null,
      });
      return;
    }

    logger.warn('Intraday universe missed its 16:15 IST slot — running catch-up now', {
      lastRun: latest?.createdAt ?? null,
      cutoff,
    });
    const result = await buildIntradayUniverse({ forceRun: true });
    logger.info('Intraday universe catch-up done', result);
  } catch (err) {
    logger.error('Intraday universe catch-up failed', { error: err.message });
  }
}

/**
 * Register all TradeZen cron jobs. Call once after MongoDB connects.
 * @returns {void}
 */
export const startScheduler = () => {
  const interval = parseInt(process.env.SCAN_INTERVAL_MINUTES ?? '15', 10);

  // JOB 1 — Main market scanner (every N min; market-hours guard is inside runFullScan).
  // Overlap-guarded: the EXTENDED universe tier (added 2026-08-03, ~4,500 symbols total)
  // pushed measured scan duration close to (sometimes past) the prior 300s Python-client
  // timeout — a scan overrunning into the next tick with no guard would stack scans
  // indefinitely (screener fetches are sequential, not parallelized). This just skips a
  // tick if the previous scan hasn't finished; it never queues or kills anything.
  let scanRunning = false;
  cron.schedule(
    `*/${interval} * * * *`,
    job('main-scan', async () => {
      if (scanRunning) {
        logger.warn('main-scan skipped — previous scan still running');
        return;
      }
      scanRunning = true;
      try {
        await runFullScan();
      } finally {
        scanRunning = false;
      }
    })
  );

  // JOB 12 — Live open-position monitor + price alert check (every 2 min, market hours only).
  cron.schedule(
    '*/2 * * * *',
    job('position-monitor', async () => {
      if (!isMarketOpen()) return;
      const summary = await refreshOpenPositions();
      if (summary.checked) logger.info('Position monitor cycle', summary);
      const alertsFired = await checkPriceAlerts();
      if (alertsFired > 0) logger.info('Price alerts triggered', { count: alertsFired });
    })
  );

  // JOB 13 — Intraday entry-zone watcher (every 5 min, market hours only). Alerts when
  // an active BUY signal's live price enters its entry zone — timing aid, never an order.
  cron.schedule(
    `*/${ENTRY_WATCH_INTERVAL_MINUTES} * * * *`,
    job('entry-watch', async () => {
      if (!isMarketOpen()) return;
      const summary = await watchEntryZones();
      if (summary.triggered) logger.info('Entry watch cycle', summary);
    })
  );

  // JOB 14 — Intraday engine: ORB + VWAP-reversion + momentum-continuation, long & short
  // (every 5 min, weekdays; the 10:15–14:00 IST window guard lives inside runOrbScan).
  // Runs against the intraday module's OWN shortlist (intradayUniverse.js), never the
  // swing EOD-prep list. Rules only, EXPERIMENTAL, paper-tracked — never an order, never
  // a Trade doc.
  cron.schedule(
    '*/5 * * * 1-5',
    job('intraday-scan', async () => {
      if (!isMarketOpen()) return;
      const summary = await runOrbScan();
      // Log real cycles (telemetry: which condition rejected what, per strategy)
      if (summary.evaluated || summary.triggered) {
        logger.info('Intraday scan cycle', summary);
      }
    })
  );

  // JOB 15 — ORB paper-trade settlement (3:20 PM IST = 9:50 UTC, Mon–Fri): replays the
  // session's 5m bars after each breakout to settle SL / target / square-off exits, so
  // the experimental track record builds itself (also catches missed prior sessions).
  cron.schedule(
    '50 9 * * 1-5',
    job('orb-settle', async () => {
      const summary = await settlePaperTrades();
      logger.info('ORB settlement done', summary);
    })
  );

  // JOB 16 — ORB square-off reminder (3:00 PM IST = 9:30 UTC, Mon–Fri): nudge to close
  // any manually mirrored intraday position by 15:15. Sends nothing when none are open.
  cron.schedule(
    '30 9 * * 1-5',
    job('orb-squareoff-reminder', async () => {
      const { open } = await remindSquareOff();
      if (open) logger.info('ORB square-off reminder', { open });
    })
  );

  // JOB 17 — Discipline ledger mark-to-market (3:45 PM IST = 10:15 UTC, Mon–Fri):
  // prices every blocked trade whose horizon has passed, turning the system's NOs into
  // a measured "capital protected" number (honest both ways — missed winners count).
  cron.schedule(
    '15 10 * * 1-5',
    job('discipline-ledger-eval', async () => {
      const summary = await evaluateBlockedTrades();
      if (summary.evaluated) logger.info('Discipline ledger evaluation done', summary);
    })
  );

  // JOB 18 — Intraday universe: the intraday module's OWN daily shortlist (liquid
  // large-caps ranked by volatility × liquidity), completely decoupled from the swing
  // EOD-prep list. Same 4:15 PM IST slot (today's close is the input either way).
  cron.schedule(
    '45 10 * * 1-5',
    job('intraday-prep', async () => {
      const result = await buildIntradayUniverse();
      logger.info('Intraday prep job done', result);
    })
  );
  // Startup safety net — see catchUpIntradayUniverseIfStale() doc comment.
  catchUpIntradayUniverseIfStale();

  // JOB 2 — Morning brief (8:30 AM IST = 3:00 UTC, Mon–Fri) — one per user
  cron.schedule(
    '0 3 * * 1-5',
    job('morning-brief', async () => {
      for (const userId of await allUserIds()) {
        await sendMorningBrief(await generateMorningBrief(userId), userId);
      }
    })
  );

  // JOB 3 — Pre-market discovery (9:00 AM IST = 3:30 UTC, Mon–Fri)
  cron.schedule(
    '30 3 * * 1-5',
    job('pre-market-discovery', async () => {
      const { funnel } = await runStockDiscovery();
      logger.info('Pre-market discovery complete', { funnel });
    })
  );

  // JOB 4 — Earnings calendar refresh from NSE (8:00 AM IST = 2:30 UTC, daily)
  cron.schedule(
    '30 2 * * *',
    job('earnings-refresh', async () => {
      const summary = await refreshEarningsCalendar();
      logger.info('Earnings calendar refresh done', summary);
    })
  );
  // Warm the NSE earnings data once at boot so Gate 3 has it right after a deploy/restart
  // instead of waiting for the next 2:30 UTC run (never throws — no-op on failure).
  refreshEarningsCalendar().catch(() => {});

  // JOB 5 — FII/DII data fetch (6:00 PM IST = 12:30 UTC, Mon–Fri) — PLACEHOLDER
  cron.schedule(
    '30 12 * * 1-5',
    job('fii-dii-fetch', async () => {
      logger.warn('fii-dii-fetch: NSE FII/DII feed not yet integrated — skipped');
    })
  );

  // JOB 6 — Evening summary (4:00 PM IST = 10:30 UTC, Mon–Fri) — one per user
  cron.schedule(
    '30 10 * * 1-5',
    job('evening-summary', async () => {
      for (const userId of await allUserIds()) {
        await sendEveningSummary(await generateEveningSummary(userId), userId);
      }
    })
  );

  // JOB 7 — S/R level recalculation (8:00 AM IST = 2:35 UTC, daily) — PLACEHOLDER
  // S/R is currently computed on demand inside the Python /analyze call each scan.
  cron.schedule(
    '35 2 * * *',
    job('sr-recalc', async () => {
      logger.warn('sr-recalc: S/R computed on-demand per scan — standalone recalc not needed yet');
    })
  );

  // JOB 8 — Sector rotation update (Mon 8:30 AM IST = 3:00 UTC) — PLACEHOLDER
  cron.schedule(
    '0 3 * * 1',
    job('sector-rotation', async () => {
      logger.warn('sector-rotation: sector-index feed not yet integrated — skipped');
    })
  );

  // JOB 11 — EOD prep: next-session watchlist from today's close (4:15 PM IST = 10:45 UTC, Mon–Fri)
  // Runs after the 15:30 close + the 16:00 evening summary. Builds tomorrow's shortlist —
  // no Claude, no tradeable signals (the market-hours guard is bypassed inside runEodPrep).
  cron.schedule(
    '45 10 * * 1-5',
    job('eod-prep', async () => {
      const { candidates } = await runEodPrep();
      logger.info('EOD prep job done', { candidates });
    })
  );
  // Startup safety net: if the container wasn't running at the last 16:15 IST slot, the
  // ORB scanner would otherwise scan all day against a stale/empty shortlist with no
  // error logged. Fire-and-forget — the discovery pipeline takes minutes and must not
  // block startup or the /health check.
  catchUpEodPrepIfStale();

  // JOB 9 — Signal expiry cleanup (9:00 AM IST ≈ 3:32 UTC, daily)
  cron.schedule(
    '32 3 * * *',
    job('signal-expiry', async () => {
      const count = await expireStaleSignals();
      logger.info('Signal expiry cleanup done', { expired: count });
    })
  );

  // JOB 10 — Weekly performance report + signal-decay review (Sun 8:00 AM IST = 2:30 UTC)
  // — every step here is this user's own paper-trading record, so it runs once per user.
  cron.schedule(
    '30 2 * * 0',
    job('weekly-report', async () => {
      for (const userId of await allUserIds()) {
        await sendWeeklyReport(await generateWeeklyReport(userId), userId);
        await updatePerformance(userId);
        const flags = await reviewSignalDecay(userId);
        if (flags.length) logger.warn('Signal decay detected', { userId, flags });
        // Weekly calibration review — the continuous-improvement feedback nudge.
        await sendDecisionQualityReport(await getDecisionQualityReport(userId), userId).catch((e) =>
          logger.error('weekly calibration review failed', { userId, error: e.message })
        );
      }
    })
  );

  logger.info('Scheduler registered: 18 cron jobs (main scan every ' + interval + ' min, position monitor every 2 min, entry watch every ' + ENTRY_WATCH_INTERVAL_MINUTES + ' min, intraday scan every 5 min in window, own intraday-prep shortlist)');
};
