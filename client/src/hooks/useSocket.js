/**
 * @file useSocket.js
 * @description Custom hook — manages socket.io connection and event subscription.
 *   Uses a module-level singleton so multiple useSocket() callers share one connection.
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-15
 */

import { useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useApp } from '../context/AppContext.jsx';

// Empty → connect to the SAME origin serving the page (nginx / Vite proxy forwards
// /socket.io to the server). Set VITE_SOCKET_URL only for a separate API domain.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';

// Module-level singleton — all callers share one connection
let _socket = null;
function getSocket() {
  if (!_socket) {
    // io(undefined) → same-origin; pass an explicit URL only when configured.
    _socket = io(SOCKET_URL || undefined, { transports: ['websocket'], reconnectionAttempts: 10 });
  }
  return _socket;
}

/**
 * Connect to socket.io and manage lifecycle; returns subscribe helper.
 * Safe to call from multiple components — same underlying socket is reused.
 * @returns {{ subscribe: Function, socket: Socket }}
 */
const useSocket = () => {
  const { setIsConnected } = useApp();

  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    // Sync initial state
    if (socket.connected) setIsConnected(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [setIsConnected]);

  const subscribe = useCallback((event, handler) => {
    const socket = getSocket();
    socket.on(event, handler);
    return () => socket.off(event, handler);
  }, []);

  return { subscribe, socket: getSocket() };
};

export default useSocket;
