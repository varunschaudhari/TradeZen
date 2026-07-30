/**
 * @file orbScanner.js
 * @description Intraday engine (JOB 14) — THREE independent strategies, each tradeable
 *   LONG or SHORT, evaluated every 5 minutes against the intraday module's OWN shortlist
 *   (intradayUniverse.js — liquid large-cap stocks ranked by intraday suitability, NOT
 *   the swing EOD-prep list; see that file for why the two must never be coupled again):
 *
 *     ORB                    — price clears the 60-min opening range (high=long, low=short)
 *                               by a noise buffer, confirmed by VWAP side + relative volume.
 *     VWAP_REVERSION         — price extends beyond a stdev band around the running VWAP
 *                               and fades back toward it (the opposite thesis to ORB).
 *     MOMENTUM_CONTINUATION  — price pulls back to EMA(9) within an established intraday
 *                               trend (day range clearly on one side of EMA9), continuing.
 *
 *   All three: rules only (no Claude), EXPERIMENTAL, paper-tracked in IntradaySignal from
 *   trigger to settlement. Never places orders. Never creates Trade docs. Never touches
 *   the swing risk budget.
 * @author TradeZen Team
 * @created 2026-07-07
 * @lastModified 2026-07-09
 */

import mongoose from 'mongoose';
import MarketState from '../models/MarketState.js';
import IntradaySignal from '../models/IntradaySignal.js';
import {
  MOMENTUM_MIN_TREND_PCT,
  MOMENTUM_PULLBACK_MAX_PCT,
  MOMENTUM_STOP_BUFFER_PCT,
  MOMENTUM_STOP_VOL_MULT,
  MOMENTUM_TARGET_R_MULT,
  ORB_BREAKOUT_BUFFER_PCT,
  ORB_PAPER_CAPITAL,
  ORB_PAPER_RISK_PCT,
  ORB_REL_VOLUME_MIN,
  ORB_SCANNER_ENABLED,
  ORB_SCAN_END_MINUTES,
  ORB_SCAN_START_MINUTES,
  ORB_SETTLE_LOOKBACK_DAYS,
  ORB_SQUAREOFF_MINUTES,
  ORB_WINDOW_MINUTES,
  VWAP_REVERSION_ENTRY_BAND_MULT,
  VWAP_REVERSION_STOP_BAND_MULT,
  VWAP_REVERSION_TARGET_BUFFER_PCT,
  INTRADAY_TARGET_COST_SAFETY_MULT,
  INTRADAY_MIN_RISK_TO_COST_RATIO,
} from '../config/constants.js';
import { getIntradayShortlistSymbols } from './intradayUniverse.js';
import { fetchIntradayBars, fetchIntradaySnapshots } from './pythonBridge.js';
import { netAfterCosts, estimateRoundTripCostPct } from './tradingCosts.js';
import { getQuotes } from './quoteService.js';
import { sendOrbAlert, sendOrbSquareOffReminder } from './notifier.js';
import { emitGlobal, SOCKET_EVENTS } from '../socket/socketHandlers.js';
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

/** True when IST time is inside the shared intraday evaluation window (10:15–14:00). */
export function isInOrbWindow(ist = getNowIST()) {
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return mins >= ORB_SCAN_START_MINUTES && mins <= ORB_SCAN_END_MINUTES;
}

// ── Strategy 1: ORB (opening-range breakout / breakdown) ────────────────────────────
/** One side's ORB condition (pure helper — not exported, used by evaluateOrbSetup). */
function orbSide(direction, snap, breakoutLevel, breakdownLevel) {
  const { lastPrice, orHigh, orLow, vwap, relVolume } = snap;
  const isLong = direction === 'LONG';
  const level = isLong ? breakoutLevel : breakdownLevel;
  const crossed = isLong ? lastPrice >= level : lastPrice <= level;
  if (!crossed) {
    return {
      ok: false,
      code: 'NO_BREAKOUT',
      reason: `No ${isLong ? 'breakout' : 'breakdown'}: ${lastPrice} vs ${round2(level)}`,
    };
  }
  const vwapOk = vwap == null || (isLong ? lastPrice >= vwap : lastPrice <= vwap);
  if (!vwapOk) {
    return {
      ok: false,
      code: 'BELOW_VWAP',
      reason: `${isLong ? 'Below' : 'Above'} VWAP ${vwap} — weak ${isLong ? 'breakout' : 'breakdown'}`,
    };
  }
  if (relVolume == null || relVolume < ORB_REL_VOLUME_MIN) {
    return {
      ok: false,
      code: 'WEAK_VOLUME',
      reason: `Relative volume ${relVolume ?? 'unknown'} < ${ORB_REL_VOLUME_MIN} — no participation`,
    };
  }
  return {
    ok: true,
    code: 'TRIGGERED',
    reason: isLong
      ? `Broke OR high ${orHigh} at ${lastPrice}, above VWAP, ${relVolume}× relative volume`
      : `Broke OR low ${orLow} at ${lastPrice}, below VWAP, ${relVolume}× relative volume`,
  };
}

