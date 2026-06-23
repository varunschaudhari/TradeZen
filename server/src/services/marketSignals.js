/**
 * @file marketSignals.js
 * @description Read/write the MarketSignals singleton (FII flow, P/C ratio, sector
 *              ranking). getMarketSignals() is read once per scan and its values are
 *              injected into marketData so the composite score (FII +8, P/C +5) and the
 *              Claude prompt reflect the current market regime.
 * @author TradeZen Team
 * @created 2026-06-21
 */

import mongoose from 'mongoose';
import MarketSignals from '../models/MarketSignals.js';
import { FII_TRENDS } from '../config/constants.js';
import { logger } from '../config/logger.js';

const DEFAULTS = Object.freeze({
  fiiTrend: FII_TRENDS.NEUTRAL,
  fiiNetBuy3d: null,
  pcRatio: null,
  topSectors: [],
  bottomSectors: [],
  sectorRanking: [],
  source: 'default',
});

/**
 * Read the current market signals, or safe defaults when none stored / DB unavailable.
 *
 * @returns {Promise<object>} Market signals (never throws)
 */
export const getMarketSignals = async () => {
  if (mongoose.connection.readyState !== 1) return { ...DEFAULTS };
  try {
    const doc = await MarketSignals.findOne().sort({ updatedAt: -1 }).lean();
    return doc ? { ...DEFAULTS, ...doc } : { ...DEFAULTS };
  } catch (err) {
    logger.error('getMarketSignals failed', { error: err.message });
    return { ...DEFAULTS };
  }
};

/**
 * Upsert market signals (manual override or auto-fetcher). Only whitelisted fields are
 * written; an invalid fiiTrend is rejected.
 *
 * @param {object} patch - Subset of { fiiTrend, fiiNetBuy3d, pcRatio, topSectors, bottomSectors, sectorRanking }
 * @param {string} [source='manual'] - Provenance tag
 * @returns {Promise<object>} The updated document
 */
export const setMarketSignals = async (patch = {}, source = 'manual') => {
  const allowed = [
    'fiiTrend',
    'fiiNetBuy3d',
    'pcRatio',
    'topSectors',
    'bottomSectors',
    'sectorRanking',
  ];
  const update = { source };
  for (const key of allowed) if (patch[key] !== undefined) update[key] = patch[key];

  if (update.fiiTrend && !Object.values(FII_TRENDS).includes(update.fiiTrend)) {
    throw new Error(`Invalid fiiTrend "${update.fiiTrend}" — must be BUYING | SELLING | NEUTRAL`);
  }

  const doc = await MarketSignals.findOneAndUpdate(
    {},
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  logger.info('Market signals updated', { source, fiiTrend: doc.fiiTrend, pcRatio: doc.pcRatio });
  return doc;
};
