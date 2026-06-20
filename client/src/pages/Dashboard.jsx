/**
 * @file Dashboard.jsx
 * @description Main trading dashboard — market status, signals grid, candlestick chart, chat
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-15
 */

import React, { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import MarketStatusBar from '../components/MarketStatusBar.jsx';
import SignalCard from '../components/SignalCard.jsx';
import CandlestickChart from '../components/CandlestickChart.jsx';
import ChatWidget from '../components/ChatWidget.jsx';
import useSignals from '../hooks/useSignals.js';
import useMarketStatus from '../hooks/useMarketStatus.js';
import useSocket from '../hooks/useSocket.js';
import useCandleData from '../hooks/useCandleData.js';
import { useApp } from '../context/AppContext.jsx';
import { SOCKET_EVENTS } from '../utils/constants.js';
import { timeAgo } from '../utils/formatters.js';
import { signalsApi } from '../services/api.js';

const Dashboard = () => {
  const { signals, loading, error, refresh } = useSignals();
  const { market } = useMarketStatus();
  const { subscribe } = useSocket();
  const { lastScanTime, setLastScanTime } = useApp();
  const [scanning, setScanning] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const { candles, loading: chartLoading } = useCandleData(selectedSymbol);

  // Wire scan:complete → update last scan time
  useEffect(() => {
    return subscribe(SOCKET_EVENTS.SCAN_COMPLETE, (data) => {
      setLastScanTime(new Date());
      if (data.buySignals > 0) refresh();
    });
  }, [subscribe, setLastScanTime, refresh]);

  // Notify on bear mode
  useEffect(() => {
    return subscribe(SOCKET_EVENTS.MARKET_BEARMODE, () => {
      toast.error('BEAR MODE activated — all BUY signals are blocked', { duration: 8000 });
    });
  }, [subscribe]);

  // Notify on VIX spike
  useEffect(() => {
    return subscribe(SOCKET_EVENTS.MARKET_VIXSPIKE, ({ vix }) => {
      toast.error(`VIX spike: ${vix?.toFixed(1) ?? '—'} — elevated market risk`, { duration: 8000 });
    });
  }, [subscribe]);

  const handleManualScan = useCallback(async () => {
    try {
      setScanning(true);
      await signalsApi.triggerScan();
      toast.success('Scan queued — results arrive via WebSocket');
    } catch (err) {
      toast.error(`Scan failed: ${err.message}`);
    } finally {
      setScanning(false);
    }
  }, []);

  const handleSelectSignal = useCallback((signal) => {
    setSelectedSymbol((prev) => (prev === signal.symbol ? null : signal.symbol));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface p-4 space-y-4">
      <MarketStatusBar market={market} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-100">Signal Dashboard</h1>
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <span>
            Last scanned: {lastScanTime ? timeAgo(lastScanTime.toISOString()) : '—'}
          </span>
          <button
            onClick={refresh}
            className="btn-primary text-xs px-3 py-1"
          >
            Refresh
          </button>
          <button
            onClick={handleManualScan}
            disabled={scanning}
            className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs px-3 py-1 rounded-lg transition-colors"
          >
            {scanning ? 'Queuing…' : 'Scan Now'}
          </button>
        </div>
      </div>

      {error && (
        <div className="card border-red-500/30 bg-red-500/10 text-red-400">{error}</div>
      )}

      {/* Signals grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {signals.map((signal) => (
          <div
            key={signal._id}
            onClick={() => handleSelectSignal(signal)}
            className={`cursor-pointer transition-all ${selectedSymbol === signal.symbol ? 'ring-2 ring-blue-500 rounded-xl' : ''}`}
          >
            <SignalCard signal={signal} />
          </div>
        ))}
        {signals.length === 0 && (
          <p className="text-slate-500 col-span-3 text-center py-12">
            No signals yet — add stocks to your watchlist and click &quot;Scan Now&quot;.
          </p>
        )}
      </div>

      {/* Candlestick chart (shown when a signal is selected) */}
      {selectedSymbol && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300">
              Chart — {selectedSymbol}
            </h2>
            <button
              onClick={() => setSelectedSymbol(null)}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Close
            </button>
          </div>
          {chartLoading ? (
            <div className="card flex items-center justify-center h-40">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            </div>
          ) : (
            <CandlestickChart symbol={selectedSymbol} candles={candles} height={280} />
          )}
        </div>
      )}

      {/* Ask Claude */}
      <ChatWidget />
    </div>
  );
};

export default Dashboard;
