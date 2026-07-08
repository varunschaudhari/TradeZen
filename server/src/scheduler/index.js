/**
 * @file scheduler/index.js
 * @description Flow 11 — registers all 10 cron jobs. Times are IST; node-cron uses the
 *              server clock (UTC), so expressions are written in UTC (IST − 5:30).
 *              Jobs 5/7/8 depend on external data feeds (FII/DII, sector indices) not
 *              yet ingested — they are registered as documented placeholders so the
 *              schedule is complete and ready to wire when those sources exist.
 * @author TradeZen Team
 * @created 2026-06-20
 * @lastModified 2026-06-20
 */

import cron from 'node-cron';
import { ENTRY_WATCH_INTERVAL_MINUTES } from '../config/constants.js';
import { logger } from '../config/logger.js';
import { runFullScan, runEodPrep, isMarketOpen } from './scanPipeline.js';
import { refreshEarningsCalendar } from '../services/earningsCalendar.js';
import { watchEntryZones } from '../services/entryWatcher.js';
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

/**
 * Register all TradeZen cron jobs. Call once after MongoDB connects.
 * @returns {void}
 */
export const startScheduler = () => {
  const interval = parseInt(process.env.SCAN_INTERVAL_MINUTES ?? '15', 10);

  // JOB 1 — Main market scanner (every N min; market-hours guard is inside runFullScan)
  cron.schedule(
    `*/${interval} * * * *`,
    job('main-scan', () => runFullScan())
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

  // JOB 14 — Intraday ORB scanner (every 5 min, weekdays; the 10:15–14:00 IST window
  // guard lives inside runOrbScan). EOD-prep shortlist only, rules-only, EXPERIMENTAL
  // paper-tracked alerts — never an order, never a Trade doc.
  cron.schedule(
    '*/5 * * * 1-5',
    job('orb-scan', async () => {
      if (!isMarketOpen()) return;
      const summary = await runOrbScan();
      // Log real cycles (telemetry: prescreen savings + which condition rejected what)
      if (summary.evaluated || summary.prescreened || summary.triggered) {
        logger.info('ORB scan cycle', summary);
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

  // JOB 2 — Morning brief (8:30 AM IST = 3:00 UTC, Mon–Fri)
  cron.schedule(
    '0 3 * * 1-5',
    job('morning-brief', async () => {
      await sendMorningBrief(await generateMorningBrief());
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

  // JOB 6 — Evening summary (4:00 PM IST = 10:30 UTC, Mon–Fri)
  cron.schedule(
    '30 10 * * 1-5',
    job('evening-summary', async () => {
      await sendEveningSummary(await generateEveningSummary());
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

  // JOB 9 — Signal expiry cleanup (9:00 AM IST ≈ 3:32 UTC, daily)
  cron.schedule(
    '32 3 * * *',
    job('signal-expiry', async () => {
      const count = await expireStaleSignals();
      logger.info('Signal expiry cleanup done', { expired: count });
    })
  );

  // JOB 10 — Weekly performance report + signal-decay review (Sun 8:00 AM IST = 2:30 UTC)
  cron.schedule(
    '30 2 * * 0',
    job('weekly-report', async () => {
      await sendWeeklyReport(await generateWeeklyReport());
      await updatePerformance();
      const flags = await reviewSignalDecay();
      if (flags.length) logger.warn('Signal decay detected', { flags });
      // Weekly calibration review — the continuous-improvement feedback nudge.
      await sendDecisionQualityReport(await getDecisionQualityReport()).catch((e) =>
        logger.error('weekly calibration review failed', { error: e.message })
      );
    })
  );

  logger.info('Scheduler registered: 17 cron jobs (main scan every ' + interval + ' min, position monitor every 2 min, entry watch every ' + ENTRY_WATCH_INTERVAL_MINUTES + ' min, ORB scan every 5 min in window)');
};
