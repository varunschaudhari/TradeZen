/**
 * @file tradeTracker.js
 * @description Flow 9 — manual trade logging + open-position monitoring. Trades are
 *              never auto-executed; this only tracks hypothetical/manual positions.
 *              Pure decision cores (evaluateTrade, computeCloseFields, buildTradeDoc,
 *              computeTarget1Fields) are unit-tested; the async functions are thin DB
 *              glue that also emit socket events and fire notifier alerts.
 * @author TradeZen Team
 * @created 2026-06-20
 * @lastModified 2026-06-20
 */

import Trade from '../models/Trade.js';
import Signal from '../models/Signal.js';
import {
  DEFAULT_RISK_PCT,
  EARNINGS_EXIT_REMINDER_DAYS,
  EXIT_REASONS,
  SL_WARNING_PCT,
  SL_WARNING_THROTTLE_MS,
  TRADE_STATUSES,
  VERDICTS,
} from '../config/constants.js';
import { logger } from '../config/logger.js';
import { analyzeStocks } from './pythonBridge.js';
import { sendEarningsReminder, sendSlWarning, sendTarget1Hit, sendTarget2Hit } from './notifier.js';
import { emitEvent, SOCKET_EVENTS } from '../socket/socketHandlers.js';

const round2 = (n) => Math.round(n * 100) / 100;
const MS_PER_DAY = 86_400_000;

// ── Pure decision cores ─────────────────────────────────────────────────────────
/**
 * Build a Trade document from manual entry data (no DB I/O).
 *
 * @param {object} data - { symbol, entryPrice, shares, stopLoss, target1, target2?, earningsTimestamp?, notes? }
 * @param {string|null} signalId - Linked Signal id, if any
 * @returns {object} Trade document ready for Trade.create()
 */
export const buildTradeDoc = (data, signalId = null) => {
  const shares = Number(data.shares);
  const entryPrice = Number(data.entryPrice);
  const target1Shares = Math.floor(shares / 2);
  return {
    symbol: String(data.symbol).toUpperCase(),
    signalId: signalId ?? data.signalId ?? null,
    status: TRADE_STATUSES.OPEN,
    entryPrice,
    entryDate: data.entryDate ?? new Date(),
    stopLoss: Number(data.stopLoss),
    target1: Number(data.target1),
    target2: data.target2 != null ? Number(data.target2) : undefined,
    shares,
    capitalDeployed: round2(shares * entryPrice),
    target1Shares,
    target2Shares: shares - target1Shares,
    currentPrice: entryPrice,
    earningsTimestamp: data.earningsTimestamp ?? null,
    notes: data.notes ?? '',
  };
};

/**
 * Evaluate an open trade against the current price (pure).
 * Uses the trailed stop (entry price) once Target 1 has been hit.
 *
 * @param {object} trade - Trade document/object
 * @param {number} price - Current price
 * @param {number} [nowMs] - Reference epoch ms
 * @returns {object} Decision: pnl, slHit, slWarning, t1Hit, t2Hit, earningsDue, …
 */
export const evaluateTrade = (trade, price, nowMs = Date.now()) => {
  const unrealizedPnl = round2((price - trade.entryPrice) * trade.shares);
  const unrealizedPnlPct =
    trade.capitalDeployed > 0 ? round2((unrealizedPnl / trade.capitalDeployed) * 100) : 0;
  const effectiveSl =
    trade.slTrailed && trade.slTrailedTo != null ? trade.slTrailedTo : trade.stopLoss;
  const slHit = price <= effectiveSl;
  const slDistancePct =
    effectiveSl > 0 ? round2(((price - effectiveSl) / effectiveSl) * 100) : null;
  const slWarning =
    !slHit && slDistancePct != null && slDistancePct >= 0 && slDistancePct <= SL_WARNING_PCT;
  const t1Hit = !trade.target1Hit && trade.target1 != null && price >= trade.target1;
  const t2Hit = trade.target1Hit && trade.target2 != null && price >= trade.target2;

  let daysToEarnings = null;
  let earningsDue = false;
  if (trade.earningsTimestamp) {
    daysToEarnings = Math.floor((trade.earningsTimestamp * 1000 - nowMs) / MS_PER_DAY);
    earningsDue =
      daysToEarnings >= 0 &&
      daysToEarnings <= EARNINGS_EXIT_REMINDER_DAYS &&
      !trade.earningsAlertSent;
  }
  return {
    unrealizedPnl,
    unrealizedPnlPct,
    effectiveSl,
    slHit,
    slWarning,
    slDistancePct,
    t1Hit,
    t2Hit,
    earningsDue,
    daysToEarnings,
  };
};

