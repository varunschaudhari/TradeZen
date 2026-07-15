/**
 * @file socketHandlers.js
 * @description Socket.io event handlers and emit helpers for real-time dashboard updates
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import { logger } from '../config/logger.js';
import { verifyToken, AUTH_COOKIE_NAME } from '../services/authService.js';

// Minimal cookie-header parser — avoids pulling in the full cookie-parser
// package for a single-key lookup on the raw socket.io handshake headers.
const readCookie = (cookieHeader, name) => {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
};

// Socket event names — must match client-side constants
export const SOCKET_EVENTS = Object.freeze({
  SIGNAL_NEW: 'signal:new',
  SIGNAL_UPDATE: 'signal:update',
  SIGNAL_ENTRY_TRIGGER: 'signal:entry_trigger',
  INTRADAY_ORB: 'intraday:orb',
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
  PRICE_ALERT: 'price:alert',
});

let _io = null;

/**
 * Initialize socket.io handlers and store io reference for emission
 * @param {import('socket.io').Server} io
 */
export const initSocketHandlers = (io) => {
  _io = io;

  io.on('connection', (socket) => {
    const token = readCookie(socket.handshake.headers.cookie, AUTH_COOKIE_NAME);
    const claims = token ? verifyToken(token) : null;

    if (!claims) {
      logger.warn(`WebSocket client connected without a valid session: ${socket.id}`);
      socket.disconnect(true);
      return;
    }

    socket.join(`user:${claims.userId}`);
    logger.info(`WebSocket client connected: ${socket.id} (user ${claims.userId})`);

    socket.on('disconnect', () => {
      logger.info(`WebSocket client disconnected: ${socket.id}`);
    });
  });
};

/**
 * Emit a shared event to every connected client (market data, scan progress,
 * signal quality — none of it is per-user).
 * @param {string} event - SOCKET_EVENTS value
 * @param {object} data - Payload
 */
export const emitGlobal = (event, data) => {
  if (_io) {
    _io.emit(event, data);
  }
};

/**
 * Emit a per-user event (trade lifecycle, price alerts) only to sockets
 * authenticated as that user.
 * @param {string} userId
 * @param {string} event - SOCKET_EVENTS value
 * @param {object} data - Payload
 */
export const emitToUser = (userId, event, data) => {
  if (_io && userId) {
    _io.to(`user:${userId}`).emit(event, data);
  }
};
