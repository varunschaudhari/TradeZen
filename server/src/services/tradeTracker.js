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
import Stock from '../models/Stock.js';
import {
  ATR_TRAIL_ENABLED,
  ATR_TRAIL_MULT,
  ATR_TRAIL_REPLACES_T2,
  DEFAULT_RISK_PCT,
  DEPLOYMENT_CAP_BY_MODE,
  EARNINGS_EXIT_REMINDER_DAYS,
  EXIT_REASONS,
  MAX_CAPITAL_DEPLOYED_PCT,
  MAX_OPEN_TRADES,
  MAX_PAPER_HOLD_DAYS,
  MAX_POSITIONS_PER_SECTOR,
  MAX_SECTOR_DEPLOYED_PCT,
  SL_WARNING_PCT,
  SL_WARNING_THROTTLE_MS,
  TRADE_STATUSES,
  VERDICTS,
} from '../config/constants.js';
import { logger } from '../config/logger.js';
import { analyzeStocks } from './pythonBridge.js';
import { estimateTradeCosts } from './tradingCosts.js';
import { sendEarningsReminder, sendSlWarning, sendTarget1Hit, sendTarget2Hit } from './notifier.js';
import { emitToUser, SOCKET_EVENTS } from '../socket/socketHandlers.js';

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
    userId: data.userId,
    symbol: String(data.symbol).toUpperCase(),
    signalId: signalId ?? data.signalId ?? null,
    source: data.source ?? 'MANUAL',
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
    atr14: data.atr14 != null && Number(data.atr14) > 0 ? Number(data.atr14) : null,
    highWaterMark: entryPrice,
    sector: data.sector ?? null,
    earningsTimestamp: data.earningsTimestamp ?? null,
    notes: data.notes ?? '',
  };
};

/** True when this trade rides the ATR trail after T1 (needs a positive entry-time ATR). */
export const isAtrTrailActive = (trade) => ATR_TRAIL_ENABLED && trade?.atr14 > 0;

/**
 * Split a trade's shares into the T1-booked leg and the still-exposed remainder (pure).
 * Falls back to floor(shares/2) for trades predating (or missing) a stored
 * target1Shares — same half-position convention buildTradeDoc already uses.
 *
 * @param {object} trade - Trade document/object
 * @returns {{ hasT1: boolean, t1Shares: number, remainingShares: number }}
 */
function splitT1Legs(trade) {
  const hasT1 = Boolean(trade.target1Hit) && trade.target1ExitPrice != null;
  if (!hasT1) return { hasT1, t1Shares: 0, remainingShares: trade.shares };
  const t1Shares = Math.min(trade.target1Shares ?? Math.floor(trade.shares / 2), trade.shares);
  return { hasT1, t1Shares, remainingShares: trade.shares - t1Shares };
}

/**
 * Evaluate an open trade against the current price (pure).
 * Uses the trailed stop once Target 1 has been hit: with an entry-time ATR the stop
 * ratchets to highWaterMark − ATR_TRAIL_MULT × atr14 (never below entry, never down);
 * without one it stays at the legacy trail-to-entry level. When the ATR trail is riding
 * and ATR_TRAIL_REPLACES_T2 is on, T2 no longer closes the position — the trail is the
 * exit, so winners can run past the fixed target.
 *
 * Once T1 has been hit, unrealizedPnl blends the ALREADY-BOOKED leg (target1Shares at
 * target1ExitPrice — locked in, no longer exposed to price) with the live leg (the
 * remaining shares at the current price) — not the full original position marked at the
 * live price, which overstates risk still on the table and understates a T1-then-reversal.
 *
 * @param {object} trade - Trade document/object
 * @param {number} price - Current price
 * @param {number} [nowMs] - Reference epoch ms
 * @returns {object} Decision: pnl, slHit, slWarning, t1Hit, t2Hit, highWaterMark, trailAdvanceTo, …
 */
