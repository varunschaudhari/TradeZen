/**
 * @file orbScanner.js
 * @description Phase 1 intraday module — Opening Range Breakout scanner (JOB 14).
 *   Watches ONLY the EOD-prep shortlist (yesterday's gate-qualified candidates, max
 *   ORB_MAX_SYMBOLS) between 10:15 and 14:00 IST. A symbol triggers when its latest
 *   5m close clears the 60-min opening-range high by a small buffer, above VWAP, with
 *   time-adjusted relative volume ≥ ORB_REL_VOLUME_MIN. Rules only — no Claude.
 *
 *   Alerts are tagged EXPERIMENTAL and exist to BUILD A TRACK RECORD, not to be
 *   traded: every trigger is persisted to IntradaySignal with its bar-close→alert
 *   latency, and stampEodOutcomes() (JOB 15, 15:20 IST) records the same-session
 *   closing result. Data source is yfinance 5m bars (~15 min delayed) — survivable
 *   for ORB confirmation, and exactly what the latency column is there to measure.
 *
 *   Never places orders. Never creates Trade docs. Never touches the swing risk budget.
 *
 * @author TradeZen Team
 * @created 2026-07-07
 */

import mongoose from 'mongoose';
import IntradaySignal from '../models/IntradaySignal.js';
import ScanResult from '../models/ScanResult.js';
import {
  ORB_BREAKOUT_BUFFER_PCT,
  ORB_MAX_SYMBOLS,
  ORB_PAPER_CAPITAL,
  ORB_PAPER_RISK_PCT,
  ORB_PRESCREEN_TOLERANCE_PCT,
  ORB_REL_VOLUME_MIN,
  ORB_SCANNER_ENABLED,
  ORB_SCAN_END_MINUTES,
  ORB_SCAN_START_MINUTES,
  ORB_SETTLE_LOOKBACK_DAYS,
  ORB_SQUAREOFF_MINUTES,
  ORB_WINDOW_MINUTES,
} from '../config/constants.js';
import { fetchIntradayBars, fetchIntradaySnapshots } from './pythonBridge.js';
import { netAfterCosts } from './tradingCosts.js';
import { getQuotes } from './quoteService.js';
import { sendOrbAlert, sendOrbSquareOffReminder } from './notifier.js';
import { emitEvent, SOCKET_EVENTS } from '../socket/socketHandlers.js';
import { logger } from '../config/logger.js';

const round2 = (n) => Math.round(n * 100) / 100;
const BAR_MS = 5 * 60 * 1000; // snapshot bar timestamps are bar OPEN times

function getNowIST() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

/** Today's session date string (YYYY-MM-DD, IST). */
export function istSessionDate(ist = getNowIST()) {
  return ist.toISOString().slice(0, 10);
}

/** True when IST time is inside the ORB evaluation window (10:15–14:00). */
export function isInOrbWindow(ist = getNowIST()) {
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return mins >= ORB_SCAN_START_MINUTES && mins <= ORB_SCAN_END_MINUTES;
}

/**
 * ORB trigger decision for one snapshot (pure).
 * Requires: a complete opening range, a 5m close clearing the OR high by the noise
 * buffer, price above VWAP, and relative volume at/above the gate. relVolume null
 * (not enough prior-session history) fails closed — quality over quantity.
 * The `code` feeds per-cycle rejection telemetry (which condition binds most).
 *
 * @param {object} snap - IntradaySnapshot from Python /intraday
 * @returns {{ triggered: boolean, code: string, reason: string }}
 */
