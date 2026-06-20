/**
 * @file useCandleData.js
 * @description Hook — fetches OHLCV candle data from /api/ohlcv/:symbol on demand
 * @author SwingTrader AI Team
 */

import { useState, useEffect } from 'react';
import { ohlcvApi } from '../services/api.js';

const useCandleData = (symbol, period = '60d', interval = '15m') => {
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!symbol) {
      setCandles([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    ohlcvApi
      .get(symbol, period, interval)
      .then((res) => {
        if (!cancelled) setCandles(res.data ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [symbol, period, interval]);

  return { candles, loading, error };
};

export default useCandleData;
