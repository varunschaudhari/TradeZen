/**
 * @file prices.js
 * @description REST route for live price updates pushed by the frontend.
 *   POST /api/prices/update — receives [{symbol, currentPrice}], checks SL proximity
 *   for each open trade, emits trade:sl_warning via WebSocket when within threshold.
 * @author SwingTrader AI Team
 */

import express from 'express';
import Joi from 'joi';
import Trade from '../models/Trade.js';
import { validateBody } from '../middleware/validateRequest.js';
import { emitToUser, SOCKET_EVENTS } from '../socket/socketHandlers.js';
import { sendSlWarning } from '../services/notifier.js';
import { SL_WARNING_PCT, TRADE_STATUSES } from '../config/constants.js';
import { logger } from '../config/logger.js';

const router = express.Router();

const priceUpdateSchema = Joi.object({
  prices: Joi.array()
    .items(
      Joi.object({
        symbol: Joi.string().uppercase().alphanum().max(20).required(),
        currentPrice: Joi.number().positive().required(),
      })
    )
    .min(1)
    .max(50)
    .required(),
});

// POST /api/prices/update
router.post('/update', validateBody(priceUpdateSchema), async (req, res, next) => {
  try {
    const { prices } = req.body;
    const symbols = prices.map((p) => p.symbol.toUpperCase());

    const openTrades = await Trade.find({
      userId: req.userId,
      symbol: { $in: symbols },
      status: TRADE_STATUSES.OPEN,
    }).lean();

    const warnings = [];

    for (const { symbol, currentPrice } of prices) {
      const tradesForSymbol = openTrades.filter((t) => t.symbol === symbol);

      for (const trade of tradesForSymbol) {
        if (!trade.stopLoss) continue;

        const distancePct = ((currentPrice - trade.stopLoss) / trade.stopLoss) * 100;

        if (distancePct >= 0 && distancePct <= SL_WARNING_PCT) {
          const unrealizedPnl = (currentPrice - trade.entryPrice) * trade.shares;
          const unrealizedPnlPct =
            trade.capitalDeployed > 0 ? (unrealizedPnl / trade.capitalDeployed) * 100 : 0;

          emitToUser(trade.userId, SOCKET_EVENTS.TRADE_SL_WARNING, {
            tradeId: trade._id,
            symbol,
            currentPrice,
            stopLoss: trade.stopLoss,
            distancePct: Math.round(distancePct * 100) / 100,
          });

          sendSlWarning({ ...trade, currentPrice, unrealizedPnl, unrealizedPnlPct }).catch((e) =>
            logger.error(`sendSlWarning failed for ${symbol}`, { error: e.message })
          );

          warnings.push({ tradeId: trade._id, symbol, distancePct: Math.round(distancePct * 100) / 100 });
        }
      }
    }

    res.json({
      success: true,
      data: { symbolsChecked: symbols.length, openTradesChecked: openTrades.length, warnings },
      message: `${warnings.length} SL warning(s) triggered`,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