export const evaluateTrade = (trade, price, nowMs = Date.now()) => {
  const { hasT1, t1Shares, remainingShares } = splitT1Legs(trade);
  const bankedPnl = hasT1 ? (trade.target1ExitPrice - trade.entryPrice) * t1Shares : 0;
  const livePnl = (price - trade.entryPrice) * remainingShares;
  const unrealizedPnl = round2(bankedPnl + livePnl);
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

  // Track the high-water mark from entry (trail anchor; harmless pre-T1).
  const highWaterMark = Math.max(trade.highWaterMark ?? trade.entryPrice, price);

  // ATR trail (post-T1 only): propose a ratcheted stop; report it only when it advances.
  const trailRiding = trade.target1Hit && isAtrTrailActive(trade);
  let trailAdvanceTo = null;
  if (trailRiding && !slHit) {
    const proposed = round2(
      Math.max(trade.entryPrice, highWaterMark - ATR_TRAIL_MULT * trade.atr14)
    );
    if (proposed > effectiveSl) trailAdvanceTo = proposed;
  }

  const t2Hit =
    trade.target1Hit &&
    trade.target2 != null &&
    price >= trade.target2 &&
    !(trailRiding && ATR_TRAIL_REPLACES_T2);

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
    highWaterMark,
    trailAdvanceTo,
    earningsDue,
    daysToEarnings,
  };
};

/**
 * Fields to set when Target 1 is hit: book half (record price), trail the SL (pure).
 * With an entry-time ATR the initial trail is max(entry, T1 price − ATR_TRAIL_MULT × atr14)
 * — already above entry when the setup is tight; without one it trails to entry (legacy).
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
  slTrailedTo: isAtrTrailActive(trade)
    ? round2(Math.max(trade.entryPrice, exitPrice - ATR_TRAIL_MULT * trade.atr14))
    : trade.entryPrice,
});

/**
 * Fields to set when closing a trade fully (pure).
 *
 * When T1 was hit, realized P&L blends TWO actual legs — target1Shares sold at
 * target1ExitPrice, and the remaining shares sold at this final exitPrice — rather than
 * pricing the entire original position off only the final exit (which discards the
 * profit genuinely locked in at T1). Costs are estimated per leg too: booking half at T1
 * is a real separate sell order with its own brokerage/STT, not one blended trade.
 *
 * @param {object} trade - Trade
 * @param {number} exitPrice - Exit price for the remaining (non-T1) shares
 * @param {string} exitReason - One of EXIT_REASONS
 * @param {Date} [now] - Reference time
 * @returns {object} Close update incl. realized P&L
 */
