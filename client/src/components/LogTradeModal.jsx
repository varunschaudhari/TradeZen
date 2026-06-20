/**
 * @file LogTradeModal.jsx
 * @description Modal form for manually logging a new trade entry.
 *   Auto-calculates capital deployed and R:R ratio from user inputs.
 *   Pre-fills from a BUY signal if `prefill` prop is provided.
 *
 *  IMPORTANT: This platform never places orders. This only logs trades for tracking.
 */

import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import toast from 'react-hot-toast';
import { tradesApi } from '../services/api.js';
import { formatCurrency } from '../utils/formatters.js';

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

const LogTradeModal = ({ onClose, onSuccess, prefill }) => {
  const [form, setForm] = useState({
    symbol:      prefill?.symbol ?? '',
    entryPrice:  prefill?.entryZone?.low  ? String(prefill.entryZone.low)  : '',
    stopLoss:    prefill?.stopLoss        ? String(prefill.stopLoss)        : '',
    target1:     prefill?.target1         ? String(prefill.target1)         : '',
    target2:     prefill?.target2         ? String(prefill.target2)         : '',
    shares:      prefill?.shares          ? String(prefill.shares)          : '',
    notes:       '',
  });
  const [submitting, setSubmitting] = useState(false);

  const num = (key) => parseFloat(form[key]);

  /* Auto-calculated values */
  const capitalDeployed = (num('entryPrice') > 0 && num('shares') > 0)
    ? num('entryPrice') * parseInt(form.shares, 10)
    : null;

  const rr = (num('entryPrice') > 0 && num('stopLoss') > 0 && num('target1') > 0)
    ? (num('target1') - num('entryPrice')) / (num('entryPrice') - num('stopLoss'))
    : null;

  const update = useCallback((key, value) =>
    setForm((prev) => ({ ...prev, [key]: value })), []);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    const { symbol, entryPrice, stopLoss, target1, shares } = form;
    if (!symbol.trim() || !entryPrice || !stopLoss || !target1 || !shares) {
      toast.error('Fill in all required fields');
      return;
    }
    if (num('stopLoss') >= num('entryPrice')) {
      toast.error('Stop loss must be below entry price');
      return;
    }
    if (num('target1') <= num('entryPrice')) {
      toast.error('Target 1 must be above entry price');
      return;
    }
    const payload = {
      symbol:          symbol.trim().toUpperCase(),
      entryPrice:      num('entryPrice'),
      stopLoss:        num('stopLoss'),
      target1:         num('target1'),
      shares:          parseInt(shares, 10),
      capitalDeployed: num('entryPrice') * parseInt(shares, 10),
      ...(form.target2 && { target2: num('target2') }),
      ...(form.notes   && { notes: form.notes }),
    };
    try {
      setSubmitting(true);
      const res = await tradesApi.create(payload);
      toast.success(`${payload.symbol} trade logged successfully`);
      onSuccess?.(res.data);
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }, [form, onClose, onSuccess]);

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card w-full max-w-md max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-semibold text-slate-100">Log New Trade</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Manual entry only — no orders are placed automatically.
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
          {/* Symbol */}
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

          {/* Entry + Shares */}
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

          {/* Stop Loss */}
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

          {/* Targets */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Target 1 (₹)" required>
              <input
                type="number" step="0.01" min="0.01"
                value={form.target1}
                onChange={(e) => update('target1', e.target.value)}
                placeholder="0.00"
                className="input w-full"
                required
              />
            </Field>
            <Field label="Target 2 (₹)">
              <input
                type="number" step="0.01" min="0.01"
                value={form.target2}
                onChange={(e) => update('target2', e.target.value)}
                placeholder="0.00"
                className="input w-full"
              />
            </Field>
          </div>

          {/* Auto-calculated summary */}
          {(capitalDeployed != null || rr != null) && (
            <div className="bg-surface-elevated border border-slate-700 rounded-lg p-3 space-y-1.5 text-xs">
              {capitalDeployed != null && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Capital Deployed</span>
                  <span className="font-mono font-semibold text-slate-100">
                    {formatCurrency(capitalDeployed)}
                  </span>
                </div>
              )}
              {rr != null && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Risk : Reward</span>
                  <span className={`font-mono font-semibold ${rr >= 2 ? 'text-bull' : 'text-bear'}`}>
                    {rr.toFixed(2)} : 1
                    {rr < 2 && <span className="ml-1 text-bear">⚠ below 2:1</span>}
                  </span>
                </div>
              )}
              {num('stopLoss') > 0 && num('entryPrice') > 0 && capitalDeployed != null && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Max Loss</span>
                  <span className="font-mono text-bear">
                    {formatCurrency(
                      (num('entryPrice') - num('stopLoss')) * parseInt(form.shares || '0', 10)
                    )}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              placeholder="Entry trigger, setup, or position rationale…"
              rows={2}
              maxLength={500}
              className="input w-full resize-none"
            />
          </Field>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Logging…' : 'Log Trade'}
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

LogTradeModal.propTypes = {
  onClose:   PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
  prefill:   PropTypes.shape({
    symbol:    PropTypes.string,
    entryZone: PropTypes.shape({ low: PropTypes.number }),
    stopLoss:  PropTypes.number,
    target1:   PropTypes.number,
    target2:   PropTypes.number,
    shares:    PropTypes.number,
  }),
};

export default LogTradeModal;
