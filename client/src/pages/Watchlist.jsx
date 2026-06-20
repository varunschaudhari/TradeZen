/**
 * @file Watchlist.jsx
 * @description Watchlist management — view, add, and remove NSE stocks
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { watchlistApi } from '../services/api.js';
import { formatDateTime } from '../utils/formatters.js';

const Watchlist = () => {
  const [watchlist, setWatchlist] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [newSector, setNewSector] = useState('');

  const fetchWatchlist = async () => {
    try {
      const res = await watchlistApi.get();
      setWatchlist(res.data ?? []);
    } catch (err) {
      toast.error(`Failed to load watchlist: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchWatchlist(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    const sym = newSymbol.trim().toUpperCase();
    if (!sym) return;

    try {
      setAdding(true);
      await watchlistApi.add(sym, newSector.trim());
      toast.success(`${sym} added to watchlist`);
      setNewSymbol('');
      setNewSector('');
      await fetchWatchlist();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (symbol) => {
    try {
      await watchlistApi.remove(symbol);
      toast.success(`${symbol} removed`);
      setWatchlist((prev) => prev.filter((s) => s.symbol !== symbol));
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-surface p-4 space-y-6">
      <h1 className="text-xl font-bold text-slate-100">Watchlist</h1>

      {/* Add stock form */}
      <form onSubmit={handleAdd} className="card flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-slate-400 block mb-1">NSE Symbol</label>
          <input
            type="text"
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
            placeholder="e.g. RELIANCE"
            maxLength={20}
            className="bg-surface-elevated border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 w-40 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Sector (optional)</label>
          <input
            type="text"
            value={newSector}
            onChange={(e) => setNewSector(e.target.value)}
            placeholder="e.g. Energy"
            className="bg-surface-elevated border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 w-36 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <button type="submit" disabled={adding || !newSymbol.trim()} className="btn-primary">
          {adding ? 'Adding...' : '+ Add Stock'}
        </button>
      </form>

      {/* Watchlist table */}
      {loading ? (
        <div className="card animate-pulse space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-slate-700 rounded" />)}
        </div>
      ) : watchlist.length === 0 ? (
        <div className="card text-center py-12 text-slate-500">
          No stocks in watchlist. Add your first stock above.
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface-elevated">
              <tr>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Symbol</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Sector</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Added</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {watchlist.map((item, idx) => (
                <tr
                  key={item.symbol}
                  className={`border-t border-slate-700 ${idx % 2 === 0 ? '' : 'bg-surface-elevated/30'}`}
                >
                  <td className="px-4 py-3 font-mono font-bold text-slate-100">{item.symbol}</td>
                  <td className="px-4 py-3 text-slate-400">{item.sector ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{formatDateTime(item.addedDate)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRemove(item.symbol)}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Watchlist;
