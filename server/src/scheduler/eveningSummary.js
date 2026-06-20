/**
 * @file eveningSummary.js
 * @description Cron job: 4:00 PM IST weekdays — end-of-day trading summary
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-14
 */

import cron from 'node-cron';
import { logger } from '../config/logger.js';
import { generateEveningSummary } from '../services/reportGenerator.js';
import { sendEveningSummary } from '../services/notifier.js';

/**
 * Register the 4:00 PM IST evening summary cron (10:30 AM UTC, Mon–Fri).
 */
export const startEveningSummary = () => {
  cron.schedule('30 10 * * 1-5', async () => {
    logger.info('Evening summary job triggered');
    try {
      const summaryData = await generateEveningSummary();
      await sendEveningSummary(summaryData);
      logger.info('Evening summary sent successfully');
    } catch (err) {
      logger.error('Evening summary job failed', { error: err.message });
    }
  });
  logger.info('Evening summary scheduler registered (4:00 PM IST Mon–Fri)');
};
