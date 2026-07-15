/**
 * @file AuthContext.jsx
 * @description Session state — who's logged in, loading state, login()/logout().
 *   On mount, checks GET /api/auth/me (cookie rides along automatically). No public
 *   signup — accounts are created via server/scripts/create-user.mjs only.
 * @author TradeZen Team
 * @created 2026-07-10
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import { authApi } from '../services/api.js';
import { resetSocket } from '../hooks/useSocket.js';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authApi
      .me()
      .then((res) => setUser(res.data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await authApi.login(email, password);
    setUser(res.data);
    return res.data;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => {});
    resetSocket();
    setUser(null);
  }, []);

  const value = { user, loading, login, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

AuthProvider.propTypes = { children: PropTypes.node.isRequired };

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
