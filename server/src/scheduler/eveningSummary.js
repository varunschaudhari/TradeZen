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
import { sendEveningSummary, sendHolidayReminder } from '../services/notifier.js';
import { NSE_HOLIDAY_LIST } from '../config/constants.js';

/**
 * The next WEEKDAY's date (IST, YYYY-MM-DD) after now — skips Sat/Sun so a Friday
 * evening run correctly looks ahead to Monday, not the intervening weekend.
 * @returns {string}
 */
function nextWeekdayIST() {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

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

    // Holiday reminder — the next trading weekday, not just "tomorrow" (a Friday run
    // must look ahead to Monday, skipping the weekend in between).
    try {
      const nextDate = nextWeekdayIST();
      const holiday = NSE_HOLIDAY_LIST.find((h) => h.date === nextDate);
      if (holiday) await sendHolidayReminder(holiday);
    } catch (err) {
      logger.error('Holiday reminder failed', { error: err.message });
    }
  });
  logger.info('Evening summary scheduler registered (4:00 PM IST Mon–Fri)');
};
