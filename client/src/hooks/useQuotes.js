/**
 * @file useQuotes.js
 * @description Hook — batch-fetches live price snapshots for a set of symbols.
 *   Polls every 60 s so the watchlist price column stays current without a manual refresh.
 *   Returns { quotes, loading, refreshedAt, refresh }.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { quotesApi } from '../services/api.js';
import { SOCKET_EVENTS } from '../utils/constants.js';
import useSocket from './useSocket.js';

const POLL_MS = 60_000; // refresh every 60 s unconditionally (yfinance returns last close off-hours)

const useQuotes = (symbols) => {
  const [quotes,      setQuotes]      = useState({});
  const [loading,     setLoading]     = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const { subscribe } = useSocket();

  // Stable key so the effect only re-runs when the actual symbol set changes,
  // not on every render that produces a new array instance.
  const key = [...new Set(symbols)].sort().join(',');

  // Keep the latest key accessible inside the interval without re-creating it
  const keyRef = useRef(key);
  useEffect(() => { keyRef.current = key; }, [key]);

  const load = useCallback(async (k = keyRef.current) => {
    if (!k) { setQuotes({}); return; }
    try {
      setLoading(true);
      const res = await quotesApi.get(k.split(','));
      const map = res?.data ?? res ?? {};
      if (Object.keys(map).length) {
        setQuotes(map);
        setRefreshedAt(new Date());
      }
    } catch {
      /* live price is non-critical — leave prior quotes in place */
    } finally {
      setLoading(false);
    }
  }, []); // no deps — uses keyRef so it's stable across key changes

  // Initial load + re-load whenever symbol set changes
  useEffect(() => { load(key); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // 60-second polling interval
  useEffect(() => {
    const id = setInterval(() => load(keyRef.current), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Also refresh after each scan completes
  useEffect(() => subscribe(SOCKET_EVENTS.SCAN_COMPLETE, () => load(keyRef.current)), [subscribe, load]);

  return { quotes, loading, refreshedAt, refresh: () => load(keyRef.current) };
};

export default useQuotes;
