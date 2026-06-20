/**
 * @file morningBrief.js
 * @description Cron job: 8:30 AM IST weekdays — pre-market summary before trading opens
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-14
 */

import cron from 'node-cron';
import { logger } from '../config/logger.js';
import { generateMorningBrief } from '../services/reportGenerator.js';
import { sendMorningBrief } from '../services/notifier.js';

/**
 * Register the 8:30 AM IST morning brief cron (3:00 AM UTC, Mon–Fri).
 * Calls reportGenerator to build the data, then notifier to send it.
 */
export const startMorningBrief = () => {
  cron.schedule('0 3 * * 1-5', async () => {
    logger.info('Morning brief job triggered');
    try {
      const briefData = await generateMorningBrief();
      await sendMorningBrief(briefData);
      logger.info('Morning brief sent successfully');
    } catch (err) {
      logger.error('Morning brief job failed', { error: err.message });
    }
  });
  logger.info('Morning brief scheduler registered (8:30 AM IST Mon–Fri)');
};