/**
 * ORB trigger decision for one snapshot (pure). Checks BOTH a breakout (LONG, clears OR
 * high) and a breakdown (SHORT, clears OR low) — at most one can cross its price level
 * at a time since orHigh > orLow. Requires a complete opening range, the level crossed by
 * the noise buffer, price on the confirming side of VWAP, and relative volume at/above
 * the gate. relVolume null (not enough prior-session history) fails closed.
 *
 * @param {object} snap - IntradaySnapshot from Python /intraday
 * @returns {{ triggered: boolean, direction: 'LONG'|'SHORT'|null, code: string, reason: string }}
 */
export function evaluateOrbSetup(snap) {
  if (!snap || snap.error) {
    return { triggered: false, direction: null, code: 'NO_SNAPSHOT', reason: snap?.error ?? 'No snapshot' };
  }
  const { lastPrice, orHigh, orLow, orComplete } = snap;
  if (!orComplete) {
    return { triggered: false, direction: null, code: 'OR_INCOMPLETE', reason: 'Opening range not complete yet' };
  }
  if (lastPrice == null || orHigh == null || orLow == null) {
    return { triggered: false, direction: null, code: 'MISSING_DATA', reason: 'Missing price / opening-range data' };
  }

  const breakoutLevel = orHigh * (1 + ORB_BREAKOUT_BUFFER_PCT / 100);
  const breakdownLevel = orLow * (1 - ORB_BREAKOUT_BUFFER_PCT / 100);

  const long = orbSide('LONG', snap, breakoutLevel, breakdownLevel);
  if (long.ok) return { triggered: true, direction: 'LONG', code: long.code, reason: long.reason };
  const short = orbSide('SHORT', snap, breakoutLevel, breakdownLevel);
  if (short.ok) return { triggered: true, direction: 'SHORT', code: short.code, reason: short.reason };

  // Neither side triggered — report whichever side actually crossed its price level (the
  // more informative diagnostic); both NO_BREAKOUT (inside the range) is the common case.
  const primary = long.code !== 'NO_BREAKOUT' ? long : short.code !== 'NO_BREAKOUT' ? short : long;
  return { triggered: false, direction: null, code: primary.code, reason: primary.reason };
}

/** ORB stop/target for a triggered direction (pure). Stop = opposite OR edge; target = measured move. */
export function orbLevels(snap, direction) {
  const orHeight = round2(snap.orHigh - snap.orLow);
  return direction === 'LONG'
    ? { stop: snap.orLow, target: round2(snap.orHigh + orHeight) }
    : { stop: snap.orHigh, target: round2(snap.orLow - orHeight) };
}

// ── Strategy 2: VWAP mean-reversion ──────────────────────────────────────────────────
/**
 * VWAP mean-reversion trigger decision for one snapshot (pure). Fades an overextension:
 * price must have cleared a stdev band around the running VWAP, on the expectation it
 * reverts back toward VWAP — the opposite thesis to ORB (which rides a breakout AWAY
 * from a level; this fades a move away from a level back toward it).
 *
 * @param {object} snap - IntradaySnapshot from Python /intraday (needs vwap + vwapStdDev)
 * @returns {{ triggered: boolean, direction: 'LONG'|'SHORT'|null, code: string, reason: string }}
 */