/**
 * Fields to set when Target 1 is hit: book half (record price), trail SL to entry (pure).
 *
 * @param {object} trade - Trade
 * @param {number} exitPrice - T1 fill price
 * @param {Date} [now] - Reference time
 * @returns {object} Partial update
 */
export const computeTarget1Fields = (trade, exitPrice, now = new Date()) => ({
  target1Hit: true,
  target1HitDate: now,
  target1ExitPrice: exitPrice,
  slTrailed: true,
  slTrailedTo: trade.entryPrice,
});

/**
 * Fields to set when closing a trade fully (pure).
 *
 * @param {object} trade - Trade
 * @param {number} exitPrice - Exit price
 * @param {string} exitReason - One of EXIT_REASONS
 * @param {Date} [now] - Reference time
 * @returns {object} Close update incl. realized P&L
 */
export const computeCloseFields = (trade, exitPrice, exitReason, now = new Date()) => {
  const realizedPnl = round2((exitPrice - trade.entryPrice) * trade.shares);
  const realizedPnlPct =
    trade.capitalDeployed > 0 ? round2((realizedPnl / trade.capitalDeployed) * 100) : 0;
  return {
    status: TRADE_STATUSES.CLOSED,
    currentPrice: exitPrice,
    exitPrice,
    exitDate: now,
    realizedPnl,
    realizedPnlPct,
    exitReason,
  };
};

// ── Async operations (DB + alerts) ──────────────────────────────────────────────
/**
 * Log a new manual trade, linking it to an active BUY signal when possible.
 *
 * @param {object} data - { symbol, entryPrice, shares, stopLoss, target1, target2?, signalId?, notes? }
 * @returns {Promise<object>} The created Trade
 */
export const logTrade = async (data) => {
  for (const field of ['symbol', 'entryPrice', 'shares', 'stopLoss', 'target1']) {
    if (data[field] == null) throw new Error(`logTrade: missing required field "${field}"`);
  }
  let signalId = data.signalId ?? null;
  if (!signalId) {
    const signal = await Signal.findOne({
      symbol: String(data.symbol).toUpperCase(),
      verdict: VERDICTS.BUY,
      isActive: true,
    })
      .sort({ createdAt: -1 })
      .select('_id earningsTimestamp');
    signalId = signal?._id ?? null;
  }
  const trade = await Trade.create(buildTradeDoc(data, signalId));
  logger.info(`Trade logged: ${trade.symbol}`, { shares: trade.shares, entry: trade.entryPrice });
  return trade;
};

/**
 * Mark Target 1 hit on a trade: book half, trail SL to entry, alert + emit.
 *
 * @param {object} trade - Mongoose Trade doc
 * @param {number} exitPrice - T1 fill price
 * @returns {Promise<object>} Updated trade
 */
export const markTarget1Hit = async (trade, exitPrice) => {
  Object.assign(trade, computeTarget1Fields(trade, exitPrice));
  await trade.save();
  emitEvent(SOCKET_EVENTS.TRADE_TARGET1, trade.toObject());
  sendTarget1Hit(trade).catch((e) => logger.error('sendTarget1Hit failed', { error: e.message }));
  logger.info(`Target 1 hit: ${trade.symbol} @ ₹${exitPrice} — SL trailed to entry`);
  return trade;
};

/**
 * Close a trade fully (manual or monitor-driven), compute realized P&L, alert + emit.
 *
 * @param {object} trade - Mongoose Trade doc
 * @param {object} opts - { exitPrice, exitReason }
 * @returns {Promise<object>} Closed trade
 */
export const closeTrade = async (trade, { exitPrice, exitReason = EXIT_REASONS.MANUAL }) => {
  Object.assign(trade, computeCloseFields(trade, exitPrice, exitReason));
  await trade.save();
  if (exitReason === EXIT_REASONS.TARGET2) {
    emitEvent(SOCKET_EVENTS.TRADE_TARGET2, trade.toObject());
    sendTarget2Hit(trade).catch((e) => logger.error('sendTarget2Hit failed', { error: e.message }));
  }
  logger.info(`Trade closed: ${trade.symbol} ${exitReason} @ ₹${exitPrice}`, {
    realizedPnl: trade.realizedPnl,
  });
  return trade;
};

