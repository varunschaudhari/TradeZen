/**
 * @file socketHandlers.js
 * @description Socket.io event handlers and emit helpers for real-time dashboard updates
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import { logger } from '../config/logger.js';

// Socket event names — must match client-side constants
export const SOCKET_EVENTS = Object.freeze({
  SIGNAL_NEW: 'signal:new',
  SIGNAL_UPDATE: 'signal:update',
  MARKET_UPDATE: 'market:update',
  TRADE_TARGET1: 'trade:target1',
  TRADE_TARGET2: 'trade:target2',
  TRADE_CLOSED: 'trade:closed',
  TRADE_SL_WARNING: 'trade:sl_warning',
  TRADE_EARNINGS: 'trade:earnings',
  MARKET_BEARMODE: 'market:bearmode',
  MARKET_VIXSPIKE: 'market:vixspike',
  SCAN_COMPLETE: 'scan:complete',
  SCAN_PROGRESS: 'scan:progress',
  MONITOR_EVENT: 'monitor:event',
});

let _io = null;

/**
 * Initialize socket.io handlers and store io reference for emission
 * @param {import('socket.io').Server} io
 */
export const initSocketHandlers = (io) => {
  _io = io;

  io.on('connection', (socket) => {
    logger.info(`WebSocket client connected: ${socket.id}`);

    socket.on('disconnect', () => {
      logger.info(`WebSocket client disconnected: ${socket.id}`);
    });
  });
};

/**
 * Emit a signal event to all connected clients
 * @param {string} event - SOCKET_EVENTS value
 * @param {object} data - Payload
 */
export const emitEvent = (event, data) => {
  if (_io) {
    _io.emit(event, data);
  }
};