export function evaluateVwapReversionSetup(snap) {
  if (!snap || snap.error) {
    return { triggered: false, direction: null, code: 'NO_SNAPSHOT', reason: snap?.error ?? 'No snapshot' };
  }
  const { lastPrice, vwap, vwapStdDev, relVolume } = snap;
  if (lastPrice == null || vwap == null || vwapStdDev == null) {
    return { triggered: false, direction: null, code: 'MISSING_DATA', reason: 'VWAP or band width not available yet' };
  }
  if (!(vwapStdDev > 0)) {
    return { triggered: false, direction: null, code: 'NO_BAND', reason: 'VWAP band width is zero — no dispersion to fade' };
  }

  const upperBand = vwap + VWAP_REVERSION_ENTRY_BAND_MULT * vwapStdDev;
  const lowerBand = vwap - VWAP_REVERSION_ENTRY_BAND_MULT * vwapStdDev;

  const beyondBand = lastPrice <= lowerBand ? 'LONG' : lastPrice >= upperBand ? 'SHORT' : null;
  if (!beyondBand) {
    return {
      triggered: false,
      direction: null,
      code: 'INSIDE_BAND',
      reason: `Price ${lastPrice} inside VWAP band [${round2(lowerBand)}, ${round2(upperBand)}]`,
    };
  }
  if (relVolume == null || relVolume < ORB_REL_VOLUME_MIN) {
    return {
      triggered: false,
      direction: null,
      code: 'WEAK_VOLUME',
      reason: `Relative volume ${relVolume ?? 'unknown'} < ${ORB_REL_VOLUME_MIN} — no participation`,
    };
  }
  const band = beyondBand === 'LONG' ? lowerBand : upperBand;
  return {
    triggered: true,
    direction: beyondBand,
    code: 'TRIGGERED',
    reason: `Price ${lastPrice} extended ${beyondBand === 'LONG' ? 'below' : 'above'} the ${VWAP_REVERSION_ENTRY_BAND_MULT}σ band (${round2(band)}) around VWAP ${vwap} — fading back toward it`,
  };
}

/** VWAP-reversion stop/target for a triggered direction (pure). Stop further out on the
 * band; target sits just short of VWAP itself (reversion rarely needs to fully overshoot). */
export function vwapReversionLevels(snap, direction) {
  const { vwap, vwapStdDev } = snap;
  return direction === 'LONG'
    ? {
        stop: round2(vwap - VWAP_REVERSION_STOP_BAND_MULT * vwapStdDev),
        target: round2(vwap * (1 - VWAP_REVERSION_TARGET_BUFFER_PCT / 100)),
      }
    : {
        stop: round2(vwap + VWAP_REVERSION_STOP_BAND_MULT * vwapStdDev),
        target: round2(vwap * (1 + VWAP_REVERSION_TARGET_BUFFER_PCT / 100)),
      };
}

// ── Strategy 3: Momentum continuation ────────────────────────────────────────────────
/**
 * Momentum-continuation trigger decision for one snapshot (pure). Buys/sells a shallow
 * pullback to EMA(9) within an established intraday trend — trend direction is read from
 * which side of EMA9 today's range has extended further (a snapshot-only proxy for "has
 * this been an up day or a down day"), since evaluation runs off the aggregate snapshot,
 * not the full bar sequence, to keep the per-cycle Python cost fixed at one fetch for
 * all three strategies.
 *
 * @param {object} snap - IntradaySnapshot from Python /intraday (needs ema9, dayHigh, dayLow)
 * @returns {{ triggered: boolean, direction: 'LONG'|'SHORT'|null, code: string, reason: string }}
 */
