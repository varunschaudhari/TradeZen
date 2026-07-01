/**
 * @file Alerts.jsx
 * @description User-set price alert management — create "notify me when SYMBOL crosses ₹X" thresholds.
 *   Alerts are checked every 2 min during market hours; triggered alerts fire as in-app notifications
 *   (and Telegram if configured). Triggered alerts auto-deactivate after firing.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { alertsApi } from '../services/api.js';
import { formatCurrency } from '../utils/formatters.js';
import { SOCKET_EVENTS } from '../utils/constants.js';
import useSocket from '../hooks/useSocket.js';

const Alerts = () => {
  const [alerts,     setAlerts]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ symbol: '', targetPrice: '', direction: 'above', note: '' });
  const { subscribe } = useSocket();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await alertsApi.getAll();
      setAlerts(res.data ?? []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Real-time: when an alert fires, mark it triggered in state without full reload
  useEffect(() => {
    return subscribe(SOCKET_EVENTS.PRICE_ALERT, (d) => {
      setAlerts((prev) =>
        prev.map((a) => a._id === d.alertId ? { ...a, active: false, triggeredAt: d.timestamp } : a)
      );
    });
  }, [subscribe]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.symbol.trim() || !form.targetPrice) return;
    try {
      setSubmitting(true);
      const res = await alertsApi.create({
        symbol:      form.symbol.toUpperCase().trim(),
        targetPrice: parseFloat(form.targetPrice),
        direction:   form.direction,
        note:        form.note.trim(),
      });
      setAlerts((prev) => [res.data, ...prev]);
      toast.success(`Alert set: ${res.data.symbol} ${res.data.direction === 'above' ? '▲ above' : '▼ below'} ${formatCurrency(res.data.targetPrice)}`);
      setForm({ symbol: '', targetPrice: '', direction: 'above', note: '' });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (id) => {
    try {
      const res = await alertsApi.toggle(id);
      setAlerts((prev) => prev.map((a) => a._id === id ? res.data : a));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async (id) => {
    try {
      await alertsApi.remove(id);
      setAlerts((prev) => prev.filter((a) => a._id !== id));
      toast.success('Alert removed');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const activeCount    = alerts.filter((a) => a.active).length;
  const triggeredCount = alerts.filter((a) => a.triggeredAt).length;

  return (
    <div className="min-h-screen bg-surface p-4 space-y-4">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Price Alerts</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Checked every 2 min during market hours · notified in-app and via Telegram
          </p>
        </div>
        <button onClick={load} className="btn-primary text-xs px-3 py-1">Refresh</button>
      </div>

      {/* Summary chips */}
      {alerts.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-700/40 font-medium">
            {activeCount} active
          </span>
          {triggeredCount > 0 && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-slate-700/60 text-slate-400 border border-slate-600/40 font-medium">
              {triggeredCount} triggered
            </span>
          )}
        </div>
      )}

      {/* New alert form */}
      <div className="card space-y-3">
        <h2 className="text-sm font-semibold text-slate-300">Set New Alert</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Symbol</label>
              <input
                type="text"
                value={form.symbol}
                onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value.toUpperCase() }))}
                placeholder="IPCALAB"
                className="input w-full font-mono text-sm uppercase"
                maxLength={20}
                required
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Target price (₹)</label>
              <input
                type="number"
                value={form.targetPrice}
                onChange={(e) => setForm((f) => ({ ...f, targetPrice: e.target.value }))}
                placeholder="2400"
                className="input w-full text-sm"
                min="0.01"
                step="0.05"
                required
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Direction</label>
              <select
                value={form.direction}
                onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))}
                className="input w-full text-sm"
              >
                <option value="above">▲ Crosses above</option>
                <option value="below">▼ Drops below</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Note (optional)</label>
              <input
                type="text"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="breakout level"
                className="input w-full text-sm"
                maxLength={100}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting || !form.symbol.trim() || !form.targetPrice}
              className="btn-primary text-sm px-5 py-2 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : '+ Set Alert'}
            </button>
          </div>
        </form>
      </div>

      {/* Alert list */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-300">
            All Alerts
            {alerts.length > 0 && (
              <span className="ml-2 text-slate-500 font-normal">({alerts.length})</span>
            )}
          </h2>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="skeleton h-14 rounded" />)}
          </div>
        ) : alerts.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">🔔</p>
            <p className="text-slate-400 font-medium">No alerts yet</p>
            <p className="text-slate-500 text-xs mt-1 max-w-xs mx-auto">
              Use the form above to get notified when a stock price crosses a threshold you set.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {alerts.map((alert) => (
              <div
                key={alert._id}
                className={`flex items-center gap-3 py-3 transition-opacity ${!alert.active ? 'opacity-50' : ''}`}
              >
                {/* Status dot */}
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    alert.triggeredAt ? 'bg-slate-500' :
                    alert.active      ? 'bg-emerald-500 animate-pulse' :
                                        'bg-slate-600'
                  }`}
                  title={alert.triggeredAt ? 'Triggered' : alert.active ? 'Active' : 'Paused'}
                />

                {/* Main content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-slate-100 text-sm">{alert.symbol}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium border ${
                      alert.direction === 'above'
                        ? 'bg-bull/10 text-bull border-bull/30'
                        : 'bg-bear/10 text-bear border-bear/30'
                    }`}>
                      {alert.direction === 'above' ? '▲' : '▼'} {formatCurrency(alert.targetPrice)}
                    </span>
                    {alert.triggeredAt && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 border border-slate-600">
                        Triggered
                      </span>
                    )}
                    {!alert.active && !alert.triggeredAt && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-500">
                        Paused
                      </span>
                    )}
                  </div>
                  {alert.note && (
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">{alert.note}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {!alert.triggeredAt && (
                    <button
                      onClick={() => handleToggle(alert._id)}
                      className="text-[11px] px-2.5 py-1 rounded border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
                    >
                      {alert.active ? 'Pause' : 'Resume'}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(alert._id)}
                    className="text-[11px] px-2.5 py-1 rounded border border-bear/30 text-bear/70 hover:text-bear hover:border-bear/60 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* How it works note */}
      <div className="card border-slate-700/40 bg-slate-800/30 flex items-start gap-3">
        <span className="text-slate-400 text-lg">ℹ</span>
        <div className="text-xs text-slate-500 space-y-1">
          <p><span className="text-slate-400 font-medium">Checked every 2 minutes</span> during NSE market hours (9:15–15:30 IST, Mon–Fri).</p>
          <p>When a price crosses the threshold, the alert fires once then auto-deactivates. Hit Resume to re-arm it.</p>
          <p>Notifications appear in the bell icon above (in-app) and via Telegram if your bot token is configured in Settings.</p>
        </div>
      </div>

    </div>
  );
};

export default Alerts;
