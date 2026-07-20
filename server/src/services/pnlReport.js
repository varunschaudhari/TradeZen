/**
 * @file pnlReport.js
 * @description Daily + overall P&L across both lanes, on one IST-day axis:
 *     swing    — this user's closed Trades, NET of costs (docs predating the netPnl
 *                field are netted on the fly, same as the go-live gate)
 *     intraday — settled IntradaySignal paper results (paperPnl is already net);
 *                the shared research lane, all sources (scanner + manual)
 *   Swing days key on the exit date converted to IST; intraday days key on the
 *   sessionDate string. `overall` always spans the FULL history, independent of how
 *   many day rows the caller asked for.
 * @author TradeZen Team
 * @created 2026-07-15
 */

import IntradaySignal from '../models/IntradaySignal.js';
import Trade from '../models/Trade.js';
import { TRADE_STATUSES } from '../config/constants.js';
import { netAfterCosts } from './tradingCosts.js';

const round2 = (n) => Math.round(n * 100) / 100;

/** IST calendar day (YYYY-MM-DD) for a Date/ISO value. */
export function istDay(value) {
  return new Date(new Date(value).getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Merge per-trade results from both lanes into day rows + overall totals (pure).
 *
 * @param {Array<{net:number, day:string}>} swing - Net swing results keyed to IST days
 * @param {Array<{net:number, day:string}>} intraday - Net intraday results
 * @param {number} [days=30] - Max day rows returned (newest first)
 * @returns {{ days:object[], overall:object, today:object }}
 */
export function buildDailyPnl(swing, intraday, days = 30) {
  const byDay = new Map();
  const rowFor = (day) => {
    if (!byDay.has(day)) {
      byDay.set(day, { date: day, swingNet: 0, swingTrades: 0, intradayNet: 0, intradayTrades: 0 });
    }
    return byDay.get(day);
  };
  for (const r of swing) {
    const row = rowFor(r.day);
    row.swingNet += r.net;
    row.swingTrades += 1;
  }
  for (const r of intraday) {
    const row = rowFor(r.day);
    row.intradayNet += r.net;
    row.intradayTrades += 1;
  }

  const rows = [...byDay.values()]
    .sort((a, b) => (a.date < b.date ? 1 : -1)) // newest first
    .map((r) => ({
      ...r,
      swingNet: round2(r.swingNet),
      intradayNet: round2(r.intradayNet),
      totalNet: round2(r.swingNet + r.intradayNet),
    }));

  const overall = {
    swingNet: round2(swing.reduce((s, r) => s + r.net, 0)),
    swingTrades: swing.length,
    intradayNet: round2(intraday.reduce((s, r) => s + r.net, 0)),
    intradayTrades: intraday.length,
  };
  overall.totalNet = round2(overall.swingNet + overall.intradayNet);

  const todayKey = istDay(Date.now());
  const today =
    rows.find((r) => r.date === todayKey) ?? {
      date: todayKey,
      swingNet: 0,
      swingTrades: 0,
      intradayNet: 0,
      intradayTrades: 0,
      totalNet: 0,
    };

  return { days: rows.slice(0, days), overall, today };
}

/**
 * Full P&L report for a user: fetch both lanes, aggregate by IST day.
 *
 * @param {string} userId - Owner of the swing trades (intraday lane is shared)
 * @param {number} [days=30] - Max day rows
 * @returns {Promise<{ days:object[], overall:object, today:object }>}
 */
export const getPnlReport = async (userId, days = 30) => {
  const [closed, settled] = await Promise.all([
    Trade.find({ userId, status: TRADE_STATUSES.CLOSED })
      .select('entryPrice exitPrice shares realizedPnl netPnl exitDate createdAt')
      .lean(),
    IntradaySignal.find({ exitReason: { $ne: null } })
      .select('paperPnl sessionDate')
      .lean(),
  ]);

  const swing = closed
    .filter((t) => t.exitPrice != null && t.realizedPnl != null)
    .map((t) => ({
      net:
        t.netPnl ??
        netAfterCosts(t.realizedPnl, t.entryPrice, t.exitPrice, t.shares, 'DELIVERY').netPnl,
      day: istDay(t.exitDate ?? t.createdAt),
    }));
  const intraday = settled.map((s) => ({ net: s.paperPnl ?? 0, day: s.sessionDate }));

  return buildDailyPnl(swing, intraday, days);
};
