/**
 * @file useMarketStatus.js
 * @description Hook — fetches live market data and keeps AppContext.marketMode in sync.
 */

import { useState, useEffect, useCallback } from 'react';
import { marketApi } from '../services/api.js';
import { SOCKET_EVENTS } from '../utils/constants.js';
import { useApp } from '../context/AppContext.jsx';
import useSocket from './useSocket.js';

const useMarketStatus = () => {
  const [market,  setMarket]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const { subscribe }         = useSocket();
  const { setMarketMode }     = useApp();

  const applyMarket = useCallback((data) => {
    setMarket(data);
    if (data?.marketMode) setMarketMode(data.marketMode);
  }, [setMarketMode]);

  const fetchMarket = useCallback(async () => {
    try {
      const response = await marketApi.get();
      applyMarket(response.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [applyMarket]);

  useEffect(() => {
    fetchMarket();
    const unsub = subscribe(SOCKET_EVENTS.MARKET_UPDATE, applyMarket);
    return unsub;
  }, [fetchMarket, subscribe, applyMarket]);

  return { market, loading, error };
};

export default useMarketStatus;
