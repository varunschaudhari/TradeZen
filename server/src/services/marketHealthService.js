/**
 * @file marketHealthService.js
 * @description Flow 1 — Market Health Check. Determines the overall market mode
 *              (BULL / CAUTION / BEAR) before any scanning begins. In BEAR mode the
 *              entire scan is suspended (no new BUY signals). Falls back to the last
 *              cached snapshot when the Python service is unreachable.
 * @author TradeZen Team
 * @created 2026-06-20
 * @lastModified 2026-06-20
 *
 * Data sources (all via the Python microservice GET /market):
 *  - Nifty 50  (^NSEI),  Bank Nifty (^NSEBANK),  India VIX (^INDIAVIX),  A/D ratio
 *
 * Called by: marketScanner.js at the start of every scan cycle.
 */

import mongoose from 'mongoose';
import MarketState from '../models/MarketState.js';
import MarketRegimeHistory from '../models/MarketRegimeHistory.js';
import { logger } from '../config/logger.js';
import { fetchMarketData } from './pythonBridge.js';
import { sendBearModeAlert } from './notifier.js';
import {
  AD_RATIO_BEAR,
  AD_RATIO_BULL,
  CAUTION_POSITION_SIZE_FACTOR,
  EMA20_CAUTION_BAND_PCT,
  MARKET_HEALTH_STALE_MIN,
  MARKET_MODES,
  MIXED_POSITION_SIZE_FACTOR,
  VIX_CAUTION,
  VIX_SAFE,
} from '../config/constants.js';

const MS_PER_MIN = 60_000;

// The only correct way to get current IST time in this codebase (see CLAUDE.md).
function getNowIST() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

/**
 * Classify a simple price-vs-EMA trend label.
 *
 * @param {number|null|undefined} price - Index price
 * @param {number|null|undefined} ema   - EMA value to compare against
 * @returns {'BULLISH'|'BEARISH'|null} Trend label, or null when data is missing
 */
function classifyTrend(price, ema) {
  if (price == null || ema == null) return null;
  return price >= ema ? 'BULLISH' : 'BEARISH';
}

/**
 * Position-size factor for a mode: CAUTION halves, MIXED (narrow rally) trims 30%.
 *
 * @param {string} mode - Market mode
 * @returns {number} Multiplier applied to per-trade risk
 */
export function positionFactorForMode(mode) {
  if (mode === MARKET_MODES.CAUTION) return CAUTION_POSITION_SIZE_FACTOR;
  if (mode === MARKET_MODES.MIXED) return MIXED_POSITION_SIZE_FACTOR;
  return 1;
}

/**
 * Determine market mode from the raw market inputs (pure function).
 *
 * BEAR if ANY: Nifty < 20 EMA, OR VIX > VIX_CAUTION (true risk-off).
 * MIXED if Nifty above 20 EMA AND A/D < AD_RATIO_BEAR — a narrow rally: index up
 *   but breadth weak. Trading is allowed (reduced size), NOT full bear. (Simons:
 *   narrow markets often precede reversals — flag it, don't ignore it.)
 * CAUTION if ANY (and not BEAR/MIXED): Nifty within ±EMA20_CAUTION_BAND_PCT of 20 EMA,
 *   VIX in [VIX_SAFE, VIX_CAUTION], A/D in [AD_RATIO_BEAR, AD_RATIO_BULL].
 * BULL otherwise (Nifty above 20 EMA, VIX < VIX_SAFE, A/D > AD_RATIO_BULL).
 *
 * Note: the spec's "Nifty down 3 consecutive days" BEAR sub-condition is not
 * evaluable from the /market snapshot (no daily history), so it is omitted here.
 *
 * @param {{ niftyPrice:number|null, niftyEma20:number|null, vix:number|null, adRatio:number|null }} inputs
 * @returns {{ mode: string, reason: string }}
 */
