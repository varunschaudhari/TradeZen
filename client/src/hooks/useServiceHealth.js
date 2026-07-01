/**
 * @file useServiceHealth.js
 * @description Polls GET /api/health every 30 s and returns { node, db, python }
 *   each being 'ok' | 'down' | 'loading'.
 */

import { useState, useEffect } from 'react';

const POLL_MS = 30_000;

const useServiceHealth = () => {
  const [health, setHealth] = useState({ node: 'loading', db: 'loading', python: 'loading' });

  const check = async () => {
    try {
      const res  = await fetch('/api/health');
      const data = await res.json();
      setHealth({
        node:   data.success              ? 'ok' : 'down',
        db:     data.db     === 'connected' ? 'ok' : 'down',
        python: data.python === 'connected' ? 'ok' : 'down',
      });
    } catch {
      setHealth({ node: 'down', db: 'down', python: 'down' });
    }
  };

  useEffect(() => {
    check();
    const id = setInterval(check, POLL_MS);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return health;
};

export default useServiceHealth;
