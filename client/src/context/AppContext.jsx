/**
 * @file AppContext.jsx
 * @description Global app context — socket connection, market status, config
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { configApi } from '../services/api.js';

const AppContext = createContext(null);

export const AppProvider = ({ children }) => {
  // null (not a guessed mode) until the real fetch resolves — Layout.jsx mounts
  // useMarketStatus() on every page specifically so this never sits on a stale guess.
  const [marketMode, setMarketMode] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastScanTime, setLastScanTime] = useState(null);
  const [config, setConfig] = useState(null);

  // Fetched once app-wide so every page (not just Settings, which sets its own copy on
  // mount) can read live values like maxOpenTrades/capital without re-fetching.
  useEffect(() => {
    configApi.get().then((res) => setConfig(res.data)).catch(() => {});
  }, []);

  const value = {
    marketMode, setMarketMode,
    isConnected, setIsConnected,
    lastScanTime, setLastScanTime,
    config, setConfig,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

AppProvider.propTypes = { children: PropTypes.node.isRequired };

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};
