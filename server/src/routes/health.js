/**
 * @file health.js
 * @description GET /api/health — server + dependency status (MongoDB, Python service).
 * @author TradeZen Team
 * @created 2026-06-20
 */

import express from 'express';
import mongoose from 'mongoose';
import { checkPythonHealth } from '../services/pythonBridge.js';
import { SERVER_VERSION } from '../config/constants.js';

const router = express.Router();

// GET /api/health
router.get('/', async (_req, res, next) => {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const pythonConnected = await checkPythonHealth();
    res.json({
      success: true,
      db: dbConnected ? 'connected' : 'disconnected',
      python: pythonConnected ? 'connected' : 'disconnected',
      version: SERVER_VERSION,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
