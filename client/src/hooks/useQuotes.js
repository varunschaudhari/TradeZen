/**
 * @file useQuotes.js
 * @description Hook — batch-fetches live price snapshots for a set of symbols.
 *   Re-fetches when the symbol set changes and whenever a scan completes.
 *   Returns a map: { SYMBOL: { price, prevClose, change, changePct } }.
 */

import { useState, useEffect, useCallback } from 'react';
import { quotesApi } from '../services/api.js';
import { SOCKET_EVENTS } from '../utils/constants.js';
import useSocket from './useSocket.js';

const useQuotes = (symbols) => {
  const [quotes, setQuotes] = useState({});
  const [loading, setLoading] = useState(false);
  const { subscribe } = useSocket();

  // Stable key so the effect only re-runs when the actual symbol set changes,
  // not on every render that produces a new array instance.
  const key = [...new Set(symbols)].sort().join(',');

  const load = useCallback(async () => {
    if (!key) { setQuotes({}); return; }
    try {
      setLoading(true);
      const res = await quotesApi.get(key.split(','));
      setQuotes(res.data ?? {});
    } catch {
      /* live price is non-critical — leave prior quotes in place */
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => { load(); }, [load]);

  // Refresh quotes after each scan completes
  useEffect(() => subscribe(SOCKET_EVENTS.SCAN_COMPLETE, () => load()), [subscribe, load]);

  return { quotes, loading, refresh: load };
};

export default useQuotes;