export function evaluateOrbSetup(snap) {
  if (!snap || snap.error) {
    return { triggered: false, code: 'NO_SNAPSHOT', reason: snap?.error ?? 'No snapshot' };
  }
  const { lastPrice, orHigh, orLow, orComplete, vwap, relVolume } = snap;
  if (!orComplete) {
    return { triggered: false, code: 'OR_INCOMPLETE', reason: 'Opening range not complete yet' };
  }
  if (lastPrice == null || orHigh == null || orLow == null) {
    return { triggered: false, code: 'MISSING_DATA', reason: 'Missing price / opening-range data' };
  }
  const breakoutLevel = orHigh * (1 + ORB_BREAKOUT_BUFFER_PCT / 100);
  if (lastPrice < breakoutLevel) {
    return {
      triggered: false,
      code: 'NO_BREAKOUT',
      reason: `No breakout: ${lastPrice} below ${round2(breakoutLevel)}`,
    };
  }
  if (vwap != null && lastPrice < vwap) {
    return { triggered: false, code: 'BELOW_VWAP', reason: `Below VWAP ${vwap} — weak breakout` };
  }
  if (relVolume == null || relVolume < ORB_REL_VOLUME_MIN) {
    return {
      triggered: false,
      code: 'WEAK_VOLUME',
      reason: `Relative volume ${relVolume ?? 'unknown'} < ${ORB_REL_VOLUME_MIN} — no participation`,
    };
  }
  return {
    triggered: true,
    code: 'TRIGGERED',
    reason: `Broke OR high ${orHigh} at ${lastPrice}, above VWAP, ${relVolume}× relative volume`,
  };
}

// ── Session opening-range cache + live-quote pre-screen ─────────────────────────
// OR levels are immutable once the range completes, so each symbol's levels are
// fetched at most once per session; later cycles pre-screen against a single batch
// live quote and only pay the heavy 5m-snapshot fetch for symbols actually near a
// breakout. Cuts yfinance traffic ~10× on a typical (quiet) day.
let _orCache = { sessionDate: null, levels: new Map() };

function orLevelsFor(sessionDate) {
  if (_orCache.sessionDate !== sessionDate) _orCache = { sessionDate, levels: new Map() };
  return _orCache.levels;
}

/** Reset the session OR cache (tests). */
export function resetOrbSessionCache() {
  _orCache = { sessionDate: null, levels: new Map() };
}

/**
 * Pre-screen decision (pure): true when the snapshot fetch can be SKIPPED because the
 * symbol cannot produce a surviving alert this cycle — we hold its immutable OR levels
 * and a genuinely live quote sits below the OR high by more than the tolerance (any
 * stale-bar trigger would be fade-skipped against that same quote anyway). Fails open
 * on any doubt: no cached levels, no quote, or a delayed-source quote → fetch.
 *
 * @param {{ orHigh:number }|undefined} cachedOr - Cached OR levels for the symbol
 * @param {{ price:number, source:string }|undefined} liveQuote - Batch quote
 * @returns {boolean}
 */
export function canSkipSnapshot(cachedOr, liveQuote) {
  if (!(cachedOr?.orHigh > 0) || liveQuote?.price == null) return false;
  if (liveQuote.source !== 'YAHOO_LIVE') return false; // delayed fallback can't pre-screen
  return liveQuote.price < cachedOr.orHigh * (1 - ORB_PRESCREEN_TOLERANCE_PCT / 100);
}

/**
 * Paper position size from the ORB virtual risk container (pure). Risk-based shares,
 * capped so deployment never exceeds the paper capital.
 *
 * @param {number} entry - Breakout (entry) price
 * @param {number} stop - Suggested stop (OR low)
 * @returns {{ shares: number, capitalDeployed: number }}
 */
export function computePaperPosition(entry, stop) {
  const riskPerShare = Math.max(entry - stop, 0.01);
  const byRisk = Math.floor((ORB_PAPER_CAPITAL * (ORB_PAPER_RISK_PCT / 100)) / riskPerShare);
  const byCapital = entry > 0 ? Math.floor(ORB_PAPER_CAPITAL / entry) : 0;
  const shares = Math.max(Math.min(byRisk, byCapital), 0);
  return { shares, capitalDeployed: round2(shares * entry) };
}