/**
 * Build a { SYMBOL: price } map for the given symbols via the Python analyzer.
 *
 * @param {string[]} symbols - NSE symbols
 * @returns {Promise<Record<string, number>>}
 */
async function buildPriceMap(symbols) {
  const res = await analyzeStocks(symbols, 1_000_000, DEFAULT_RISK_PCT);
  const map = {};
  for (const r of res?.results ?? []) {
    if (!r.error && r.currentPrice != null) map[r.symbol] = r.currentPrice;
  }
  return map;
}

/**
 * Apply one trade's price evaluation: close on SL/T2, trail on T1, warn/earnings else.
 *
 * @param {object} trade - Mongoose Trade doc
 * @param {number} price - Current price
 * @param {object} summary - Mutable counters
 * @returns {Promise<void>}
 */
async function processTrade(trade, price, summary) {
  const decision = evaluateTrade(trade, price);
  trade.currentPrice = price;
  trade.unrealizedPnl = decision.unrealizedPnl;
  trade.unrealizedPnlPct = decision.unrealizedPnlPct;

  if (decision.slHit) {
    await closeTrade(trade, { exitPrice: price, exitReason: EXIT_REASONS.STOPLOSS });
    emitEvent(SOCKET_EVENTS.TRADE_SL_WARNING, {
      tradeId: trade._id,
      symbol: trade.symbol,
      currentPrice: price,
      stopLoss: decision.effectiveSl,
      distancePct: 0,
      hit: true,
    });
    summary.slHit += 1;
    return;
  }
  if (decision.t2Hit) {
    await closeTrade(trade, { exitPrice: price, exitReason: EXIT_REASONS.TARGET2 });
    summary.t2 += 1;
    return;
  }
  if (decision.t1Hit) {
    await markTarget1Hit(trade, price);
    summary.t1 += 1;
  } else if (decision.slWarning && notThrottled(trade)) {
    trade.lastSlWarningAt = new Date();
    emitEvent(SOCKET_EVENTS.TRADE_SL_WARNING, {
      tradeId: trade._id,
      symbol: trade.symbol,
      currentPrice: price,
      stopLoss: decision.effectiveSl,
      distancePct: decision.slDistancePct,
    });
    sendSlWarning({ ...trade.toObject(), currentPrice: price }).catch((e) =>
      logger.error('sendSlWarning failed', { error: e.message })
    );
    summary.warnings += 1;
  }
  if (decision.earningsDue) {
    trade.earningsAlertSent = true;
    emitEvent(SOCKET_EVENTS.TRADE_EARNINGS, {
      symbol: trade.symbol,
      daysToEarnings: decision.daysToEarnings,
    });
    sendEarningsReminder({ ...trade.toObject(), daysToEarnings: decision.daysToEarnings }).catch(
      (e) => logger.error('sendEarningsReminder failed', { error: e.message })
    );
    summary.earnings += 1;
  }
  await trade.save();
}

function notThrottled(trade) {
  return (
    !trade.lastSlWarningAt ||
    Date.now() - new Date(trade.lastSlWarningAt).getTime() > SL_WARNING_THROTTLE_MS
  );
}

/**
 * Monitor all open trades against current prices (the 15-min cron step).
 *
 * @param {Record<string, number>} [priceMap] - Pre-fetched prices; fetched if omitted
 * @returns {Promise<object>} Summary counters
 */
export const monitorOpenTrades = async (priceMap = null) => {
  const open = await Trade.find({ status: TRADE_STATUSES.OPEN });
  const summary = { checked: 0, slHit: 0, t1: 0, t2: 0, warnings: 0, earnings: 0 };
  if (!open.length) return summary;

  const prices = priceMap ?? (await buildPriceMap([...new Set(open.map((t) => t.symbol))]));
  for (const trade of open) {
    const price = prices[trade.symbol];
    if (price == null) {
      logger.warn(`No price for open trade ${trade.symbol} — skipping`);
      continue;
    }
    summary.checked += 1;
    try {
      await processTrade(trade, price, summary);
    } catch (err) {
      logger.error(`Trade monitor failed for ${trade.symbol}`, { error: err.message });
    }
  }
  logger.info('Open-trade monitor complete', summary);
  return summary;
};
