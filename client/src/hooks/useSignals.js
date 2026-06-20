/**
 * @file useSignals.js
 * @description Custom hook — fetches signals and subscribes to real-time updates
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import { useState, useEffect, useCallback } from 'react';
import { signalsApi } from '../services/api.js';
import { SOCKET_EVENTS } from '../utils/constants.js';
import useSocket from './useSocket.js';

/**
 * @returns {{ signals: object[], loading: boolean, error: string|null, refresh: Function }}
 */
const useSignals = () => {
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { subscribe } = useSocket();

  const fetchSignals = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await signalsApi.getAll();
      setSignals(response.data ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSignals();

    const unsubNew = subscribe(SOCKET_EVENTS.SIGNAL_NEW, (signal) => {
      setSignals((prev) => [signal, ...prev]);
    });

    const unsubUpdate = subscribe(SOCKET_EVENTS.SIGNAL_UPDATE, (updated) => {
      setSignals((prev) => prev.map((s) => (s._id === updated._id ? updated : s)));
    });

    return () => { unsubNew(); unsubUpdate(); };
  }, [fetchSignals, subscribe]);

  return { signals, loading, error, refresh: fetchSignals };
};

export default useSignals;