export function evaluateMomentumSetup(snap) {
  if (!snap || snap.error) {
    return { triggered: false, direction: null, code: 'NO_SNAPSHOT', reason: snap?.error ?? 'No snapshot' };
  }
  const { lastPrice, ema9, dayHigh, dayLow, relVolume } = snap;
  if (lastPrice == null || !(ema9 > 0) || dayHigh == null || dayLow == null) {
    return { triggered: false, direction: null, code: 'MISSING_DATA', reason: 'EMA9 or day range not available yet' };
  }

  const distFromEmaPct = (Math.abs(lastPrice - ema9) / ema9) * 100;
  if (distFromEmaPct > MOMENTUM_PULLBACK_MAX_PCT) {
    return {
      triggered: false,
      direction: null,
      code: 'NOT_IN_PULLBACK_ZONE',
      reason: `Price ${distFromEmaPct.toFixed(2)}% from EMA9 — outside the ${MOMENTUM_PULLBACK_MAX_PCT}% pullback zone`,
    };
  }

  const upExtent = Math.max(0, dayHigh - ema9);
  const downExtent = Math.max(0, ema9 - dayLow);
  const trendPct = (Math.max(upExtent, downExtent) / ema9) * 100;
  if (trendPct < MOMENTUM_MIN_TREND_PCT) {
    return {
      triggered: false,
      direction: null,
      code: 'NO_TREND',
      reason: `Day range only ${trendPct.toFixed(2)}% from EMA9 — too flat to call a trend`,
    };
  }
  if (relVolume == null || relVolume < ORB_REL_VOLUME_MIN) {
    return {
      triggered: false,
      direction: null,
      code: 'WEAK_VOLUME',
      reason: `Relative volume ${relVolume ?? 'unknown'} < ${ORB_REL_VOLUME_MIN} — no participation`,
    };
  }

  const direction = upExtent >= downExtent ? 'LONG' : 'SHORT';
  return {
    triggered: true,
    direction,
    code: 'TRIGGERED',
    reason: `Pullback to EMA9 (${ema9}) within an established ${direction === 'LONG' ? 'up' : 'down'}trend (${trendPct.toFixed(2)}% day range), ${relVolume}× relative volume`,
  };
}

/** Momentum-continuation stop/target (pure). Stop scales with the session's own
 * realized volatility — day range so far ÷ bars elapsed, as % of price — rather than a
 * flat percentage; MOMENTUM_STOP_BUFFER_PCT is a floor, not the primary sizing, so the
 * stop only ever gets wider than that floor, never tighter (see MOMENTUM_STOP_VOL_MULT
 * for the backtest this was validated against). No natural measured-move for the
 * target, so it stays R-based off whatever the stop distance comes out to. */
export function momentumLevels(snap, direction) {
  const { lastPrice, dayHigh, dayLow, barsCount } = snap;
  const avgBarRangePct =
    barsCount > 0 && dayHigh != null && dayLow != null
      ? ((dayHigh - dayLow) / barsCount / lastPrice) * 100
      : 0;
  const stopPct = Math.max(MOMENTUM_STOP_VOL_MULT * avgBarRangePct, MOMENTUM_STOP_BUFFER_PCT);
  const buffer = (lastPrice * stopPct) / 100;
  const stop = direction === 'LONG' ? round2(lastPrice - buffer) : round2(lastPrice + buffer);
  const risk = Math.abs(lastPrice - stop);
  const target =
    direction === 'LONG'
      ? round2(lastPrice + MOMENTUM_TARGET_R_MULT * risk)
      : round2(lastPrice - MOMENTUM_TARGET_R_MULT * risk);
  return { stop, target };
}

// ── Shared strategy registry ─────────────────────────────────────────────────────────
const STRATEGIES = [
  { setupType: 'ORB', evaluate: evaluateOrbSetup, levels: orbLevels },
  { setupType: 'VWAP_REVERSION', evaluate: evaluateVwapReversionSetup, levels: vwapReversionLevels },
  { setupType: 'MOMENTUM_CONTINUATION', evaluate: evaluateMomentumSetup, levels: momentumLevels },
];

/**
 * Paper position size from the ORB virtual risk container (pure, shared by all 3
 * strategies). Risk-based shares, capped so deployment never exceeds the paper capital.
 * Direction-agnostic: risk is the absolute entry-stop distance either way.
 *
 * @param {number} entry
 * @param {number} stop
 * @returns {{ shares: number, capitalDeployed: number }}
 */
export function computePaperPosition(entry, stop) {
  const riskPerShare = Math.max(Math.abs(entry - stop), 0.01);
  const byRisk = Math.floor((ORB_PAPER_CAPITAL * (ORB_PAPER_RISK_PCT / 100)) / riskPerShare);
  const byCapital = entry > 0 ? Math.floor(ORB_PAPER_CAPITAL / entry) : 0;
  const shares = Math.max(Math.min(byRisk, byCapital), 0);
  return { shares, capitalDeployed: round2(shares * entry) };
}