export function determineMarketMode({ niftyPrice, niftyEma20, vix, adRatio }) {
  const aboveEma = niftyPrice != null && niftyEma20 != null && niftyPrice >= niftyEma20;

  const bear = [];
  if (niftyPrice != null && niftyEma20 != null && niftyPrice < niftyEma20) {
    bear.push(`Nifty ₹${niftyPrice} below 20 EMA ₹${niftyEma20}`);
  }
  if (vix != null && vix > VIX_CAUTION) bear.push(`VIX ${vix} above ${VIX_CAUTION}`);
  if (bear.length) return { mode: MARKET_MODES.BEAR, reason: bear.join('; ') };

  // Narrow rally: index up but breadth weak → MIXED (allow, but reduce size + warn).
  if (aboveEma && adRatio != null && adRatio < AD_RATIO_BEAR) {
    return {
      mode: MARKET_MODES.MIXED,
      reason: `Nifty above 20 EMA but A/D ${adRatio} < ${AD_RATIO_BEAR} — NARROW MARKET, index driven by few stocks`,
    };
  }

  const caution = [];
  const bandPct = niftyEma20 ? (Math.abs(niftyPrice - niftyEma20) / niftyEma20) * 100 : null;
  if (bandPct != null && bandPct <= EMA20_CAUTION_BAND_PCT) {
    caution.push(`Nifty within ${EMA20_CAUTION_BAND_PCT}% of 20 EMA`);
  }
  if (vix != null && vix >= VIX_SAFE && vix <= VIX_CAUTION) caution.push(`VIX ${vix} elevated`);
  if (adRatio != null && adRatio >= AD_RATIO_BEAR && adRatio <= AD_RATIO_BULL) {
    caution.push(`A/D ${adRatio} soft`);
  }
  if (caution.length) return { mode: MARKET_MODES.CAUTION, reason: caution.join('; ') };

  return {
    mode: MARKET_MODES.BULL,
    reason: `Nifty above 20 EMA, VIX < ${VIX_SAFE}, A/D > ${AD_RATIO_BULL}`,
  };
}

/**
 * Shape the Python /market response + computed mode into the public health object.
 *
 * @param {object} market - Raw Python /market response
 * @param {{ mode: string, reason: string }} classified - Output of determineMarketMode
 * @returns {object} Full market-health object (see getMarketHealth return)
 */
function buildHealthObject(market, classified) {
  const nifty = market?.nifty50 ?? {};
  const bank = market?.bankNifty ?? {};
  const { mode, reason } = classified;
  return {
    nifty50: {
      price: nifty.price ?? null,
      ema20: nifty.ema20 ?? null,
      ema50: nifty.ema50 ?? null, // not provided by /market — reserved
      trend: classifyTrend(nifty.price, nifty.ema20),
      dayChangePct: nifty.changePct ?? null,
    },
    bankNifty: {
      price: bank.price ?? null,
      ema20: bank.ema20 ?? null,
      trend: classifyTrend(bank.price, bank.ema20),
    },
    vix: market?.vix ?? null,
    adRatio: market?.adRatio ?? null,
    marketMode: mode,
    allowTrading: mode !== MARKET_MODES.BEAR,
    positionSizeFactor: positionFactorForMode(mode),
    narrowMarket: mode === MARKET_MODES.MIXED,
    reason,
    stale: false,
  };
}

/**
 * Persist the latest mode + full snapshot to the shared MarketState singleton.
 * No-op (logged) when MongoDB is not connected so the service stays usable in tests.
 *
 * @param {object} health - Output of buildHealthObject
 * @returns {Promise<void>}
 */
