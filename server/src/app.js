/**
 * @file app.js
 * @description Express application entry point — wires middleware, routes, socket, and DB
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import { logger } from './config/logger.js';
import { CLIENT_URL } from './config/constants.js';
import { errorHandler } from './middleware/errorHandler.js';
import { globalRateLimiter } from './middleware/rateLimiter.js';
import { initSocketHandlers } from './socket/socketHandlers.js';
import { startScheduler } from './scheduler/index.js';
import signalsRouter from './routes/signals.js';
import tradesRouter from './routes/trades.js';
import watchlistRouter from './routes/watchlist.js';
import performanceRouter from './routes/performance.js';
import newsRouter from './routes/news.js';
import chatRouter from './routes/chat.js';
import pricesRouter from './routes/prices.js';
import configRouter from './routes/config.js';
import ohlcvRouter from './routes/ohlcv.js';
import marketRouter from './routes/market.js';
import quotesRouter from './routes/quotes.js';
import stockRouter from './routes/stock.js';
import stocksRouter from './routes/stocks.js';
import universeRouter from './routes/universe.js';
import healthRouter from './routes/health.js';
import scannerRouter from './routes/scanner.js';
import scanRouter from './routes/scan.js';
import testRouter from './routes/test.js';
import marketSignalsRouter from './routes/marketSignals.js';
import analysisRouter from './routes/analysis.js';
import monitorRouter from './routes/monitor.js';
import backtestRouter from './routes/backtest.js';
import searchRouter from './routes/search.js';
import gatesRouter from './routes/gates.js';
import alertsRouter from './routes/alerts.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_URL, methods: ['GET', 'POST'] },
});

app.use(helmet());
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '10kb' }));
app.use(globalRateLimiter);

app.get('/health', (_req, res) => res.json({ success: true, message: 'Server is healthy' }));

app.use('/api/signals', signalsRouter);
app.use('/api/trades', tradesRouter);
app.use('/api/watchlist', watchlistRouter);
app.use('/api/performance', performanceRouter);
app.use('/api/news', newsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/prices', pricesRouter);
app.use('/api/config', configRouter);
app.use('/api/ohlcv', ohlcvRouter);
app.use('/api/market', marketRouter);
app.use('/api/quotes', quotesRouter);
app.use('/api/stock', stockRouter);
app.use('/api/stocks', stocksRouter);
app.use('/api/universe', universeRouter);
app.use('/api/health', healthRouter);
app.use('/api/scanner', scannerRouter);
app.use('/api/scan', scanRouter);
app.use('/api/test', testRouter);
app.use('/api/market-signals', marketSignalsRouter);
app.use('/api/analysis', analysisRouter);
app.use('/api/monitor', monitorRouter);
app.use('/api/backtest', backtestRouter);
app.use('/api/search', searchRouter);
app.use('/api/gates', gatesRouter);
app.use('/api/alerts', alertsRouter);

app.use(errorHandler);

initSocketHandlers(io);

const PORT = process.env.PORT ?? 5000;

/**
 * Starts HTTP server after establishing MongoDB connection
 * @returns {Promise<void>}
 */
const startServer = async () => {
  try {
    await connectDB();

    // Register all cron jobs after DB is ready (unified scheduler — 10 jobs)
    startScheduler();

    httpServer.listen(PORT, () => {
      logger.info(`SwingTrader AI server running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
};

startServer();

export { io };
