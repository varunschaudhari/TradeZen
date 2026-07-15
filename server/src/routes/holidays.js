/**
 * @file holidays.js
 * @description GET /api/holidays — NSE holiday calendar (from the static, manually-
 *   maintained NSE_HOLIDAY_LIST in constants.js) with computed past/upcoming/days-until
 *   fields against today's IST date.
 * @author TradeZen Team
 */

import express from 'express';
import { NSE_HOLIDAY_LIST } from '../config/constants.js';

const router = express.Router();

const todayIST = () => {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
};

// GET /api/holidays
router.get('/', (_req, res) => {
  const today = todayIST();
  const holidays = [...NSE_HOLIDAY_LIST]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((h) => ({
      ...h,
      isPast: h.date < today,
      isToday: h.date === today,
      daysUntil: Math.round((new Date(`${h.date}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86_400_000),
    }));
  const next = holidays.find((h) => !h.isPast) ?? null;

  res.json({
    success: true,
    data: { holidays, next, today, year: today.slice(0, 4) },
    message: `${holidays.length} NSE holidays`,
  });
});

export default router;
