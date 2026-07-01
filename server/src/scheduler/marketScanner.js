/**
 * @file marketScanner.js
 * @description Thin compatibility shim. The active cron scheduler is scheduler/index.js
 *              (startScheduler), which calls runFullScan() directly. This file keeps
 *              runScanCycle as a re-export alias so any external scripts that still
 *              reference it continue to work.
 * @author TradeZen Team
 */

import { logger } from '../config/logger.js';
import { runFullScan } from './scanPipeline.js';

// Backward-compat alias: external test scripts that call runScanCycle() still work.
// The live cron (scheduler/index.js → startScheduler) calls runFullScan() directly.
export const runScanCycle = (opts) => runFullScan(opts);

// startMarketScanner was the old cron entry-point, now superseded by startScheduler()
// in scheduler/index.js. Kept as a no-op so any forgotten callers don't crash.
export const startMarketScanner = () => {
  logger.warn('startMarketScanner is superseded — use startScheduler() in scheduler/index.js');
};
