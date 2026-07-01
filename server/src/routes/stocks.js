/**
 * @file stocks.js
 * @description NSE universe management — CRUD + active toggle for the Stock collection.
 *   GET    /api/stocks            list with filters (sector, active, indices, tier, q, page)
 *   GET    /api/stocks/stats      summary counts
 *   POST   /api/stocks            add / upsert a stock
 *   POST   /api/stocks/bulk-toggle  activate or deactivate many symbols at once
 *   PATCH  /api/stocks/:symbol/toggle  flip active flag for one stock
 *   DELETE /api/stocks/:symbol    remove from universe
 */

import express from 'express';
import Stock from '../models/Stock.js';
import { logger } from '../config/logger.js';

const router = express.Router();
const SYMBOL_RE = /^[A-Z0-9&.-]{1,20}$/;
const PAGE_SIZE = 100;

/* ── helpers ───────────────────────────────────────────────────────────────── */
function validateSymbol(raw) {
  const s = (raw ?? '').trim().toUpperCase();
  return SYMBOL_RE.test(s) ? s : null;
}

/* ── GET /api/stocks/stats ─────────────────────────────────────────────────── */
router.get('/stats', async (_req, res, next) => {
  try {
    const [total, active, bySector, byTier] = await Promise.all([
      Stock.countDocuments(),
      Stock.countDocuments({ active: true }),
      Stock.aggregate([{ $group: { _id: '$sector', total: { $sum: 1 }, active: { $sum: { $cond: ['$active', 1, 0] } } } }, { $sort: { total: -1 } }]),
      Stock.aggregate([{ $group: { _id: '$marketCapTier', total: { $sum: 1 }, active: { $sum: { $cond: ['$active', 1, 0] } } } }]),
    ]);
    res.json({ success: true, data: { total, active, inactive: total - active, bySector, byTier } });
  } catch (err) {
    next(err);
  }
});

/* ── GET /api/stocks ───────────────────────────────────────────────────────── */
router.get('/', async (req, res, next) => {
  try {
    const { q, sector, active: activeParam, indices, tier, page = 0 } = req.query;
    const filter = {};

    if (q) filter.symbol = { $regex: q.trim().toUpperCase() };
    if (sector && sector !== 'ALL') filter.sector = sector;
    if (activeParam === 'true') filter.active = true;
    else if (activeParam === 'false') filter.active = false;
    if (indices && indices !== 'ALL') filter.indices = indices;
    if (tier && tier !== 'ALL') filter.marketCapTier = tier;

    const skip = Number(page) * PAGE_SIZE;
    const [stocks, total] = await Promise.all([
      Stock.find(filter).sort({ symbol: 1 }).skip(skip).limit(PAGE_SIZE).lean(),
      Stock.countDocuments(filter),
    ]);

    res.json({ success: true, data: { stocks, total, page: Number(page), pageSize: PAGE_SIZE } });
  } catch (err) {
    next(err);
  }
});

/* ── POST /api/stocks/bulk-toggle ─────────────────────────────────────────── */
router.post('/bulk-toggle', async (req, res, next) => {
  try {
    const { symbols, active } = req.body;
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ success: false, error: 'symbols array required' });
    }
    if (typeof active !== 'boolean') {
      return res.status(400).json({ success: false, error: 'active (boolean) required' });
    }
    const upperSymbols = symbols.map((s) => String(s).trim().toUpperCase());
    const result = await Stock.updateMany({ symbol: { $in: upperSymbols } }, { $set: { active } });
    logger.info(`Bulk toggle: ${result.modifiedCount} stocks set active=${active}`);
    res.json({ success: true, data: { modifiedCount: result.modifiedCount } });
  } catch (err) {
    next(err);
  }
});

/* ── POST /api/stocks ──────────────────────────────────────────────────────── */
router.post('/', async (req, res, next) => {
  try {
    const { symbol: rawSym, companyName, sector, industry, indices, marketCapTier, active = true } = req.body;
    const symbol = validateSymbol(rawSym);
    if (!symbol) return res.status(400).json({ success: false, error: 'Invalid symbol' });

    const stock = await Stock.findOneAndUpdate(
      { symbol },
      {
        $set: {
          ...(companyName && { companyName }),
          ...(sector && { sector }),
          ...(industry && { industry }),
          ...(Array.isArray(indices) && { indices }),
          ...(marketCapTier && { marketCapTier }),
          active,
          inUniverse: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    logger.info(`Stock upserted: ${symbol}`);
    res.status(201).json({ success: true, data: stock });
  } catch (err) {
    next(err);
  }
});

/* ── PATCH /api/stocks/:symbol/toggle ─────────────────────────────────────── */
router.patch('/:symbol/toggle', async (req, res, next) => {
  try {
    const symbol = validateSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ success: false, error: 'Invalid symbol' });

    const stock = await Stock.findOne({ symbol });
    if (!stock) return res.status(404).json({ success: false, error: 'Stock not found' });

    stock.active = !stock.active;
    await stock.save();
    logger.info(`Toggled ${symbol} → active=${stock.active}`);
    res.json({ success: true, data: { symbol, active: stock.active } });
  } catch (err) {
    next(err);
  }
});

/* ── DELETE /api/stocks/:symbol ────────────────────────────────────────────── */
router.delete('/:symbol', async (req, res, next) => {
  try {
    const symbol = validateSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ success: false, error: 'Invalid symbol' });

    const result = await Stock.deleteOne({ symbol });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Stock not found' });
    logger.info(`Deleted stock: ${symbol}`);
    res.json({ success: true, data: { symbol, deleted: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
