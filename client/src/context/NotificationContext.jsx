/**
 * @file NotificationContext.jsx
 * @description In-app notification center — subscribes to all socket events and
 *   stores them in localStorage so alerts are never silently missed.
 *   Max 50 notifications kept; unread count drives the bell badge in Layout.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import useSocket from '../hooks/useSocket.js';
import { SOCKET_EVENTS } from '../utils/constants.js';

const NotificationContext = createContext(null);

const MAX  = 50;
const KEY  = 'tradezen_notifications';

const loadStored = () => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); }
  catch { return []; }
};

const mkId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const TYPE_META = {
  BUY_SIGNAL:    { icon: '📈', color: 'text-emerald-400' },
  ENTRY_TRIGGER: { icon: '🎯', color: 'text-emerald-400' },
  INTRADAY_ORB:  { icon: '⚡', color: 'text-amber-400'   },
  SL_WARNING:    { icon: '⚠️', color: 'text-red-400'     },
  BEAR_MODE:     { icon: '🐻', color: 'text-red-400'     },
  VIX_SPIKE:     { icon: '⚡', color: 'text-amber-400'   },
  SCAN_COMPLETE: { icon: '🔍', color: 'text-blue-400'    },
  PRICE_ALERT:   { icon: '🎯', color: 'text-amber-400'   },
};

export const useNotifications = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be inside NotificationProvider');
  return ctx;
};

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState(loadStored);
  const { subscribe } = useSocket();

  const push = useCallback((type, title, message, data = {}) => {
    const notif = { id: mkId(), type, title, message, data, timestamp: new Date().toISOString(), read: false };
    setNotifications((prev) => {
      const next = [notif, ...prev].slice(0, MAX);
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full */ }
      return next;
    });
  }, []);

  useEffect(() => {
    const fmt = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);

    const unsubs = [
      subscribe(SOCKET_EVENTS.SIGNAL_NEW, (d) => {
        if (d?.verdict !== 'BUY') return;
        const entry = d.entryZone?.low != null
          ? `Entry ${fmt(d.entryZone.low)}${d.entryZone.high ? '–' + fmt(d.entryZone.high) : ''}`
          : '';
        const rr = d.riskReward ? ` · RR ${d.riskReward.toFixed(1)}:1` : '';
        push('BUY_SIGNAL', `BUY · ${d.symbol}`, `${entry}${rr}`, d);
      }),
      subscribe(SOCKET_EVENTS.SIGNAL_ENTRY_TRIGGER, (d) => {
        push(
          'ENTRY_TRIGGER',
          `Entry zone hit · ${d.symbol}`,
          `Now ${fmt(d.price)} · Zone ${fmt(d.entryZone?.low)}–${fmt(d.entryZone?.high)}`,
          d,
        );
      }),
      subscribe(SOCKET_EVENTS.INTRADAY_ORB, (d) => {
        push(
          'INTRADAY_ORB',
          `ORB breakout (exp) · ${d.symbol}`,
          `Broke ${fmt(d.orHigh)} · Now ${fmt(d.price)} · Vol ${d.relVolume ?? '—'}× · paper-tracked`,
          d,
        );
      }),
      subscribe(SOCKET_EVENTS.TRADE_SL_WARNING, (d) => {
        push('SL_WARNING', `SL Warning · ${d.symbol}`, `Price is ${d.distancePct?.toFixed(1)}% from your stop loss`, d);
      }),
      subscribe(SOCKET_EVENTS.MARKET_BEARMODE, (d) => {
        push('BEAR_MODE', 'Market entered BEAR mode', 'All BUY signals are blocked for this session', d);
      }),
      subscribe(SOCKET_EVENTS.MARKET_VIXSPIKE, (d) => {
        push('VIX_SPIKE', `VIX Spike · ${d.vix?.toFixed(1)}`, 'Elevated volatility — consider reducing position sizes', d);
      }),
      subscribe(SOCKET_EVENTS.SCAN_COMPLETE, (d) => {
        if ((d?.buySignals ?? 0) > 0) {
          push('SCAN_COMPLETE', `${d.buySignals} BUY signal${d.buySignals > 1 ? 's' : ''} found`, `${d.stocksScanned} stocks scanned`, d);
        }
      }),
      subscribe(SOCKET_EVENTS.PRICE_ALERT, (d) => {
        const dir = d.direction === 'above' ? '▲' : '▼';
        const fmt = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
        push(
          'PRICE_ALERT',
          `Price Alert · ${d.symbol}`,
          `${dir} Crossed ${fmt(d.targetPrice)} · Now ${fmt(d.currentPrice)}${d.note ? ` · ${d.note}` : ''}`,
          d,
        );
      }),
    ];
    return () => unsubs.forEach((u) => u?.());
  }, [subscribe, push]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }));
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* */ }
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    try { localStorage.removeItem(KEY); } catch { /* */ }
  }, []);

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, push, markAllRead, clearAll, TYPE_META }}>
      {children}
    </NotificationContext.Provider>
  );
};

NotificationProvider.propTypes = { children: PropTypes.node.isRequired };
