/**
 * @file alertChecker.js
 * @description Check user-set price alerts against live quotes and emit socket events when crossed.
 *   Runs inside the 2-min position-monitor cron (market hours only).
 */

import PriceAlert from '../models/PriceAlert.js';
import { fetchQuotes } from './pythonBridge.js';
import { emitEvent, SOCKET_EVENTS } from '../socket/socketHandlers.js';
import { logger } from '../config/logger.js';

/**
 * Fetch live quotes for all active alert symbols, fire events for any that crossed their threshold.
 * @returns {Promise<number>} Count of alerts triggered this cycle
 */
export async function checkPriceAlerts() {
  const alerts = await PriceAlert.find({ active: true, triggeredAt: null });
  if (!alerts.length) return 0;

  const symbols = [...new Set(alerts.map((a) => a.symbol))];

  let prices = {};
  try {
    prices = await fetchQuotes(symbols);
  } catch (err) {
    logger.warn('alertChecker: quote fetch failed', { error: err.message });
    return 0;
  }

  let triggered = 0;
  for (const alert of alerts) {
    const q = prices[alert.symbol];
    if (!q?.price) continue;

    const { price } = q;
    const crossed =
      (alert.direction === 'above' && price >= alert.targetPrice) ||
      (alert.direction === 'below' && price <= alert.targetPrice);

    if (!crossed) continue;

    await PriceAlert.findByIdAndUpdate(alert._id, {
      active: false,
      triggeredAt: new Date(),
    });

    emitEvent(SOCKET_EVENTS.PRICE_ALERT, {
      alertId:     String(alert._id),
      symbol:      alert.symbol,
      targetPrice: alert.targetPrice,
      currentPrice: price,
      direction:   alert.direction,
      note:        alert.note,
      timestamp:   new Date().toISOString(),
    });

    logger.info('Price alert triggered', {
      symbol: alert.symbol,
      targetPrice: alert.targetPrice,
      currentPrice: price,
      direction: alert.direction,
    });
    triggered++;
  }

  return triggered;
}
