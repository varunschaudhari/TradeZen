/**
 * @file useScanProgress.js
 * @description Live scan-progress + monitor-events subscription. Seeds from the REST
 *   snapshot, then keeps both in sync via the SCAN_PROGRESS and MONITOR_EVENT socket
 *   events. Returns { progress, events } for the Monitor page.
 * @author TradeZen Team
 * @created 2026-06-27
 */

import { useState, useEffect } from 'react';
import useSocket from './useSocket.js';
import { monitorApi } from '../services/api.js';
import { SOCKET_EVENTS } from '../utils/constants.js';

const MAX_EVENTS = 50;

const useScanProgress = () => {
  const { subscribe } = useSocket();
  const [progress, setProgress] = useState(null);
  const [events, setEvents] = useState([]);

  // Seed initial state from REST so a freshly opened page isn't blank.
  useEffect(() => {
    let alive = true;
    monitorApi
      .getProgress()
      .then((res) => alive && res?.data && setProgress(res.data))
      .catch(() => {});
    monitorApi
      .getEvents()
      .then((res) => alive && Array.isArray(res?.data) && setEvents(res.data))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Live progress updates.
  useEffect(() => {
    const unsub = subscribe(SOCKET_EVENTS.SCAN_PROGRESS, (snap) => setProgress(snap));
    return () => unsub();
  }, [subscribe]);

  // Live event feed — prepend, dedupe by id, cap length.
  useEffect(() => {
    const unsub = subscribe(SOCKET_EVENTS.MONITOR_EVENT, (evt) => {
      setEvents((prev) => {
        if (prev.some((e) => e.id === evt.id)) return prev;
        return [evt, ...prev].slice(0, MAX_EVENTS);
      });
    });
    return () => unsub();
  }, [subscribe]);

  return { progress, events };
};

export default useScanProgress;
