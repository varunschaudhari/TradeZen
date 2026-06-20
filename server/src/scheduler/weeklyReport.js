/**
 * @file weeklyReport.js
 * @description Cron job: Sunday 8:00 AM IST — weekly performance report
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-14
 */

import cron from 'node-cron';
import { logger } from '../config/logger.js';
import { generateWeeklyReport } from '../services/reportGenerator.js';
import { sendWeeklyReport } from '../services/notifier.js';

/**
 * Register the Sunday 8:00 AM IST weekly report cron (2:30 AM UTC Sunday).
 */
export const startWeeklyReport = () => {
  cron.schedule('30 2 * * 0', async () => {
    logger.info('Weekly report job triggered');
    try {
      const reportData = await generateWeeklyReport();
      await sendWeeklyReport(reportData);
      logger.info('Weekly report sent successfully');
    } catch (err) {
      logger.error('Weekly report job failed', { error: err.message });
    }
  });
  logger.info('Weekly report scheduler registered (8:00 AM IST Sundays)');
};
