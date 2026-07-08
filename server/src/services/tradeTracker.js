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
import { netAfterCosts } from './tradingCosts.js';
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
 * Evaluate an open trade against the current price (pure).
 * Uses the trailed stop once Target 1 has been hit: with an entry-time ATR the stop
 * ratchets to highWaterMark − ATR_TRAIL_MULT × atr14 (never below entry, never down);
 * without one it stays at the legacy trail-to-entry level. When the ATR trail is riding
 * and ATR_TRAIL_REPLACES_T2 is on, T2 no longer closes the position — the trail is the
 * exit, so winners can run past the fixed target.
 *
 * @param {object} trade - Trade document/object
 * @param {number} price - Current price
 * @param {number} [nowMs] - Reference epoch ms
 * @returns {object} Decision: pnl, slHit, slWarning, t1Hit, t2Hit, highWaterMark, trailAdvanceTo, …
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
  // realizedPnl stays gross (continuity with the existing record); netPnl carries the
  // cost-adjusted truth the go-live gate judges.
  const { netPnl, costs } = netAfterCosts(
    realizedPnl, trade.entryPrice, exitPrice, trade.shares, 'DELIVERY'
  );
  return {
    status: TRADE_STATUSES.CLOSED,
    currentPrice: exitPrice,
    exitPrice,
    exitDate: now,
    realizedPnl,
    realizedPnlPct,
    estCosts: costs.total,
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
  const shares = signal.shares ?? 0;
  const entryPrice = signal.entryZone?.high ?? signal.entryZone?.low;
  if (!(shares > 0) || !(entryPrice > 0) || !(signal.stopLoss > 0) || !(signal.target1 > 0)) {
    return null;
  }

  // No second paper trade for a symbol already held.
  if (await Trade.exists({ symbol, status: TRADE_STATUSES.OPEN })) return null;

  // Re-check capital guards at open time (the signal passed them when created, but other
  // trades may have opened since).
  const open = await Trade.find({ status: TRADE_STATUSES.OPEN })
    .select('capitalDeployed sector')
    .lean();
  if (open.length >= MAX_OPEN_TRADES) {
    logger.info(`Auto paper trade skipped (${MAX_OPEN_TRADES} open): ${symbol}`);
    return null;
  }
  const capital = config.capital ?? 1_000_000;
  const deployed = open.reduce((s, t) => s + (t.capitalDeployed ?? 0), 0);
  const newDeploy = signal.capitalDeployed ?? shares * entryPrice;

  // Regime-tiered deployment ceiling (mirrors resolveGuards; mode from signal creation).
  const mode = signal.marketContext?.marketMode;
  const capPct = Math.min(MAX_CAPITAL_DEPLOYED_PCT, DEPLOYMENT_CAP_BY_MODE[mode] ?? MAX_CAPITAL_DEPLOYED_PCT);
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
 * @param {object} trade - Mongoose Trade doc
 * @param {number} exitPrice - T1 fill price
 * @returns {Promise<object>} Updated trade
 */
export const markTarget1Hit = async (trade, exitPrice) => {
  Object.assign(trade, computeTarget1Fields(trade, exitPrice));
  await trade.save();
  emitEvent(SOCKET_EVENTS.TRADE_TARGET1, trade.toObject());
  sendTarget1Hit(trade).catch((e) => logger.error('sendTarget1Hit failed', { error: e.message }));
  logger.info(`Target 1 hit: ${trade.symbol} @ ₹${exitPrice} — SL trailed to ₹${trade.slTrailedTo}`);
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
  // Always emit TRADE_CLOSED so the Positions UI removes the card immediately
  emitEvent(SOCKET_EVENTS.TRADE_CLOSED, {
    _id: String(trade._id),
    symbol: trade.symbol,
    exitReason,
    exitPrice,
    realizedPnl: trade.realizedPnl,
  });
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
  trade.highWaterMark = decision.highWaterMark;

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
  // Max-hold time exit for AUTO paper trades: neither target nor stop hit in the window —
  // close at the current price so the paper record resolves (feeds calibration).
  if (trade.source === 'AUTO' && isPastMaxHold(trade)) {
    trade.notes = `${trade.notes ?? ''} | closed: max-hold (${MAX_PAPER_HOLD_DAYS}d) time exit`.trim();
    await closeTrade(trade, { exitPrice: price, exitReason: EXIT_REASONS.MANUAL });
    summary.timeExit = (summary.timeExit ?? 0) + 1;
    return;
  }
  if (decision.t1Hit) {
    await markTarget1Hit(trade, price);
    summary.t1 += 1;
  } else if (decision.trailAdvanceTo != null) {
    // Ratchet the ATR trail upward (post-T1). No alert — this is routine maintenance;
    // the SL-warning / close paths speak when it matters.
    trade.slTrailed = true;
    trade.slTrailedTo = decision.trailAdvanceTo;
    summary.trailAdvanced = (summary.trailAdvanced ?? 0) + 1;
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