async function persistHealth(health) {
  if (mongoose.connection.readyState !== 1) {
    logger.debug('marketHealth: DB not connected — skipping persist');
    return;
  }
  try {
    await MarketState.updateOne(
      {},
      {
        $set: {
          marketMode: health.marketMode,
          lastMarketHealth: {
            niftyPrice: health.nifty50.price,
            niftyEma20: health.nifty50.ema20,
            niftyChangePct: health.nifty50.dayChangePct,
            bankNiftyPrice: health.bankNifty.price,
            bankNiftyEma20: health.bankNifty.ema20,
            vix: health.vix,
            adRatio: health.adRatio,
            marketMode: health.marketMode,
            allowTrading: health.allowTrading,
            reason: health.reason,
            capturedAt: new Date(),
          },
        },
      },
      { upsert: true }
    );
  } catch (err) {
    logger.error('marketHealth: failed to persist snapshot', { error: err.message });
  }

  // Daily regime archive — upserted by IST calendar day so later scan cycles the same
  // day just refine that day's row with the latest snapshot. This is what lets
  // backtestEngine.js eventually replay real MIXED/CAUTION regimes for any day going
  // forward, instead of only ever approximating from Nifty-vs-its-own-20EMA.
  try {
    const date = getNowIST().toISOString().slice(0, 10);
    await MarketRegimeHistory.updateOne(
      { date },
      {
        $set: {
          niftyPrice: health.nifty50.price,
          niftyEma20: health.nifty50.ema20,
          vix: health.vix,
          adRatio: health.adRatio,
          marketMode: health.marketMode,
          allowTrading: health.allowTrading,
          reason: health.reason,
          capturedAt: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (err) {
    logger.error('marketHealth: failed to persist daily regime history', { error: err.message });
  }
}

/**
 * Read the previously stored market mode (for BEAR-transition detection).
 *
 * @returns {Promise<string|null>} Previous marketMode, or null if unavailable
 */
async function getPreviousMode() {
  if (mongoose.connection.readyState !== 1) return null;
  try {
    const state = await MarketState.findOne().select('marketMode').lean();
    return state?.marketMode ?? null;
  } catch (err) {
    logger.error('marketHealth: failed to read previous mode', { error: err.message });
    return null;
  }
}

/**
 * Send a bear-mode alert when the market newly enters BEAR from a non-BEAR mode.
 * Fire-and-forget — alert failures must never block the scan.
 *
 * @param {string} newMode  - Newly determined market mode
 * @param {string|null} prevMode - Previously stored market mode
 * @returns {void}
 */
function handleBearTransition(newMode, prevMode) {
  if (newMode === MARKET_MODES.BEAR && prevMode !== MARKET_MODES.BEAR) {
    logger.warn('marketHealth: entering BEAR mode — alerting', { prevMode });
    sendBearModeAlert().catch((err) =>
      logger.error('marketHealth: sendBearModeAlert failed', { error: err.message })
    );
  }
}

/**
 * Build a degraded health object from the last cached snapshot when Python is down.
 * Trading is blocked if the snapshot is missing or older than MARKET_HEALTH_STALE_MIN.
 *
 * @returns {Promise<object>} Health object with stale=true and a descriptive reason
 */
async function fallbackToCache() {
  let snapshot = null;
  if (mongoose.connection.readyState === 1) {
    try {
      const state = await MarketState.findOne().select('lastMarketHealth').lean();
      snapshot = state?.lastMarketHealth ?? null;
    } catch (err) {
      logger.error('marketHealth: failed to read cached snapshot', { error: err.message });
    }
  }

  if (!snapshot?.capturedAt) {
    return {
      nifty50: { price: null, ema20: null, ema50: null, trend: null, dayChangePct: null },
      bankNifty: { price: null, ema20: null, trend: null },
      vix: null,
      adRatio: null,
      marketMode: MARKET_MODES.BEAR,
      allowTrading: false,
      positionSizeFactor: 0,
      reason: 'Market data unavailable and no cached snapshot — trading blocked',
      stale: true,
    };
  }

  const ageMin = (Date.now() - new Date(snapshot.capturedAt).getTime()) / MS_PER_MIN;
  const fresh = ageMin <= MARKET_HEALTH_STALE_MIN;
  const positionSizeFactor = fresh ? positionFactorForMode(snapshot.marketMode) : 0;
  return {
    nifty50: {
      price: snapshot.niftyPrice ?? null,
      ema20: snapshot.niftyEma20 ?? null,
      ema50: null,
      trend: classifyTrend(snapshot.niftyPrice, snapshot.niftyEma20),
      dayChangePct: snapshot.niftyChangePct ?? null,
    },
    bankNifty: {
      price: snapshot.bankNiftyPrice ?? null,
      ema20: snapshot.bankNiftyEma20 ?? null,
      trend: classifyTrend(snapshot.bankNiftyPrice, snapshot.bankNiftyEma20),
    },
    vix: snapshot.vix ?? null,
    adRatio: snapshot.adRatio ?? null,
    marketMode: snapshot.marketMode ?? MARKET_MODES.CAUTION,
    allowTrading: fresh ? Boolean(snapshot.allowTrading) : false,
    positionSizeFactor,
    narrowMarket: snapshot.marketMode === MARKET_MODES.MIXED,
    reason: fresh
      ? `Python unreachable — using cached health (${Math.round(ageMin)}m old)`
      : `Cached stale (${Math.round(ageMin)}m > ${MARKET_HEALTH_STALE_MIN}m) — trading blocked`,
    stale: true,
  };
}

/**
 * Determine the current market health and mode.
 *
 * Fetches live market data, classifies the mode, persists the snapshot, and fires a
 * bear-mode alert on a fresh BEAR transition. On Python failure it returns the last
 * cached snapshot (trading blocked if missing or stale).
 *
 * @returns {Promise<{
 *   nifty50: { price:number|null, ema20:number|null, ema50:number|null, trend:string|null, dayChangePct:number|null },
 *   bankNifty: { price:number|null, ema20:number|null, trend:string|null },
 *   vix:number|null, adRatio:number|null,
 *   marketMode:'BULL'|'CAUTION'|'BEAR', allowTrading:boolean,
 *   positionSizeFactor:number, reason:string, stale:boolean
 * }>}
 */
export const getMarketHealth = async () => {
  try {
    const market = await fetchMarketData();
    const classified = determineMarketMode({
      niftyPrice: market?.nifty50?.price ?? null,
      niftyEma20: market?.nifty50?.ema20 ?? null,
      vix: market?.vix ?? null,
      adRatio: market?.adRatio ?? null,
    });

    const prevMode = await getPreviousMode();
    const health = buildHealthObject(market, classified);

    await persistHealth(health);
    handleBearTransition(health.marketMode, prevMode);

    logger.info('Market health determined', {
      marketMode: health.marketMode,
      allowTrading: health.allowTrading,
      vix: health.vix,
      adRatio: health.adRatio,
    });
    return health;
  } catch (err) {
    logger.error('getMarketHealth: live fetch failed — falling back to cache', {
      error: err.message,
    });
    return fallbackToCache();
  }
};
