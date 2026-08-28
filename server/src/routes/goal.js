/**
 * @file goal.js
 * @description REST routes for the capital-target tracker — deliberately independent of
 *   the signal/gate/verdict pipeline AND of the trading Config/constants.js. The goal's
 *   targetAmount/startCapital are numbers the user types in for their own personal plan —
 *   never defaulted from or synced with Config.capital or DEFAULT_CAPITAL, since those
 *   represent the (possibly stale/demo) trading system capital, not necessarily the user's
 *   real capital. Only Trade history is read, to chart actual growth; nothing here ever
 *   feeds back into scoring or position sizing.
 *   GET    /api/goal          — current goal (or null)
 *   PUT    /api/goal          — create/update the goal
 *   DELETE /api/goal          — clear the goal
 *   GET    /api/goal/progress — actual-vs-required capital curve + status
 * @author TradeZen Team
 */

import express from 'express';
import mongoose from 'mongoose';
import Joi from 'joi';
import Goal from '../models/Goal.js';
import Trade from '../models/Trade.js';
import { TRADE_STATUSES } from '../config/constants.js';
import { validateBody } from '../middleware/validateRequest.js';
import { logger } from '../config/logger.js';

const router = express.Router();
const MS_PER_DAY = 86_400_000;
const MS_PER_YEAR = 365.25 * MS_PER_DAY;
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

const goalSchema = Joi.object({
  targetAmount: Joi.number().positive().required(),
  targetDate:   Joi.date().greater('now').required(),
  startCapital: Joi.number().positive().required(),
  startDate:    Joi.date().optional(),
});

// GET /api/goal
router.get('/', async (req, res, next) => {
  try {
    const goal = await Goal.findOne({ userId: req.userId }).lean();
    res.json({ success: true, data: goal ?? null, message: goal ? 'Goal loaded' : 'No goal set' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/goal — create or replace. startCapital is always user-supplied (never defaulted
// from Config.capital — see file header); startDate defaults to now if omitted.
router.put('/', validateBody(goalSchema), async (req, res, next) => {
  try {
    const { targetAmount, targetDate, startCapital } = req.body;
    const startDate = req.body.startDate ?? new Date();

    if (new Date(targetDate) <= new Date(startDate)) {
      return res.status(400).json({ success: false, error: 'targetDate must be after startDate', code: 400 });
    }

    const goal = await Goal.findOneAndUpdate(
      { userId: req.userId },
      { $set: { targetAmount, targetDate, startCapital, startDate } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    logger.info('Goal saved', { userId: req.userId, targetAmount, targetDate, startCapital, startDate });
    res.json({ success: true, data: goal, message: 'Goal saved' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/goal
router.delete('/', async (req, res, next) => {
  try {
    await Goal.deleteOne({ userId: req.userId });
    res.json({ success: true, data: null, message: 'Goal cleared' });
  } catch (err) {
    next(err);
  }
});

/**
 * AHEAD/ON_TRACK/BEHIND comparison uses a 5% band around the required trajectory so
 * ordinary trade-to-trade noise doesn't flip the status. NO_DATA covers both "goal too
 * new to annualize" and "no closed trades yet" — either way there's nothing to compare.
 */
function determineStatus(currentCapital, requiredCapitalAtNow) {
  if (requiredCapitalAtNow == null || requiredCapitalAtNow <= 0) return 'NO_DATA';
  const diffPct = ((currentCapital - requiredCapitalAtNow) / requiredCapitalAtNow) * 100;
  if (diffPct > 5) return 'AHEAD';
  if (diffPct < -5) return 'BEHIND';
  return 'ON_TRACK';
}

// GET /api/goal/progress
router.get('/progress', async (req, res, next) => {
  try {
    const goal = await Goal.findOne({ userId: req.userId }).lean();
    if (!goal) {
      return res.status(404).json({ success: false, error: 'No goal set — PUT /api/goal first', code: 404 });
    }
    const { targetAmount, targetDate, startCapital, startDate } = goal;
    const start = new Date(startDate);
    const target = new Date(targetDate);
    const now = new Date();

    const monthly = await Trade.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(req.userId),
          status: TRADE_STATUSES.CLOSED,
          exitDate: { $exists: true, $gte: start },
          realizedPnl: { $exists: true },
        },
      },
      {
        $group: {
          _id: { year: { $year: '$exitDate' }, month: { $month: '$exitDate' } },
          pnl: { $sum: '$realizedPnl' },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    let running = startCapital;
    const actualPoints = monthly.map((m) => {
      running += m.pnl;
      return {
        time: Date.UTC(m._id.year, m._id.month - 1, 1),
        label: `${MONTH_NAMES[m._id.month - 1]} ${m._id.year}`,
        actualCapital: round2(running),
      };
    });
    const currentCapital = round2(running);

    const yearsTotal = (target - start) / MS_PER_YEAR;
    const requiredCAGR = yearsTotal > 0 ? Math.pow(targetAmount / startCapital, 1 / yearsTotal) - 1 : null;

    const elapsedYears = (now - start) / MS_PER_YEAR;
    // Require ~1 month elapsed before annualizing — otherwise a single early trade swings
    // the implied CAGR wildly and the number is noise, not signal.
    const actualCAGR =
      elapsedYears > 30 / 365.25 && currentCapital > 0
        ? Math.pow(currentCapital / startCapital, 1 / elapsedYears) - 1
        : null;

    const requiredCapitalAtNow =
      requiredCAGR != null
        ? round2(startCapital * Math.pow(1 + requiredCAGR, Math.max(0, Math.min(elapsedYears, yearsTotal))))
        : null;

    // Required trajectory, monthly, from start to target (extended to cover any actual
    // data past the target date, so an overrun doesn't get silently clipped off the chart).
    const lastActualTime = actualPoints.length ? actualPoints[actualPoints.length - 1].time : start.getTime();
    const curveEnd = new Date(Math.max(target.getTime(), lastActualTime));
    const points = [];
    if (requiredCAGR != null) {
      const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
      while (cursor <= curveEnd) {
        const t = (cursor - start) / MS_PER_YEAR;
        const time = cursor.getTime();
        const actual = actualPoints.find((p) => p.time === time);
        points.push({
          label: `${MONTH_NAMES[cursor.getUTCMonth()]} ${cursor.getUTCFullYear()}`,
          requiredCapital: cursor <= target ? round2(startCapital * Math.pow(1 + requiredCAGR, Math.max(0, t))) : null,
          actualCapital: actual ? actual.actualCapital : null,
        });
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    }

    res.json({
      success: true,
      data: {
        goal: { targetAmount, targetDate, startCapital, startDate },
        currentCapital,
        requiredCAGRPct: requiredCAGR != null ? round2(requiredCAGR * 100) : null,
        actualCAGRPct: actualCAGR != null ? round2(actualCAGR * 100) : null,
        requiredCapitalAtNow,
        pctOfTargetReached: round2((currentCapital / targetAmount) * 100),
        daysRemaining: Math.max(0, Math.round((target - now) / MS_PER_DAY)),
        status: determineStatus(currentCapital, requiredCapitalAtNow),
        points,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