export const computeCloseFields = (trade, exitPrice, exitReason, now = new Date()) => {
  const { hasT1, t1Shares, remainingShares } = splitT1Legs(trade);
  const t1Pnl = hasT1 ? round2((trade.target1ExitPrice - trade.entryPrice) * t1Shares) : 0;
  const finalPnl = round2((exitPrice - trade.entryPrice) * remainingShares);
  const realizedPnl = round2(t1Pnl + finalPnl);
  const realizedPnlPct =
    trade.capitalDeployed > 0 ? round2((realizedPnl / trade.capitalDeployed) * 100) : 0;

  // realizedPnl stays gross (continuity with the existing record); netPnl carries the
  // cost-adjusted truth the go-live gate judges.
  const t1Costs = hasT1
    ? estimateTradeCosts(trade.entryPrice, trade.target1ExitPrice, t1Shares, 'DELIVERY').total
    : 0;
  const finalCosts = estimateTradeCosts(trade.entryPrice, exitPrice, remainingShares, 'DELIVERY').total;
  const totalCosts = round2(t1Costs + finalCosts);
  const netPnl = round2(realizedPnl - totalCosts);

  return {
    status: TRADE_STATUSES.CLOSED,
    currentPrice: exitPrice,
    exitPrice,
    exitDate: now,
    realizedPnl,
    realizedPnlPct,
    estCosts: totalCosts,
    netPnl,
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
 * Auto-open a PAPER trade from a BUY signal (opt-in, paper-mode only — never a real order).
 * Gated and de-duplicated so it can't over-trade: paper mode + autoPaperTrade flag on, a
 * positive size, no existing open trade for the symbol, and the live max-positions /
 * max-capital guards re-checked at open time. Entry is the signal's entry price. Once open,
 * the standard position monitor manages it to exit (SL/T1/T2 + the max-hold time exit).
 *
 * @param {object} signal - Saved BUY Signal (entryZone, stopLoss, target1, target2, shares, ...)
 * @param {object} config - Config doc (paperTradeMode, autoPaperTrade, capital)
 * @returns {Promise<object|null>} The created paper Trade, or null if skipped
 */
// Serialize auto-opens process-wide. A scan processes BUYs concurrently and calls this
// fire-and-forget, so a plain check-then-create races: every call reads "<3 open" before
// any commits, blowing past MAX_OPEN_TRADES / the capital cap. Chaining each call onto the
// previous makes the guard + create atomic relative to other auto-opens.
let _autoOpenChain = Promise.resolve();
export const autoOpenPaperTrade = (signal, config) => {
  const next = _autoOpenChain.then(() => openPaperTradeFromSignal(signal, config));
  _autoOpenChain = next.then(() => {}, () => {}); // keep the chain alive on success or error
  return next;
};

const openPaperTradeFromSignal = async (signal, config) => {
  if (!config?.paperTradeMode || !config?.autoPaperTrade) return null;
  if (signal?.verdict !== VERDICTS.BUY) return null;

  const symbol = signal.symbol;
  const entryPrice = signal.entryZone?.high ?? signal.entryZone?.low;
  // Re-size against THIS user's own capital/risk% — the Signal's own shares/capitalDeployed
  // are illustrative only (sized against a shared reference capital, not any one user's).
  const capital = config.capital ?? 1_000_000;
  const riskPct = config.riskPercentage ?? DEFAULT_RISK_PCT;
  const riskPerShare = Math.max(entryPrice - signal.stopLoss, 0.01);
  const shares = Math.max(Math.floor((capital * (riskPct / 100)) / riskPerShare), 0);
  if (!(shares > 0) || !(entryPrice > 0) || !(signal.stopLoss > 0) || !(signal.target1 > 0)) {
    return null;
  }

  // No second paper trade for a symbol already held.
  if (await Trade.exists({ userId: config.userId, symbol, status: TRADE_STATUSES.OPEN })) return null;

  // Re-check capital guards at open time (the signal passed them when created, but other
  // trades may have opened since).
  const open = await Trade.find({ userId: config.userId, status: TRADE_STATUSES.OPEN })
    .select('capitalDeployed sector')
    .lean();
  const maxOpenTrades = config.maxOpenTrades ?? MAX_OPEN_TRADES;
  if (open.length >= maxOpenTrades) {
    logger.info(`Auto paper trade skipped (${maxOpenTrades} open): ${symbol}`);
    return null;
  }
  const deployed = open.reduce((s, t) => s + (t.capitalDeployed ?? 0), 0);
  const newDeploy = round2(shares * entryPrice);

  // Regime-tiered deployment ceiling (mirrors resolveGuards; mode from signal creation).
  const mode = signal.marketContext?.marketMode;
  const maxCapitalDeployedPct = config.maxCapitalDeployedPct ?? MAX_CAPITAL_DEPLOYED_PCT;
  const capPct = Math.min(maxCapitalDeployedPct, DEPLOYMENT_CAP_BY_MODE[mode] ?? maxCapitalDeployedPct);
  if (deployed + newDeploy > capital * (capPct / 100)) {
    logger.info(`Auto paper trade skipped (${capPct}% deployment cap, ${mode ?? 'no'} mode): ${symbol}`);
    return null;
  }

  // Sector concentration cap: max positions AND max share of capital per sector.
  // 'Unknown' from the stock master counts as unclassified (exempt, but logged).
  let sector = signal.sector ?? null;
  if (!sector) {
    const stock = await Stock.findOne({ symbol }).select('sector').lean();
    sector = stock?.sector ?? null;
  }
  if (sector === 'Unknown') sector = null;
  if (sector) {
    const inSector = open.filter((t) => t.sector === sector);
    const sectorDeployed = inSector.reduce((s, t) => s + (t.capitalDeployed ?? 0), 0);
    if (inSector.length >= MAX_POSITIONS_PER_SECTOR) {
      logger.info(
        `Auto paper trade skipped (sector cap ${inSector.length}/${MAX_POSITIONS_PER_SECTOR} ${sector}): ${symbol}`
      );
      return null;
    }
    if (sectorDeployed + newDeploy > capital * (MAX_SECTOR_DEPLOYED_PCT / 100)) {
      logger.info(
        `Auto paper trade skipped (${sector} at ₹${Math.round(sectorDeployed)} + ₹${Math.round(newDeploy)} > ${MAX_SECTOR_DEPLOYED_PCT}% of capital): ${symbol}`
      );
      return null;
    }
  } else {
    logger.warn(`Auto paper trade for ${symbol} has no sector — exempt from sector cap`);
  }

  const trade = await logTrade({
    userId: config.userId,
    symbol,
    entryPrice,
    shares,
    stopLoss: signal.stopLoss,
    target1: signal.target1,
    target2: signal.target2,
    signalId: signal._id,
    atr14: signal.indicators?.atr ?? null,
    sector,
    earningsTimestamp: signal.earningsTimestamp ?? null,
    source: 'AUTO',
    notes: `Auto paper trade from BUY (score ${signal.compositeScore ?? signal.simonsScore ?? '?'}, ${signal.confidence ?? '?'} confidence).`,
  });
  logger.info(`Auto paper trade opened: ${symbol}`, { shares, entryPrice });
  return trade;
};

/** True when an AUTO paper trade has been held past the max-hold window. */
function isPastMaxHold(trade) {
  const entryMs = new Date(trade.entryDate ?? trade.createdAt).getTime();
  return Number.isFinite(entryMs) && (Date.now() - entryMs) / MS_PER_DAY >= MAX_PAPER_HOLD_DAYS;
}

/**
 * Mark Target 1 hit on a trade: book half, trail SL to entry, alert + emit.
 *
 * Atomic + guarded on {status:'OPEN', target1Hit:false} — this exact race (two callers
 * evaluating the same trade near-simultaneously) was diagnosed live 2026-07-31: TCS and
 * PAYTM both ended up with stopLoss silently trailed to breakeven while target1Hit
 * stayed false, because the old load→Object.assign→save() let one caller's T1-hit
 * transition get overwritten by the other's stale in-memory copy. findOneAndUpdate
 * matches 0 docs if another caller already handled T1, so exactly one caller ever
 * applies the transition.
 *
 * @param {object} trade - Mongoose Trade doc
 * @param {number} exitPrice - T1 fill price
 * @returns {Promise<object|null>} Updated trade, or null if a concurrent caller already hit T1
 */
export const markTarget1Hit = async (trade, exitPrice) => {
  const fields = computeTarget1Fields(trade, exitPrice);
  const updated = await Trade.findOneAndUpdate(
    { _id: trade._id, status: TRADE_STATUSES.OPEN, target1Hit: false },
    { $set: fields },
    { new: true }
  );
  if (!updated) {
    logger.warn(`markTarget1Hit: ${trade.symbol} T1 already handled by a concurrent update — skipping`);
    return null;
  }
  emitToUser(updated.userId, SOCKET_EVENTS.TRADE_TARGET1, updated.toObject());
  sendTarget1Hit(updated).catch((e) => logger.error('sendTarget1Hit failed', { error: e.message }));
  logger.info(`Target 1 hit: ${updated.symbol} @ ₹${exitPrice} — SL trailed to ₹${updated.slTrailedTo}`);
  return updated;
};

/**
 * Close a trade fully (manual or monitor-driven), compute realized P&L, alert + emit.
 *
 * Atomic + guarded on status:'OPEN' — the automated monitor (2-min cron and the 15-min
 * full-scan's own pass) and the manual PATCH /:id/close route can both reach a trade at
 * nearly the same instant; a plain load→mutate→save() here let one caller's close
 * silently lose fields to the other's stale in-memory copy (see markTarget1Hit's own
 * note — same race, same fix). findOneAndUpdate matches 0 docs if another caller closed
 * it first, so exactly one caller ever applies the close and its side effects.
 *
 * @param {object} trade - Mongoose Trade doc (only _id/symbol/userId are relied on directly;
 *   the rest is read by computeCloseFields from this same pre-race snapshot)
 * @param {object} opts - { exitPrice, exitReason, notes? }
 * @returns {Promise<object|null>} Closed trade, or null if a concurrent caller already closed it
 */
export const closeTrade = async (trade, { exitPrice, exitReason = EXIT_REASONS.MANUAL, notes }) => {
  const fields = computeCloseFields(trade, exitPrice, exitReason);
  if (notes) fields.notes = notes;
  const updated = await Trade.findOneAndUpdate(
    { _id: trade._id, status: TRADE_STATUSES.OPEN },
    { $set: fields },
    { new: true }
  );
  if (!updated) {
    logger.warn(`closeTrade: ${trade.symbol} already closed by a concurrent update — skipping`);
    return null;
  }
  // Notify only this user's own connected clients so their Positions UI removes the card
  emitToUser(updated.userId, SOCKET_EVENTS.TRADE_CLOSED, {
    _id: String(updated._id),
    symbol: updated.symbol,
    exitReason,
    exitPrice,
    realizedPnl: updated.realizedPnl,
  });
  if (exitReason === EXIT_REASONS.TARGET2) {
    emitToUser(updated.userId, SOCKET_EVENTS.TRADE_TARGET2, updated.toObject());
    sendTarget2Hit(updated).catch((e) => logger.error('sendTarget2Hit failed', { error: e.message }));
  }
  logger.info(`Trade closed: ${updated.symbol} ${exitReason} @ ₹${exitPrice}`, {
    realizedPnl: updated.realizedPnl,
  });
  return updated;
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

  if (decision.slHit) {
    const closed = await closeTrade(trade, { exitPrice: price, exitReason: EXIT_REASONS.STOPLOSS });
    if (closed) {
      emitToUser(closed.userId, SOCKET_EVENTS.TRADE_SL_WARNING, {
        tradeId: closed._id,
        symbol: closed.symbol,
        currentPrice: price,
        stopLoss: decision.effectiveSl,
        distancePct: 0,
        hit: true,
      });
      summary.slHit += 1;
    }
    return;
  }
  if (decision.t2Hit) {
    if (await closeTrade(trade, { exitPrice: price, exitReason: EXIT_REASONS.TARGET2 })) summary.t2 += 1;
    return;
  }
  // Max-hold time exit for AUTO paper trades: neither target nor stop hit in the window —
  // close at the current price so the paper record resolves (feeds calibration).
  if (trade.source === 'AUTO' && isPastMaxHold(trade)) {
    const notes = `${trade.notes ?? ''} | closed: max-hold (${MAX_PAPER_HOLD_DAYS}d) time exit`.trim();
    if (await closeTrade(trade, { exitPrice: price, exitReason: EXIT_REASONS.TIME_EXIT, notes })) {
      summary.timeExit = (summary.timeExit ?? 0) + 1;
    }
    return;
  }
  if (decision.t1Hit) {
    // markTarget1Hit is atomic + guarded (target1Hit:false) — whether it wins or loses
    // a race with a concurrent caller, the trade's true state is settled by *someone*
    // this cycle; re-checking slWarning/earnings below against our now-stale in-memory
    // copy would risk exactly the kind of lost-update this refactor exists to prevent,
    // so stop here and pick those up next cycle (2 min away — a trivial delay).
    if (await markTarget1Hit(trade, price)) summary.t1 += 1;
    return;
  }

  // Everything below is one atomic, guarded update — never a load→mutate→save() on this
  // trade — so it can never silently clobber (or be clobbered by) a concurrent close/T1
  // transition landing on the same document at the same instant.
  const setFields = {
    currentPrice: price,
    unrealizedPnl: decision.unrealizedPnl,
    unrealizedPnlPct: decision.unrealizedPnlPct,
    highWaterMark: decision.highWaterMark,
  };
  const maxFields = {};

  if (decision.trailAdvanceTo != null) {
    // Ratchet the ATR trail upward (post-T1). $max makes the ratchet itself race-safe
    // even without the target1Hit:true guard below — a stale, lower proposal from a
    // slow concurrent reader can never move it backwards. No alert — this is routine
    // maintenance; the SL-warning / close paths speak when it matters.
    setFields.slTrailed = true;
    maxFields.slTrailedTo = decision.trailAdvanceTo;
    summary.trailAdvanced = (summary.trailAdvanced ?? 0) + 1;
  } else if (decision.slWarning && notThrottled(trade)) {
    setFields.lastSlWarningAt = new Date();
    emitToUser(trade.userId, SOCKET_EVENTS.TRADE_SL_WARNING, {
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
    setFields.earningsAlertSent = true;
    emitToUser(trade.userId, SOCKET_EVENTS.TRADE_EARNINGS, {
      symbol: trade.symbol,
      daysToEarnings: decision.daysToEarnings,
    });
    sendEarningsReminder({ ...trade.toObject(), daysToEarnings: decision.daysToEarnings }).catch(
      (e) => logger.error('sendEarningsReminder failed', { error: e.message })
    );
    summary.earnings += 1;
  }

  const update = { $set: setFields };
  if (Object.keys(maxFields).length) update.$max = maxFields;
  await Trade.updateOne({ _id: trade._id, status: TRADE_STATUSES.OPEN }, update);
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
 * @param {string} [userId] - Scope to one user's trades; all users' when omitted (cron)
 * @returns {Promise<object>} Summary counters
 */
export const monitorOpenTrades = async (priceMap = null, userId = null) => {
  const open = await Trade.find({ status: TRADE_STATUSES.OPEN, ...(userId ? { userId } : {}) });
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
