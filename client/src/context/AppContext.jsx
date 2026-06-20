/**
 * @file AppContext.jsx
 * @description Global app context — socket connection, market status, config
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import React, { createContext, useContext, useState } from 'react';
import PropTypes from 'prop-types';

const AppContext = createContext(null);

export const AppProvider = ({ children }) => {
  const [marketMode, setMarketMode] = useState('BULL');
  const [isConnected, setIsConnected] = useState(false);
  const [lastScanTime, setLastScanTime] = useState(null);
  const [config, setConfig] = useState(null);

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