/** IST minutes-since-midnight for a bar's ISO open time. */
function barIstMinutes(isoTime) {
  const ist = new Date(new Date(isoTime).getTime() + 5.5 * 60 * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/**
 * Replay 5m bars after the breakout bar and decide the paper exit (pure).
 * Order per bar: square-off time first, then SL, then target — so a same-bar
 * SL/target tie settles as STOPLOSS (conservative). Gap opens fill at the open
 * (worse than the stop / better than the target), not at the level.
 *
 * @param {object[]} bars - Session bars [{time, open, high, low, close}], chronological
 * @param {Date|string} entryBarTime - Open time of the confirming (entry) bar
 * @param {number} entry - Entry price (breakout bar close)
 * @param {number} stop - Stop loss (OR low)
 * @param {number} target - Measured-move target
 * @param {boolean} [finalize=true] - Exhausted bars → square-off at last close.
 *   Pass false while the session is still running (leaves the trade open).
 * @returns {{ exitPrice: number, exitReason: string, exitTime: string }|null}
 */
export function simulateOrbExit(bars, entryBarTime, entry, stop, target, finalize = true) {
  const entryMs = new Date(entryBarTime).getTime();
  const later = (bars ?? []).filter((b) => new Date(b.time).getTime() > entryMs);
  if (!later.length) return null;

  for (const bar of later) {
    if (barIstMinutes(bar.time) >= ORB_SQUAREOFF_MINUTES) {
      return { exitPrice: bar.close, exitReason: 'SQUAREOFF', exitTime: bar.time };
    }
    if (bar.low <= stop) {
      return { exitPrice: Math.min(stop, bar.open), exitReason: 'STOPLOSS', exitTime: bar.time };
    }
    if (bar.high >= target) {
      return { exitPrice: Math.max(target, bar.open), exitReason: 'TARGET', exitTime: bar.time };
    }
  }
  if (!finalize) return null;
  const last = later[later.length - 1];
  return { exitPrice: last.close, exitReason: 'SQUAREOFF', exitTime: last.time };
}

/** Symbols on the latest EOD-prep shortlist (empty when none exists). */
async function getShortlistSymbols() {
  const prep = await ScanResult.findOne({ scanType: 'EOD_PREP' })
    .sort({ createdAt: -1 })
    .select('watchlist createdAt')
    .lean();
  return (prep?.watchlist ?? []).map((w) => w.symbol).slice(0, ORB_MAX_SYMBOLS);
}

/**
 * One ORB scan cycle. Never throws — returns a summary so the cron stays healthy.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.forceRun=false] - Bypass enabled/window guards (testing)
 * @returns {Promise<{ shortlist:number, evaluated:number, triggered:number, skipped?:string }>}
 */
export const runOrbScan = async ({ forceRun = false } = {}) => {
  const summary = { shortlist: 0, prescreened: 0, snapshots: 0, evaluated: 0, triggered: 0, rejections: {} };
  const reject = (code) => {
    summary.rejections[code] = (summary.rejections[code] ?? 0) + 1;
  };
  try {
    if (!forceRun && !ORB_SCANNER_ENABLED) return { ...summary, skipped: 'disabled' };
    if (!forceRun && !isInOrbWindow()) return { ...summary, skipped: 'outside 10:15–14:00 IST' };
    if (mongoose.connection.readyState !== 1) return { ...summary, skipped: 'db not connected' };

    const sessionDate = istSessionDate();
    const shortlist = await getShortlistSymbols();
    summary.shortlist = shortlist.length;
    if (!shortlist.length) return { ...summary, skipped: 'no EOD-prep shortlist' };

    // One ORB alert per symbol per session — drop what's already been alerted today.
    // MANUAL logs are excluded: a hand-logged trade must not suppress the scanner.
    const alerted = await IntradaySignal.find({ sessionDate, source: { $ne: 'MANUAL' } })
      .select('symbol')
      .lean();
    const done = new Set(alerted.map((a) => a.symbol));
    const symbols = shortlist.filter((s) => !done.has(s));
    if (!symbols.length) return summary;

    // One batch quote per cycle — powers the pre-screen here AND the fade check at
    // alert time (quotes are cached ~15s, so this is the same price both places).
    const liveQuotes = await getQuotes(symbols).catch(() => ({}));
    const orLevels = orLevelsFor(sessionDate);
    const toFetch = symbols.filter((s) => !canSkipSnapshot(orLevels.get(s), liveQuotes[s]));
    summary.prescreened = symbols.length - toFetch.length;
    summary.snapshots = toFetch.length;
    if (!toFetch.length) return summary;

    const snapshots = await fetchIntradaySnapshots(toFetch, ORB_WINDOW_MINUTES);

    for (const symbol of toFetch) {
      const snap = snapshots[symbol];
      // Pre-open or stale feed returns the PREVIOUS session — never alert on it.
      if (snap?.sessionDate !== sessionDate) {
        reject('STALE_SESSION');
        continue;
      }
      // OR levels are immutable once complete — cache so later cycles can pre-screen.
      if (snap.orComplete && snap.orHigh > 0) {
        orLevels.set(symbol, { orHigh: snap.orHigh, orLow: snap.orLow });
      }
      summary.evaluated += 1;

      const verdict = evaluateOrbSetup(snap);
      if (!verdict.triggered) {
        reject(verdict.code);
        continue;
      }

      // Phase 3 live confirmation: the 5m bar is ~15 min behind — check the
      // near-real-time price before alerting. If the breakout has already faded back
      // below the OR high, the entry is gone; skip instead of alerting a stale move.
      // No live quote (breaker open / off-hours) → proceed on bar close as before.
      const live = liveQuotes[symbol] ?? null;
      if (live?.price != null && live.source === 'YAHOO_LIVE' && live.price < snap.orHigh) {
        reject('FADED_LIVE');
        logger.info(`ORB breakout faded for ${symbol} — skipping alert`, {
          barClose: snap.lastPrice,
          livePrice: live.price,
          orHigh: snap.orHigh,
        });
        continue;
      }

      const now = new Date();
      const barOpen = snap.lastBarTime ? new Date(snap.lastBarTime) : null;
      const orHeight = round2(snap.orHigh - snap.orLow);
      const paper = computePaperPosition(snap.lastPrice, snap.orLow);
      let signal;
      try {
        // The unique {symbol, sessionDate} index is the atomic one-shot claim.
        signal = await IntradaySignal.create({
          symbol,
          sessionDate,
          setupType: 'ORB',
          orHigh: snap.orHigh,
          orLow: snap.orLow,
          orWindowMinutes: ORB_WINDOW_MINUTES,
          breakoutPrice: snap.lastPrice,
          vwap: snap.vwap,
          relVolume: snap.relVolume,
          suggestedStop: snap.orLow,
          suggestedTarget: round2(snap.orHigh + orHeight), // measured-move projection
          barTime: barOpen,
          alertedAt: now,
          alertLatencyMs: barOpen ? Math.max(0, now - (barOpen.getTime() + BAR_MS)) : null,
          shares: paper.shares,
          capitalDeployed: paper.capitalDeployed,
          livePrice: live?.price ?? null,
          quoteSource: live?.source ?? null,
        });
      } catch (err) {
        if (err.code === 11000) continue; // another cycle claimed it first
        throw err;
      }

      summary.triggered += 1;
      emitEvent(SOCKET_EVENTS.INTRADAY_ORB, {
        signalId: signal._id,
        symbol,
        sessionDate,
        price: snap.lastPrice,
        orHigh: snap.orHigh,
        orLow: snap.orLow,
        vwap: snap.vwap,
        relVolume: snap.relVolume,
        suggestedStop: signal.suggestedStop,
        suggestedTarget: signal.suggestedTarget,
        timestamp: now.toISOString(),
      });
      await sendOrbAlert(signal); // notifier never throws
      logger.info(`ORB breakout alert for ${symbol}`, {
        reason: verdict.reason,
        latencyMs: signal.alertLatencyMs,
      });
    }
    return summary;
  } catch (err) {
    logger.error('runOrbScan failed', { error: err.message });
    return { ...summary, skipped: err.message };
  }
};

/**
 * JOB 15 (15:20 IST): settle pending ORB paper trades by 5m bar replay. Also picks up
 * sessions missed while the server was down, as long as 5m bars still exist (~5 days).
 * Never throws — unsettleable signals stay pending and retry next run.
 *
 * @returns {Promise<{ settled: number, wins: number, losses: number, paperPnl: number }>}
 */
export const settlePaperTrades = async () => {
  const summary = { settled: 0, wins: 0, losses: 0, paperPnl: 0 };
  try {
    if (mongoose.connection.readyState !== 1) return summary;
    const since = new Date(Date.now() - ORB_SETTLE_LOOKBACK_DAYS * 86_400_000);
    const pending = await IntradaySignal.find({
      exitReason: null,
      createdAt: { $gte: since },
    }).lean();
    if (!pending.length) return summary;

    const barsBySymbol = await fetchIntradayBars([...new Set(pending.map((s) => s.symbol))]);
    for (const sig of pending) {
      const all = barsBySymbol[sig.symbol]?.bars ?? [];
      // Replay only the signal's own session (bars span ~5 sessions).
      const sessionBars = all.filter((b) => String(b.time).slice(0, 10) === sig.sessionDate);
      const exit = simulateOrbExit(
        sessionBars,
        sig.barTime,
        sig.breakoutPrice,
        sig.suggestedStop,
        sig.suggestedTarget
      );
      if (!exit || !sig.breakoutPrice) continue;

      const riskPerShare = Math.max(sig.breakoutPrice - sig.suggestedStop, 0.01);
      const grossPnl = round2((sig.shares ?? 0) * (exit.exitPrice - sig.breakoutPrice));
      // Judge the record NET of real intraday charges + slippage — thin ORB edges
      // usually die exactly here, and paper is where that must show up.
      const { netPnl, costs } = netAfterCosts(
        grossPnl, sig.breakoutPrice, exit.exitPrice, sig.shares ?? 0, 'INTRADAY'
      );
      await IntradaySignal.updateOne(
        { _id: sig._id, exitReason: null },
        {
          $set: {
            exitPrice: exit.exitPrice,
            exitReason: exit.exitReason,
            exitTime: new Date(exit.exitTime),
            rMultiple: round2((exit.exitPrice - sig.breakoutPrice) / riskPerShare),
            grossPnl,
            estCosts: costs.total,
            paperPnl: netPnl,
            resultPct: round2(((exit.exitPrice - sig.breakoutPrice) / sig.breakoutPrice) * 100),
            eodPrice: sessionBars.length ? sessionBars[sessionBars.length - 1].close : null,
            settledAt: new Date(),
          },
        }
      );
      summary.settled += 1;
      summary.paperPnl = round2(summary.paperPnl + netPnl);
      if (netPnl > 0) summary.wins += 1;
      else summary.losses += 1;
    }
    if (summary.settled) logger.info('ORB paper trades settled', summary);
    return summary;
  } catch (err) {
    logger.error('settlePaperTrades failed', { error: err.message });
    return summary;
  }
};

/**
 * JOB 16 (15:00 IST): square-off reminder for today's ORB paper trades — a nudge for
 * anyone mirroring the experimental alerts manually. Returns the count reminded about.
 *
 * @returns {Promise<{ open: number }>}
 */
export const remindSquareOff = async () => {
  try {
    if (mongoose.connection.readyState !== 1) return { open: 0 };
    const open = await IntradaySignal.find({
      sessionDate: istSessionDate(),
      exitReason: null,
    }).lean();
    if (open.length) await sendOrbSquareOffReminder(open);
    return { open: open.length };
  } catch (err) {
    logger.error('remindSquareOff failed', { error: err.message });
    return { open: 0 };
  }
};