/**
 * Widens a strategy's proposed target (stop untouched) when its distance from entry
 * wouldn't clear INTRADAY_TARGET_COST_SAFETY_MULT × the estimated round-trip cost —
 * otherwise a "target hit" can still net negative after brokerage/STT/slippage (pure).
 *
 * @param {number} entry
 * @param {number} target - Strategy's own computed target
 * @param {'LONG'|'SHORT'} direction
 * @param {number} shares - From computePaperPosition, for an accurate cost estimate
 * @returns {{ target: number, adjusted: boolean }}
 */
export function applyTargetCostFloor(entry, target, direction, shares) {
  const costPct = estimateRoundTripCostPct(entry, shares, 'INTRADAY', direction);
  const minTargetPct = costPct * INTRADAY_TARGET_COST_SAFETY_MULT;
  const targetPct = entry > 0 ? (Math.abs(target - entry) / entry) * 100 : 0;
  if (targetPct >= minTargetPct) return { target, adjusted: false };
  const widenedDistance = (entry * minTargetPct) / 100;
  const widened = direction === 'LONG' ? round2(entry + widenedDistance) : round2(entry - widenedDistance);
  return { target: widened, adjusted: true };
}

/**
 * Risk-side cost-geometry floor (pure) — the target floor's complement. A setup whose
 * stop distance is under INTRADAY_MIN_RISK_TO_COST_RATIO × the round-trip cost% is
 * structurally unplayable: friction alone drags every trade by 1/ratio R or more, so a
 * −1R stop-out nets far worse than −1R while a full-target win keeps only scraps
 * (2026-07-15 session: 0.15% stops → losers −2.6R net, winners +0.5R net). Unlike the
 * target floor this REJECTS — widening the stop would change the setup's thesis, and
 * position size cancels out of the ratio entirely, so no sizing can fix it.
 *
 * @param {number} entry
 * @param {number} stop
 * @param {number} shares - For an accurate cost estimate (brokerage cap)
 * @param {'LONG'|'SHORT'} direction
 * @returns {{ pass: boolean, stopDistPct: number, minStopDistPct: number, costPct: number }}
 */
export function checkRiskCostFloor(entry, stop, shares, direction) {
  const costPct = estimateRoundTripCostPct(entry, shares, 'INTRADAY', direction);
  const stopDistPct = entry > 0 ? (Math.abs(entry - stop) / entry) * 100 : 0;
  const minStopDistPct = costPct * INTRADAY_MIN_RISK_TO_COST_RATIO;
  return {
    pass: stopDistPct >= minStopDistPct && stopDistPct > 0,
    stopDistPct: round2(stopDistPct * 100) / 100,
    minStopDistPct: round2(minStopDistPct * 100) / 100,
    costPct: round2(costPct * 100) / 100,
  };
}

