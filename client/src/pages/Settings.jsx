/**
 * @file Settings.jsx
 * @description App settings — capital, risk %, notifications, paper/live mode toggle
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { configApi } from '../services/api.js';

const LIVE_MODE_COUNTDOWN_SECONDS = 5;

const Settings = () => {
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [liveConfirm, setLiveConfirm] = useState(false);
  const [countdown, setCountdown] = useState(LIVE_MODE_COUNTDOWN_SECONDS);

  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await configApi.get();
        setConfig(res.data);
      } catch (err) {
        toast.error(`Failed to load config: ${err.message}`);
      }
    };
    fetch();
  }, []);

  useEffect(() => {
    if (!liveConfirm) { setCountdown(LIVE_MODE_COUNTDOWN_SECONDS); return; }
    if (countdown === 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [liveConfirm, countdown]);

  const handleSave = async () => {
    if (!config) return;
    try {
      setSaving(true);
      await configApi.update(config);
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLiveModeConfirm = async () => {
    if (countdown > 0) return;
    try {
      await configApi.update({ paperTradeMode: false });
      setConfig((c) => ({ ...c, paperTradeMode: false }));
      setLiveConfirm(false);
      toast.success('Switched to LIVE mode — real money at risk');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const update = (key, value) => setConfig((c) => ({ ...c, [key]: value }));

  if (!config) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface p-4 space-y-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-slate-100">Settings</h1>

      {/* Paper trade warning */}
      {config.paperTradeMode ? (
        <div className="card border-yellow-500/30 bg-yellow-500/10 text-yellow-300 text-sm">
          <strong>Paper Trade Mode ON</strong> — No real money at risk. Signals are for simulation only.
        </div>
      ) : (
        <div className="card border-red-500/30 bg-red-500/10 text-red-300 text-sm animate-pulse-slow">
          ⚠ <strong>LIVE Mode ACTIVE</strong> — Real money is at risk. Trade with caution.
        </div>
      )}

      {/* Capital & Risk */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-slate-200">Capital & Risk</h2>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Trading Capital (₹)</label>
          <input
            type="number"
            value={config.capital}
            onChange={(e) => update('capital', Number(e.target.value))}
            min={10000}
            className="bg-surface-elevated border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">
            Risk per Trade (%) — min 0.1%, max 5%
          </label>
          <input
            type="number"
            value={config.riskPercentage}
            onChange={(e) => update('riskPercentage', Number(e.target.value))}
            min={0.1}
            max={5}
            step={0.1}
            className="bg-surface-elevated border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Max Simultaneous Trades</label>
          <input
            type="number"
            value={config.maxOpenTrades}
            onChange={(e) => update('maxOpenTrades', Number(e.target.value))}
            min={1}
            max={10}
            className="bg-surface-elevated border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Notifications */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-slate-200">Notifications</h2>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Telegram Chat ID</label>
          <input
            type="text"
            value={config.telegramChatId ?? ''}
            onChange={(e) => update('telegramChatId', e.target.value)}
            placeholder="-1001234567890"
            className="bg-surface-elevated border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Alert Email</label>
          <input
            type="email"
            value={config.emailRecipient ?? ''}
            onChange={(e) => update('emailRecipient', e.target.value)}
            placeholder="alerts@yourdomain.com"
            className="bg-surface-elevated border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Save */}
      <button onClick={handleSave} disabled={saving} className="btn-primary w-full">
        {saving ? 'Saving...' : 'Save Settings'}
      </button>

      {/* Paper → Live mode toggle */}
      {config.paperTradeMode && (
        <div className="card border-red-500/30 space-y-3">
          <h2 className="font-semibold text-red-400">Danger Zone</h2>
          {!liveConfirm ? (
            <button
              onClick={() => setLiveConfirm(true)}
              className="btn-danger w-full"
            >
              Switch to LIVE Mode
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-red-300 text-sm font-semibold">
                ⚠ You are switching to LIVE mode. Real money is at risk. Are you sure?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleLiveModeConfirm}
                  disabled={countdown > 0}
                  className="flex-1 btn-danger disabled:opacity-50"
                >
                  {countdown > 0 ? `Confirm in ${countdown}s` : 'Confirm — Go LIVE'}
                </button>
                <button
                  onClick={() => setLiveConfirm(false)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Settings;
