/**
 * @file IntradayPanel.jsx
 * @description Intraday paper-trade lane on the Positions page — today's ORB alerts and
 *   manually logged intraday trades, with live unrealized P&L, a log modal, and manual
 *   close. Strictly separate from the swing book: separate collection, separate paper
 *   capital, and MANUAL entries never touch the ORB track record or go-live evidence.
 *
 *   IMPORTANT: This platform never places orders. Intraday trades here are paper records.
 */

import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import toast from 'react-hot-toast';
import { intradayApi } from '../services/api.js';
import { formatCurrency } from '../utils/formatters.js';
import useSocket from '../hooks/useSocket.js';
import { SOCKET_EVENTS } from '../utils/constants.js';

const POLL_MS = 45_000;

const EXIT_META = {
  TARGET:    { label: 'Target',     cls: 'text-bull' },
  STOPLOSS:  { label: 'Stop',       cls: 'text-bear' },
  SQUAREOFF: { label: 'Square-off', cls: 'text-slate-300' },
  MANUAL:    { label: 'Manual',     cls: 'text-slate-300' },
};

const SourceBadge = ({ source }) => (
  <span
    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ${
      source === 'MANUAL'
        ? 'bg-sky-900/60 text-sky-300 border border-sky-700/50'
        : 'bg-amber-900/60 text-amber-300 border border-amber-700/50'
    }`}
  >
    {source === 'MANUAL' ? 'MANUAL' : 'ORB'}
  </span>
);

SourceBadge.propTypes = { source: PropTypes.string };

/* ── Log Intraday Trade modal ─────────────────────────────────────────────────── */
const Field = ({ label, required, children }) => (
  <div>
    <label className="text-xs text-slate-400 block mb-1">
      {label} {required && <span className="text-bear">*</span>}
    </label>
    {children}
  </div>
);

Field.propTypes = {
  label: PropTypes.string.isRequired,
  required: PropTypes.bool,
  children: PropTypes.node.isRequired,
};

const LogIntradayModal = ({ onClose, onSuccess }) => {
  const [form, setForm] = useState({ symbol: '', entryPrice: '', stopLoss: '', target: '', shares: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const num = (key) => parseFloat(form[key]);
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const capitalDeployed =
    num('entryPrice') > 0 && num('shares') > 0 ? num('entryPrice') * parseInt(form.shares, 10) : null;
  const rr =
    num('entryPrice') > 0 && num('stopLoss') > 0 && num('target') > 0
      ? (num('target') - num('entryPrice')) / (num('entryPrice') - num('stopLoss'))
      : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.symbol.trim() || !form.entryPrice || !form.stopLoss || !form.target || !form.shares) {
      toast.error('Fill in all required fields');
      return;
    }
    if (num('stopLoss') >= num('entryPrice')) {
      toast.error('Stop loss must be below entry price');
      return;
    }
    if (num('target') <= num('entryPrice')) {
      toast.error('Target must be above entry price');
      return;
    }
    try {
      setSubmitting(true);
      const res = await intradayApi.logTrade({
        symbol: form.symbol.trim().toUpperCase(),
        entryPrice: num('entryPrice'),
        stopLoss: num('stopLoss'),
        target: num('target'),
        shares: parseInt(form.shares, 10),
        ...(form.notes && { notes: form.notes }),
      });
      toast.success(`${res.data.symbol} intraday trade logged (paper)`);
      onSuccess?.(res.data);
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card w-full max-w-md max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-semibold text-slate-100">Log Intraday Trade</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Paper record for today&apos;s session — square off by 15:15 IST. No orders are placed.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 transition-colors text-2xl leading-none w-7 h-7 flex items-center justify-center"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="NSE Symbol" required>
            <input
              type="text"
              value={form.symbol}
              onChange={(e) => update('symbol', e.target.value.toUpperCase())}
              placeholder="RELIANCE"
              maxLength={20}
              className="input w-full font-mono"
              required
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Entry Price (₹)" required>
              <input
                type="number" step="0.01" min="0.01"
                value={form.entryPrice}
                onChange={(e) => update('entryPrice', e.target.value)}
                placeholder="0.00"
                className="input w-full"
                required
              />
            </Field>
            <Field label="Shares" required>
              <input
                type="number" step="1" min="1"
                value={form.shares}
                onChange={(e) => update('shares', e.target.value)}
                placeholder="0"
                className="input w-full"
                required
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Stop Loss (₹)" required>
              <input
                type="number" step="0.01" min="0.01"
                value={form.stopLoss}
                onChange={(e) => update('stopLoss', e.target.value)}
                placeholder="0.00"
                className="input w-full"
                required
              />
            </Field>
            <Field label="Target (₹)" required>
              <input
                type="number" step="0.01" min="0.01"
                value={form.target}
                onChange={(e) => update('target', e.target.value)}
                placeholder="0.00"
                className="input w-full"
                required
              />
            </Field>
          </div>

          {(capitalDeployed != null || rr != null) && (
            <div className="bg-surface-elevated border border-slate-700 rounded-lg p-3 space-y-1.5 text-xs">
              {capitalDeployed != null && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Capital Deployed</span>
                  <span className="font-mono font-semibold text-slate-100">{formatCurrency(capitalDeployed)}</span>
                </div>
              )}
              {rr != null && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Risk : Reward</span>
                  <span className={`font-mono font-semibold ${rr >= 1.5 ? 'text-bull' : 'text-bear'}`}>
                    {rr.toFixed(2)} : 1
                  </span>
                </div>
              )}
            </div>
          )}

          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              placeholder="Setup, trigger, or reasoning…"
              rows={2}
              maxLength={500}
              className="input w-full resize-none"
            />
          </Field>

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Logging…' : 'Log Intraday Trade'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

LogIntradayModal.propTypes = {
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};

/* ── Panel ────────────────────────────────────────────────────────────────────── */
const IntradayPanel = () => {
  const [session, setSession] = useState({ sessionDate: null, open: [], settled: [] });
  const [showLogModal, setShowLogModal] = useState(false);
  const [closingId, setClosingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const { subscribe } = useSocket();

  const load = useCallback(async () => {
    try {
      const res = await intradayApi.getLive();
      setSession(res.data ?? { sessionDate: null, open: [], settled: [] });
    } catch {
      /* endpoint unavailable — leave panel empty */
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => subscribe(SOCKET_EVENTS.INTRADAY_ORB, () => load()), [subscribe, load]);

  const handleClose = async (id) => {
    try {
      setBusy(true);
      const res = await intradayApi.closeTrade(id);
      const t = res.data;
      const meta = EXIT_META[t.exitReason] ?? { label: t.exitReason };
      toast.success(`${t.symbol} closed @ ₹${t.exitPrice} (${meta.label}, net ${formatCurrency(t.paperPnl)})`);
      setClosingId(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const { open, settled } = session;
  const settledNet = settled.reduce((s, t) => s + (t.paperPnl ?? 0), 0);

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-100">Intraday — Paper</h3>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-700/70 text-slate-300 border border-slate-600/50">
            EXPERIMENTAL · SEPARATE CAPITAL
          </span>
        </div>
        <button
          onClick={() => setShowLogModal(true)}
          className="px-2 py-1 rounded text-xs bg-sky-900/60 hover:bg-sky-800/70 text-sky-300 border border-sky-700/50 font-medium transition-colors"
        >
          + Log Intraday
        </button>
      </div>

      {open.length === 0 && settled.length === 0 ? (
        <p className="text-sm text-slate-500">
          No intraday entries this session. ORB alerts land here automatically (10:15–14:00 IST);
          use <strong className="text-sky-300">+ Log Intraday</strong> to track a trade you took yourself.
        </p>
      ) : (
        <div className="space-y-4">
          {/* Open entries */}
          {open.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 text-left border-b border-slate-700/60">
                    <th className="py-1.5 pr-3 font-medium">Symbol</th>
                    <th className="py-1.5 pr-3 font-medium">Entry</th>
                    <th className="py-1.5 pr-3 font-medium">Stop</th>
                    <th className="py-1.5 pr-3 font-medium">Target</th>
                    <th className="py-1.5 pr-3 font-medium">Qty</th>
                    <th className="py-1.5 pr-3 font-medium">Live</th>
                    <th className="py-1.5 pr-3 font-medium">P&L (gross)</th>
                    <th className="py-1.5 pr-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {open.map((t) => (
                    <tr key={t._id} className="border-b border-slate-800/60">
                      <td className="py-2 pr-3">
                        <span className="font-mono font-semibold text-slate-100">{t.symbol}</span>{' '}
                        <SourceBadge source={t.source} />
                        {t.stopBreached && (
                          <span className="ml-1 text-[10px] text-bear font-semibold">▼ below stop</span>
                        )}
                        {t.targetReached && (
                          <span className="ml-1 text-[10px] text-bull font-semibold">▲ target hit</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono">{t.breakoutPrice?.toFixed(2) ?? '—'}</td>
                      <td className="py-2 pr-3 font-mono text-bear">{t.suggestedStop?.toFixed(2) ?? '—'}</td>
                      <td className="py-2 pr-3 font-mono text-bull">{t.suggestedTarget?.toFixed(2) ?? '—'}</td>
                      <td className="py-2 pr-3 font-mono">{t.shares ?? '—'}</td>
                      <td className="py-2 pr-3 font-mono">{t.currentPrice?.toFixed(2) ?? '—'}</td>
                      <td className={`py-2 pr-3 font-mono ${(t.unrealizedGross ?? 0) >= 0 ? 'text-bull' : 'text-bear'}`}>
                        {t.unrealizedGross != null ? formatCurrency(t.unrealizedGross) : '—'}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {closingId === String(t._id) ? (
                          <span className="inline-flex gap-1.5">
                            <button
                              disabled={busy}
                              onClick={() => handleClose(t._id)}
                              className="px-2 py-0.5 rounded text-xs bg-bear/20 hover:bg-bear/30 text-bear border border-bear/40 disabled:opacity-50"
                            >
                              Confirm @ live
                            </button>
                            <button
                              onClick={() => setClosingId(null)}
                              className="px-2 py-0.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300"
                            >
                              ×
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setClosingId(String(t._id))}
                            className="px-2 py-0.5 rounded text-xs bg-slate-700/70 hover:bg-slate-600 text-slate-300 border border-slate-600/50"
                          >
                            Close
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Settled today */}
          {settled.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs text-slate-500 font-medium">Settled today</p>
                <p className={`text-xs font-mono font-semibold ${settledNet >= 0 ? 'text-bull' : 'text-bear'}`}>
                  Net {formatCurrency(settledNet)}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {settled.map((t) => {
                      const meta = EXIT_META[t.exitReason] ?? { label: t.exitReason, cls: 'text-slate-300' };
                      return (
                        <tr key={t._id} className="border-b border-slate-800/60 last:border-0">
                          <td className="py-1.5 pr-3">
                            <span className="font-mono font-semibold text-slate-200">{t.symbol}</span>{' '}
                            <SourceBadge source={t.source} />
                          </td>
                          <td className="py-1.5 pr-3 font-mono text-slate-400">
                            {t.breakoutPrice?.toFixed(2)} → {t.exitPrice?.toFixed(2)}
                          </td>
                          <td className={`py-1.5 pr-3 text-xs font-semibold ${meta.cls}`}>{meta.label}</td>
                          <td className="py-1.5 pr-3 font-mono text-slate-400">
                            {t.rMultiple != null ? `${t.rMultiple.toFixed(2)}R` : '—'}
                          </td>
                          <td className={`py-1.5 font-mono text-right ${(t.paperPnl ?? 0) >= 0 ? 'text-bull' : 'text-bear'}`}>
                            {t.paperPnl != null ? formatCurrency(t.paperPnl) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {showLogModal && (
        <LogIntradayModal onClose={() => setShowLogModal(false)} onSuccess={() => load()} />
      )}
    </div>
  );
};

export default IntradayPanel;