/** IST minutes-since-midnight for a bar's ISO open time. */
function barIstMinutes(isoTime) {
  const ist = new Date(new Date(isoTime).getTime() + 5.5 * 60 * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/**
 * Replay 5m bars after the entry bar and decide the paper exit (pure), direction-aware.
 * Order per bar: square-off time first, then SL, then target — a same-bar SL/target tie
 * settles as STOPLOSS (conservative). Gap-fills use the bar open when it's WORSE than the
 * level for an SL, or BETTER than the level for a target — mirrored for SHORT (a gap up
 * is worse for a short's stop and better for a long's target; a gap down is the reverse).
 *
 * @param {object[]} bars - Session bars [{time, open, high, low, close}], chronological
 * @param {Date|string} entryBarTime - Open time of the confirming (entry) bar
 * @param {number} entry - Entry price
 * @param {number} stop - Stop loss
 * @param {number} target - Target
 * @param {'LONG'|'SHORT'} [direction='LONG']
 * @param {boolean} [finalize=true] - Exhausted bars → square-off at last close.
 *   Pass false while the session is still running (leaves the trade open).
 * @returns {{ exitPrice: number, exitReason: string, exitTime: string }|null}
 */
export function simulateIntradayExit(bars, entryBarTime, entry, stop, target, direction = 'LONG', finalize = true) {
  const entryMs = new Date(entryBarTime).getTime();
  const later = (bars ?? []).filter((b) => new Date(b.time).getTime() > entryMs);
  if (!later.length) return null;
  const isLong = direction !== 'SHORT';

  for (const bar of later) {
    if (barIstMinutes(bar.time) >= ORB_SQUAREOFF_MINUTES) {
      return { exitPrice: bar.close, exitReason: 'SQUAREOFF', exitTime: bar.time };
    }
    const slHit = isLong ? bar.low <= stop : bar.high >= stop;
    if (slHit) {
      const fill = isLong ? Math.min(stop, bar.open) : Math.max(stop, bar.open);
      return { exitPrice: fill, exitReason: 'STOPLOSS', exitTime: bar.time };
    }
    const targetHit = isLong ? bar.high >= target : bar.low <= target;
    if (targetHit) {
      const fill = isLong ? Math.max(target, bar.open) : Math.min(target, bar.open);
      return { exitPrice: fill, exitReason: 'TARGET', exitTime: bar.time };
    }
  }
  if (!finalize) return null;
  const last = later[later.length - 1];
  return { exitPrice: last.close, exitReason: 'SQUAREOFF', exitTime: last.time };
}

/** True when the live tape has already moved past the entry price in the adverse
 * direction — the confirmed-close signal is stale, don't chase it (generalizes the old
 * ORB-only "faded back below OR high" check to all three strategies).
 *
 * VWAP_REVERSION is the exception: its own thesis is "price is still extending away
 * from VWAP," so a further tick in the extension direction since the bar closed is the
 * setup still peaking, not failing — the same check that correctly filters a stale
 * breakout would reject reversion candidates disproportionately, right when the
 * extension is sharpest (and most tradeable). For reversion, only bail once the live
 * price has moved so far that the trade would already be underwater past its own stop —
 * i.e. genuinely too late, not just "ticked the wrong way once." */
function fadedOnLiveQuote(setupType, direction, entryPrice, stop, liveQuote) {
  if (liveQuote?.price == null || liveQuote.source !== 'YAHOO_LIVE') return false;
  const threshold = setupType === 'VWAP_REVERSION' ? stop : entryPrice;
  return direction === 'LONG' ? liveQuote.price < threshold : liveQuote.price > threshold;
}

/**
 * One intraday scan cycle across all three strategies. Never throws — returns a summary
 * so the cron stays healthy.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.forceRun=false] - Bypass enabled/window guards (testing)
 * @returns {Promise<{ shortlist:number, evaluated:number, triggered:number, byStrategy:object, rejections:object, skipped?:string }>}
 */
export const runOrbScan = async ({ forceRun = false } = {}) => {
  const summary = {
    shortlist: 0,
    evaluated: 0,
    triggered: 0,
    byStrategy: { ORB: 0, VWAP_REVERSION: 0, MOMENTUM_CONTINUATION: 0 },
    rejections: {},
  };
  const reject = (code) => {
    summary.rejections[code] = (summary.rejections[code] ?? 0) + 1;
  };
  try {
    if (!forceRun && !ORB_SCANNER_ENABLED) return { ...summary, skipped: 'disabled' };
    if (!forceRun && !isInOrbWindow()) return { ...summary, skipped: 'outside 10:15–14:00 IST' };
    if (mongoose.connection.readyState !== 1) return { ...summary, skipped: 'db not connected' };

    const sessionDate = istSessionDate();
    const shortlist = await getIntradayShortlistSymbols();
    summary.shortlist = shortlist.length;
    if (!shortlist.length) return { ...summary, skipped: 'no intraday universe built yet' };

    // Already-alerted (setupType, direction) pairs per symbol — a symbol CAN still be
    // evaluated for a strategy/direction it hasn't triggered yet this session. MANUAL
    // logs are excluded: a hand-logged trade must not suppress the scanner.
    const alerted = await IntradaySignal.find({ sessionDate, source: { $ne: 'MANUAL' } })
      .select('symbol setupType direction')
      .lean();
    const doneKey = (s, setupType, direction) => `${s}:${setupType}:${direction}`;
    const done = new Set(alerted.map((a) => doneKey(a.symbol, a.setupType, a.direction)));
    const fullyDone = new Set(
      shortlist.filter((s) => STRATEGIES.every(({ setupType }) =>
        done.has(doneKey(s, setupType, 'LONG')) && done.has(doneKey(s, setupType, 'SHORT'))
      ))
    );
    const symbols = shortlist.filter((s) => !fullyDone.has(s));
    if (!symbols.length) return summary;

    // One batch quote + one snapshot fetch per cycle, shared across all 3 strategies —
    // VWAP-reversion and momentum need the full snapshot regardless (their reference
    // values move every bar, unlike ORB's immutable-once-set opening range), so there's
    // no prescreen-skip optimization left worth keeping once all three run together.
    const liveQuotes = await getQuotes(symbols).catch(() => ({}));
    const snapshots = await fetchIntradaySnapshots(symbols, ORB_WINDOW_MINUTES);
    // Cached reading (swing scanner's own cycle), not a fresh fetch — pure tagging,
    // never blocks or changes a trigger decision.
    const regime = await MarketState.findOne().select('lastMarketHealth').lean().catch(() => null);
    const marketHealth = regime?.lastMarketHealth ?? null;

    for (const symbol of symbols) {
      const snap = snapshots[symbol];
      // Pre-open or stale feed returns the PREVIOUS session — never alert on it.
      if (snap?.sessionDate !== sessionDate) {
        reject('STALE_SESSION');
        continue;
      }
      summary.evaluated += 1;
      const live = liveQuotes[symbol] ?? null;

      for (const { setupType, evaluate, levels } of STRATEGIES) {
        const verdict = evaluate(snap);
        if (!verdict.triggered) {
          reject(verdict.code);
          continue;
        }
        if (done.has(doneKey(symbol, setupType, verdict.direction))) continue; // already alerted this session

        const { stop, target } = levels(snap, verdict.direction);

        if (fadedOnLiveQuote(setupType, verdict.direction, snap.lastPrice, stop, live)) {
          reject('FADED_LIVE');
          logger.info(`${setupType} ${verdict.direction} faded for ${symbol} — skipping alert`, {
            barClose: snap.lastPrice,
            livePrice: live?.price,
            stop,
          });
          continue;
        }

        const now = new Date();
        const barOpen = snap.lastBarTime ? new Date(snap.lastBarTime) : null;
        const paper = computePaperPosition(snap.lastPrice, stop);

        // Risk-side cost-geometry floor: a stop too tight to carry the round-trip
        // friction makes every outcome net-negative-biased regardless of win rate —
        // reject before the target floor bothers widening anything.
        const geom = checkRiskCostFloor(snap.lastPrice, stop, paper.shares, verdict.direction);
        if (!geom.pass) {
          reject('COST_GEOMETRY');
          logger.info(
            `${setupType} ${verdict.direction} rejected for ${symbol} — stop too tight to carry costs`,
            {
              stopDistPct: geom.stopDistPct,
              minStopDistPct: geom.minStopDistPct,
              roundTripCostPct: geom.costPct,
            }
          );
          continue;
        }

        const { target: finalTarget, adjusted: targetCostAdjusted } =
          applyTargetCostFloor(snap.lastPrice, target, verdict.direction, paper.shares);
        if (targetCostAdjusted) {
          logger.info(`${setupType} ${verdict.direction} target widened for ${symbol} — raw target didn't clear round-trip costs`, {
            rawTarget: target,
            widenedTarget: finalTarget,
          });
        }

        let signal;
        try {
          // The unique {symbol, sessionDate, setupType, direction} index is the atomic
          // one-shot claim across overlapping cron cycles.
          signal = await IntradaySignal.create({
            symbol,
            sessionDate,
            setupType,
            direction: verdict.direction,
            source: setupType,
            breakoutPrice: snap.lastPrice,
            vwap: snap.vwap,
            relVolume: snap.relVolume,
            suggestedStop: stop,
            suggestedTarget: finalTarget,
            targetCostAdjusted,
            ...(setupType === 'ORB'
              ? { orHigh: snap.orHigh, orLow: snap.orLow, orWindowMinutes: ORB_WINDOW_MINUTES }
              : {}),
            ...(setupType === 'VWAP_REVERSION'
              ? { vwapStdDevAtEntry: snap.vwapStdDev, vwapBandAtEntry: verdict.direction === 'LONG'
                  ? round2(snap.vwap - VWAP_REVERSION_ENTRY_BAND_MULT * snap.vwapStdDev)
                  : round2(snap.vwap + VWAP_REVERSION_ENTRY_BAND_MULT * snap.vwapStdDev) }
              : {}),
            ...(setupType === 'MOMENTUM_CONTINUATION' ? { ema9AtEntry: snap.ema9 } : {}),
            barTime: barOpen,
            alertedAt: now,
            alertLatencyMs: barOpen ? Math.max(0, now - (barOpen.getTime() + BAR_MS)) : null,
            shares: paper.shares,
            capitalDeployed: paper.capitalDeployed,
            livePrice: live?.price ?? null,
            quoteSource: live?.source ?? null,
            marketModeAtEntry: marketHealth?.marketMode ?? null,
            adRatioAtEntry: marketHealth?.adRatio ?? null,
            vixAtEntry: marketHealth?.vix ?? null,
          });
        } catch (err) {
          if (err.code === 11000) continue; // another cycle claimed it first
          throw err;
        }

        summary.triggered += 1;
        summary.byStrategy[setupType] += 1;
        emitGlobal(SOCKET_EVENTS.INTRADAY_ORB, {
          signalId: signal._id,
          symbol,
          sessionDate,
          setupType,
          direction: verdict.direction,
          price: snap.lastPrice,
          vwap: snap.vwap,
          relVolume: snap.relVolume,
          suggestedStop: stop,
          suggestedTarget: finalTarget,
          timestamp: now.toISOString(),
        });
        await sendOrbAlert(signal); // notifier never throws
        logger.info(`${setupType} ${verdict.direction} alert for ${symbol}`, {
          reason: verdict.reason,
          latencyMs: signal.alertLatencyMs,
        });
      }
    }
    return summary;
  } catch (err) {
    logger.error('runOrbScan failed', { error: err.message });
    return { ...summary, skipped: err.message };
  }
};

/**
 * JOB 15 (15:20 IST): settle pending intraday paper trades (all 3 strategies, both
 * directions) by 5m bar replay. Also picks up sessions missed while the server was down,
 * as long as 5m bars still exist (~5 days). Never throws — unsettleable signals stay
 * pending and retry next run.
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
      const direction = sig.direction ?? 'LONG';
      const exit = simulateIntradayExit(
        sessionBars,
        sig.barTime,
        sig.breakoutPrice,
        sig.suggestedStop,
        sig.suggestedTarget,
        direction
      );
      if (!exit || !sig.breakoutPrice) continue;

      const riskPerShare = Math.max(Math.abs(sig.breakoutPrice - sig.suggestedStop), 0.01);
      const priceDiff =
        direction === 'LONG' ? exit.exitPrice - sig.breakoutPrice : sig.breakoutPrice - exit.exitPrice;
      const grossPnl = round2((sig.shares ?? 0) * priceDiff);
      // Judge the record NET of real intraday charges + slippage — thin intraday edges
      // usually die exactly here, and paper is where that must show up.
      const { netPnl, costs } = netAfterCosts(
        grossPnl, sig.breakoutPrice, exit.exitPrice, sig.shares ?? 0, 'INTRADAY', direction
      );
      await IntradaySignal.updateOne(
        { _id: sig._id, exitReason: null },
        {
          $set: {
            exitPrice: exit.exitPrice,
            exitReason: exit.exitReason,
            exitTime: new Date(exit.exitTime),
            rMultiple: round2(priceDiff / riskPerShare),
            grossPnl,
            estCosts: costs.total,
            paperPnl: netPnl,
            resultPct: round2((priceDiff / sig.breakoutPrice) * 100),
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
    if (summary.settled) logger.info('Intraday paper trades settled', summary);
    return summary;
  } catch (err) {
    logger.error('settlePaperTrades failed', { error: err.message });
    return summary;
  }
};

/**
 * JOB 16 (15:00 IST): square-off reminder for today's open intraday paper trades — a
 * nudge for anyone mirroring the experimental alerts manually. Returns the count.
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
