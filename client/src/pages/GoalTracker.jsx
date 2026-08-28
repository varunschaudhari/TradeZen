/**
 * @file GoalTracker.jsx
 * @description Capital-target progress tracker — deliberately independent of the signal
 *   engine. Reads Trade/Config data only; never influences gates, scoring, or sizing.
 *   Charts actual capital growth against the CAGR trajectory required to hit a target
 *   amount by a target date.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { goalApi } from '../services/api.js';
import StatCard from '../components/StatCard.jsx';
import { formatCurrency, formatIndianNumber } from '../utils/formatters.js';

const TICK_STYLE = { fill: '#94a3b8', fontSize: 11 };

const STATUS_STYLE = {
  AHEAD:    { label: 'Ahead of plan',   color: 'text-emerald-400' },
  ON_TRACK: { label: 'On track',        color: 'text-blue-400' },
  BEHIND:   { label: 'Behind plan',     color: 'text-red-400' },
  NO_DATA:  { label: 'Not enough data', color: null },
};

const isoDate = (d) => new Date(d).toISOString().slice(0, 10);
const oneYearFromNow = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return isoDate(d);
};

const GoalChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-card border border-slate-600 rounded-lg px-3 py-2 text-xs shadow-xl space-y-1">
      <p className="text-slate-400 mb-1">{label}</p>
      {payload.map((p) => (
        p.value != null && (
          <p key={p.dataKey} className="font-mono font-semibold" style={{ color: p.color }}>
            {p.name}: {formatCurrency(p.value)}
          </p>
        )
      ))}
    </div>
  );
};

const inputClass = 'bg-surface-elevated border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 w-full focus:outline-none focus:ring-1 focus:ring-blue-500';

const GoalTracker = () => {
  const [goal, setGoal] = useState(null);
  const [progress, setProgress] = useState(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [form, setForm] = useState({ targetAmount: 10000000, targetDate: oneYearFromNow(), startCapital: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const goalRes = await goalApi.get();
      const g = goalRes.data;
      setGoal(g);

      if (g) {
        setEditing(false);
        setForm({ targetAmount: g.targetAmount, targetDate: isoDate(g.targetDate), startCapital: g.startCapital });
        const progRes = await goalApi.getProgress();
        setProgress(progRes.data);
      } else {
        setEditing(true);
        setProgress(null);
      }
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await goalApi.save({
        targetAmount: Number(form.targetAmount),
        targetDate: new Date(form.targetDate).toISOString(),
        startCapital: Number(form.startCapital),
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm('Clear this goal? Your trades and capital are untouched — only the target is removed.')) return;
    await goalApi.clear();
    setGoal(null);
    setProgress(null);
    setEditing(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
      </div>
    );
  }

  const status = progress ? STATUS_STYLE[progress.status] ?? STATUS_STYLE.NO_DATA : null;

  return (
    <div className="min-h-screen bg-surface p-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-100">Goal Tracker</h1>
        {goal && !editing && (
          <div className="flex items-center gap-2">
            <button onClick={() => setEditing(true)} className="btn-ghost text-xs px-3 py-1.5">Edit target</button>
            <button onClick={handleClear} className="btn-ghost text-xs px-3 py-1.5 text-red-400">Clear</button>
          </div>
        )}
      </div>

      {error && (
        <div className="card border-red-500/30 bg-red-500/10 text-red-400">{error}</div>
      )}

      {/* Independence disclaimer — this tracks capital, it does not influence it */}
      <div className="card border-l-4 border-l-wait bg-wait/[0.06] flex items-start gap-3 text-sm">
        <span className="text-wait text-lg leading-none mt-0.5">⚠</span>
        <div>
          <p className="font-semibold text-slate-200">Tracking only — this doesn&rsquo;t change how signals are generated</p>
          <p className="text-slate-400 mt-0.5">
            This page reads your actual closed-trade P&amp;L and charts it against the growth rate a target
            requires. It has zero effect on gates, scoring, or position sizing. Hitting the required line
            depends entirely on the underlying strategy having a real, positive edge — see Performance for
            the current edge-validation status.
          </p>
        </div>
      </div>

      {editing && (
        <form onSubmit={handleSave} className="card space-y-4 max-w-md">
          <h2 className="font-semibold text-slate-200">{goal ? 'Edit target' : 'Set a target'}</h2>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Target amount (₹)</label>
            <input
              type="number" min={1} step={1}
              value={form.targetAmount}
              onChange={(e) => setForm((f) => ({ ...f, targetAmount: e.target.value }))}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Target date</label>
            <input
              type="date"
              value={form.targetDate}
              onChange={(e) => setForm((f) => ({ ...f, targetDate: e.target.value }))}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Starting capital (₹) — your own number, independent of the trading system&rsquo;s configured capital
            </label>
            <input
              type="number" min={1} step={1}
              value={form.startCapital}
              onChange={(e) => setForm((f) => ({ ...f, startCapital: e.target.value }))}
              className={inputClass}
              required
            />
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={saving} className="btn-primary text-sm px-4 py-2">
              {saving ? 'Saving…' : 'Save target'}
            </button>
            {goal && (
              <button type="button" onClick={() => setEditing(false)} className="btn-ghost text-sm px-4 py-2">
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {progress && !editing && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Current Capital"
              value={formatIndianNumber(progress.currentCapital)}
              sub={`of ${formatIndianNumber(progress.goal.targetAmount)} target`}
            />
            <StatCard
              label="Progress"
              value={`${progress.pctOfTargetReached.toFixed(1)}%`}
              sub={`${progress.daysRemaining} days remaining`}
            />
            <StatCard
              label="Required CAGR"
              value={progress.requiredCAGRPct != null ? `${progress.requiredCAGRPct.toFixed(1)}%/yr` : '—'}
              color="text-blue-400"
            />
            <StatCard
              label="Your CAGR so far"
              value={progress.actualCAGRPct != null ? `${progress.actualCAGRPct.toFixed(1)}%/yr` : 'Too early'}
              color={progress.actualCAGRPct == null ? null : progress.actualCAGRPct >= (progress.requiredCAGRPct ?? 0) ? 'text-emerald-400' : 'text-red-400'}
            />
          </div>

          <div className="card">
            <p className="text-slate-400 text-xs mb-1">Status</p>
            <p className={`text-lg font-semibold ${status.color ?? 'text-slate-400'}`}>{status.label}</p>
            {progress.requiredCapitalAtNow != null && (
              <p className="text-slate-500 text-xs mt-1">
                Required by now: {formatCurrency(progress.requiredCapitalAtNow)} · Actual: {formatCurrency(progress.currentCapital)}
              </p>
            )}
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-300">Capital Growth vs Required Trajectory</h3>
              <div className="flex items-center gap-4 text-[11px]">
                <span className="flex items-center gap-1.5 text-blue-400">
                  <span className="inline-block w-5 h-0.5 bg-blue-400 rounded" />Actual
                </span>
                <span className="flex items-center gap-1.5 text-amber-400">
                  <span className="inline-block w-5 h-0.5 bg-amber-400 rounded border-dashed border border-amber-400" />Required
                </span>
              </div>
            </div>
            {progress.points.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-8">No data points yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={progress.points} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="label" tick={TICK_STYLE} />
                  <YAxis tick={TICK_STYLE} tickFormatter={(v) => formatIndianNumber(v)} width={64} />
                  <Tooltip content={<GoalChartTooltip />} />
                  <Line
                    type="monotone" dataKey="requiredCapital" name="Required"
                    stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" dot={false} connectNulls
                  />
                  <Line
                    type="monotone" dataKey="actualCapital" name="Actual"
                    stroke="#3b82f6" strokeWidth={2} dot={{ r: 3, fill: '#3b82f6', strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default GoalTracker;
