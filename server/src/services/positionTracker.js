/**
 * @file positionTracker.js
 * @description Live open-position tracking. Uses the LIGHT /quotes price source (not the
 *   heavy /analyze) so it can run frequently. Provides:
 *     - getLivePositions(): read-only live snapshot for the UI (P&L, SL distance, a
 *       suggested action, and a suggested trailing stop) — never mutates/closes trades.
 *     - refreshOpenPositions(): the mutating refresh used by the 2-min cron — feeds fresh
 *       quotes into the proven monitorOpenTrades() (auto-close on SL/T2, trail on T1, alerts).
 *   The decision core suggestPositionAction() is pure and unit-testable.
 * @author TradeZen Team
 * @created 2026-06-27
 */

import Trade from '../models/Trade.js';
import { getQuotes } from './quoteService.js';
import { evaluateTrade, monitorOpenTrades } from './tradeTracker.js';
import { SL_WARNING_PCT, TRADE_STATUSES } from '../config/constants.js';
import { logger } from '../config/logger.js';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Suggest an action and a trailing stop for an open trade at the current price (pure).
 *
 * Trailing logic (never loosens an existing stop):
 *   - price ≥ T2  → lock in Target 1 as the new floor
 *   - price ≥ T1 (or T1 already booked) → move stop to break-even (entry)
 *   - profit ≥ 1R → move stop to break-even (entry)
 * Action priority: EXIT_RISK > BOOK_T2 > BOOK_T1 > TRAIL_STOP > HOLD.
 *
 * @param {object} trade - Open trade (plain object or doc)
 * @param {number} price - Current price
 * @returns {{ livePrice:number, rMultiple:number, slDistancePct:number|null,
 *   currentStop:number, suggestedStop:number, canTrail:boolean, action:string, reason:string }}
 */
export function suggestPositionAction(trade, price) {
  const entry = trade.entryPrice;
  const origStop = trade.stopLoss;
  const currentStop =
    trade.slTrailed && trade.slTrailedTo != null ? trade.slTrailedTo : trade.stopLoss;
  const riskPerShare = Math.max(entry - origStop, 0.01);
  const rMultiple = round2((price - entry) / riskPerShare);
  const slDistancePct = currentStop > 0 ? round2(((price - currentStop) / currentStop) * 100) : null;
  const t1 = trade.target1;
  const t2 = trade.target2;

  // Suggested trailing-stop floor — only ever ratchets up.
  let floor = currentStop;
  if (t2 != null && price >= t2) floor = Math.max(floor, t1 ?? entry);
  else if ((t1 != null && price >= t1) || trade.target1Hit) floor = Math.max(floor, entry);
  else if (rMultiple >= 1) floor = Math.max(floor, entry);
  const suggestedStop = round2(floor);
  const canTrail = suggestedStop > currentStop + 0.01;

  let action = 'HOLD';
  let reason = 'Within plan — hold';
  if (price <= currentStop) {
    action = 'EXIT_RISK';
    reason = 'At/below stop — exit now';
  } else if (slDistancePct != null && slDistancePct >= 0 && slDistancePct <= SL_WARNING_PCT) {
    action = 'EXIT_RISK';
    reason = `Only ${slDistancePct}% above stop`;
  } else if (t2 != null && price >= t2) {
    action = 'BOOK_T2';
    reason = 'Target 2 reached — book the remainder';
  } else if (t1 != null && price >= t1 && !trade.target1Hit) {
    action = 'BOOK_T1';
    reason = 'Target 1 reached — book half, trail to entry';
  } else if (canTrail) {
    action = 'TRAIL_STOP';
    reason = `Up +${rMultiple}R — trail stop to ₹${suggestedStop}`;
  }

  return { livePrice: price, rMultiple, slDistancePct, currentStop, suggestedStop, canTrail, action, reason };
}

function emptySummary() {
  return {
    count: 0,
    totalDeployed: 0,
    totalUnrealized: 0,
    totalUnrealizedPct: 0,
    atRisk: 0,
    actionable: 0,
    quotesLive: 0,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Read-only live snapshot of all open positions for the UI. Fetches fresh quotes and
 * computes live P&L + a suggested action/stop per position. Does NOT close or mutate.
 *
 * @param {string} [userId] - Scope to one user's trades; all users' when omitted
 * @returns {Promise<{ positions: object[], summary: object }>}
 */
export async function getLivePositions(userId = null) {
  const open = await Trade.find({ status: TRADE_STATUSES.OPEN, ...(userId ? { userId } : {}) })
    .sort({ createdAt: -1 })
    .lean();
  if (!open.length) return { positions: [], summary: emptySummary() };

  const symbols = [...new Set(open.map((t) => t.symbol))];
  const quotes = await getQuotes(symbols).catch(() => ({}));

  const positions = open.map((t) => {
    const q = quotes[t.symbol];
    const price = q?.price ?? t.currentPrice ?? t.entryPrice;
    const ev = evaluateTrade(t, price);
    const live = suggestPositionAction(t, price);
    return {
      ...t,
      currentPrice: price,
      unrealizedPnl: ev.unrealizedPnl,
      unrealizedPnlPct: ev.unrealizedPnlPct,
      dayChangePct: q?.changePct ?? null,
      hasLiveQuote: q?.price != null,
      live,
    };
  });

  const totalDeployed = positions.reduce((s, p) => s + (p.capitalDeployed ?? 0), 0);
  const totalUnrealized = positions.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);

  return {
    positions,
    summary: {
      count: positions.length,
      totalDeployed: round2(totalDeployed),
      totalUnrealized: round2(totalUnrealized),
      totalUnrealizedPct: totalDeployed > 0 ? round2((totalUnrealized / totalDeployed) * 100) : 0,
      atRisk: positions.filter((p) => p.live.action === 'EXIT_RISK').length,
      actionable: positions.filter((p) => p.live.action !== 'HOLD').length,
      quotesLive: positions.filter((p) => p.hasLiveQuote).length,
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Mutating refresh used by the position-monitor cron: pull light quotes for open-trade
 * symbols and feed them into the proven monitorOpenTrades() (auto-close on SL/T2, trail
 * on T1, fire SL/earnings alerts). Lighter than the 15-min scan's full /analyze fetch.
 *
 * @param {string} [userId] - Scope to one user's trades; all users' when omitted (cron)
 * @returns {Promise<object>} monitor summary counters
 */
export async function refreshOpenPositions(userId = null) {
  const empty = { checked: 0, slHit: 0, t1: 0, t2: 0, warnings: 0, earnings: 0 };
  const open = await Trade.find({ status: TRADE_STATUSES.OPEN, ...(userId ? { userId } : {}) })
    .select('symbol')
    .lean();
  if (!open.length) return empty;

  const symbols = [...new Set(open.map((t) => t.symbol))];
  const quotes = await getQuotes(symbols).catch(() => ({}));
  const priceMap = {};
  for (const s of symbols) {
    const p = quotes[s]?.price;
    if (p != null) priceMap[s] = p;
  }
  if (!Object.keys(priceMap).length) {
    logger.warn('refreshOpenPositions: no live quotes — skipping');
    return empty;
  }
  return monitorOpenTrades(priceMap, userId);
}
