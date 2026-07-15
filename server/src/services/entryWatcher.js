/**
 * @file entryWatcher.js
 * @description Intraday entry-zone watcher (JOB 13). Every few minutes during market
 *   hours, pulls light /quotes for the active BUY signals and alerts the moment a live
 *   price trades inside a signal's entry zone — turning a day-level swing signal into
 *   an actionable entry moment. Alerts only (Telegram/email/socket): the human places
 *   the trade; TradeZen never auto-executes.
 *
 *   One-shot per signal: the trigger is claimed atomically via entryAlertSent so
 *   overlapping cycles can't double-alert, and entryTriggeredAt records the moment.
 *   Volume confirmation is intentionally absent — /quotes carries no volume, and the
 *   signal already cleared Gate 5 (1.5× 20-day volume) at scan time.
 *
 * @author TradeZen Team
 * @created 2026-07-07
 */

import mongoose from 'mongoose';
import Signal from '../models/Signal.js';
import { ENTRY_WATCH_MAX_SIGNALS, VERDICTS } from '../config/constants.js';
import { getQuotes } from './quoteService.js';
import { sendEntryZoneAlert } from './notifier.js';
import { emitGlobal, SOCKET_EVENTS } from '../socket/socketHandlers.js';
import { logger } from '../config/logger.js';

/**
 * Whether a live price triggers a signal's entry zone (pure).
 * Fires only while price trades INSIDE the zone: above it the entry is gone (alerting
 * would invite chasing), below it the setup hasn't confirmed yet.
 *
 * @param {object} signal - Signal with entryZone { low, high }
 * @param {number|null|undefined} price - Live price
 * @returns {boolean}
 */
export function isEntryTriggered(signal, price) {
  const low = signal?.entryZone?.low;
  const high = signal?.entryZone?.high;
  if (price == null || low == null || high == null) return false;
  return price >= low && price <= high;
}

/**
 * One watch cycle: quote all watchable BUY signals, then alert + stamp the triggered
 * ones. Never throws — the cron stays healthy.
 *
 * @returns {Promise<{ watched: number, triggered: number }>}
 */
export const watchEntryZones = async () => {
  const summary = { watched: 0, triggered: 0 };
  if (mongoose.connection.readyState !== 1) return summary;
  try {
    const now = new Date();
    const signals = await Signal.find({
      verdict: VERDICTS.BUY,
      isActive: true,
      entryAlertSent: { $ne: true },
      signalValidTill: { $gt: now },
      'entryZone.low': { $ne: null },
      'entryZone.high': { $ne: null },
    })
      .sort({ createdAt: -1 })
      .limit(ENTRY_WATCH_MAX_SIGNALS)
      .lean();
    summary.watched = signals.length;
    if (!signals.length) return summary;

    const symbols = [...new Set(signals.map((s) => s.symbol))];
    const quotes = await getQuotes(symbols);

    for (const signal of signals) {
      const price = quotes[signal.symbol]?.price;
      if (!isEntryTriggered(signal, price)) continue;

      // Atomic claim: only the cycle that flips entryAlertSent gets to alert.
      const res = await Signal.updateOne(
        { _id: signal._id, entryAlertSent: { $ne: true } },
        { $set: { entryAlertSent: true, entryTriggeredAt: now } }
      );
      if (!res.modifiedCount) continue;

      summary.triggered += 1;
      emitGlobal(SOCKET_EVENTS.SIGNAL_ENTRY_TRIGGER, {
        signalId: signal._id,
        symbol: signal.symbol,
        price,
        entryZone: signal.entryZone,
        stopLoss: signal.stopLoss,
        target1: signal.target1,
        target2: signal.target2,
        riskReward: signal.riskReward,
        timestamp: now.toISOString(),
      });
      // Also push the updated doc so signal lists refresh without a reload.
      emitGlobal(SOCKET_EVENTS.SIGNAL_UPDATE, {
        ...signal,
        entryAlertSent: true,
        entryTriggeredAt: now,
      });
      await sendEntryZoneAlert(signal, price); // notifier never throws
      logger.info(`Entry zone hit for ${signal.symbol}`, {
        price,
        low: signal.entryZone.low,
        high: signal.entryZone.high,
      });
    }
    return summary;
  } catch (err) {
    logger.error('watchEntryZones failed', { error: err.message });
    return summary;
  }
};
