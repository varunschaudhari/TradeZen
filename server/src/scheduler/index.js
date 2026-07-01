/**
 * @file scheduler/index.js
 * @description Flow 11 — registers all 10 cron jobs. Times are IST; node-cron uses the
 *              server clock (UTC), so expressions are written in UTC (IST − 5:30).
 *              Jobs 4/5/7/8 depend on external data feeds (earnings, FII/DII, sector
 *              indices) not yet ingested — they are registered as documented placeholders
 *              so the schedule is complete and ready to wire when those sources exist.
 * @author TradeZen Team
 * @created 2026-06-20
 * @lastModified 2026-06-20
 */

import cron from 'node-cron';
import { logger } from '../config/logger.js';
import { runFullScan, runEodPrep, isMarketOpen } from './scanPipeline.js';
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

  // JOB 4 — Earnings calendar refresh (8:00 AM IST = 2:30 UTC, daily) — PLACEHOLDER
  cron.schedule(
    '30 2 * * *',
    job('earnings-refresh', async () => {
      logger.warn('earnings-refresh: external earnings feed not yet integrated — skipped');
    })
  );

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

  logger.info('Scheduler registered: 12 cron jobs (main scan every ' + interval + ' min, position monitor every 2 min)');
};
