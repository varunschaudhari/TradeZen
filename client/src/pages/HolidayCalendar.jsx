/**
 * @file HolidayCalendar.jsx
 * @description NSE trading holiday calendar — the full year's closures, with the next
 *   one called out and a reminder that a Telegram/email alert fires the prior trading
 *   evening (eveningSummary.js). Source list (constants.js NSE_HOLIDAY_LIST) is
 *   maintained by hand and needs yearly verification against the NSE circular.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { holidaysApi } from '../services/api.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const fmtDate = (dateStr) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return {
    day: d.getUTCDate(),
    month: MONTH_NAMES[d.getUTCMonth()],
    weekday: DAY_NAMES[d.getUTCDay()],
  };
};

const daysUntilLabel = (n) => {
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  return `In ${n} days`;
};

const HolidayCalendar = () => {
  const [holidays, setHolidays] = useState([]);
  const [next, setNext] = useState(null);
  const [year, setYear] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await holidaysApi.getAll();
      setHolidays(res.data?.holidays ?? []);
      setNext(res.data?.next ?? null);
      setYear(res.data?.year ?? null);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Group by month, in chronological order.
  const byMonth = holidays.reduce((acc, h) => {
    const { month } = fmtDate(h.date);
    (acc[month] ??= []).push(h);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface p-4 space-y-5 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Holiday Calendar</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            NSE trading holidays{year ? ` — ${year}` : ''} · scanner, price refresh, and alerts
            automatically pause on these dates
          </p>
        </div>
        <button onClick={load} className="btn-primary text-xs px-3 py-1">Refresh</button>
      </div>

      {error && <div className="card border-red-500/30 bg-red-500/10 text-red-400 text-sm">{error}</div>}

      {/* Next holiday hero */}
      {next ? (
        <div className="card card-wait">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Next Market Holiday</p>
          <div className="flex flex-wrap items-baseline gap-3">
            <p className="text-2xl font-bold text-wait">{next.name}</p>
            <span className="text-sm font-mono text-slate-400">
              {fmtDate(next.date).weekday}, {fmtDate(next.date).day} {fmtDate(next.date).month}
            </span>
          </div>
          <p className="text-sm font-mono text-wait mt-1">{daysUntilLabel(next.daysUntil)}</p>
        </div>
      ) : (
        <div className="card text-center py-6 text-slate-500 text-sm">
          No upcoming holidays left in this list — it likely needs updating for next year.
        </div>
      )}

      {/* Reminder note */}
      <div className="card border-slate-700/40 bg-slate-800/30 flex items-start gap-3">
        <span className="text-slate-400 text-lg">ℹ</span>
        <div className="text-xs text-slate-500 space-y-1">
          <p>
            <span className="text-slate-400 font-medium">Automatic reminder:</span> a Telegram/email
            alert fires the prior trading evening (as part of the 4:00 PM IST evening summary), so
            you know before the scanner goes quiet.
          </p>
          <p>
            This list is maintained by hand from the official NSE holiday circular and needs
            re-verification every year — dates shown are for {year ?? 'this year'} only.
          </p>
        </div>
      </div>

      {/* Full list, grouped by month */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-300 mb-3">Full Year</h2>
        <div className="space-y-4">
          {Object.entries(byMonth).map(([month, items]) => (
            <div key={month}>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">{month}</p>
              <div className="divide-y divide-slate-800/60">
                {items.map((h) => {
                  const { day, weekday } = fmtDate(h.date);
                  return (
                    <div
                      key={h.date}
                      className={`flex items-center gap-3 py-2 ${h.isPast ? 'opacity-40' : ''}`}
                    >
                      <div className="w-10 text-center flex-shrink-0">
                        <p className={`font-mono font-bold text-lg leading-none ${h.isToday ? 'text-wait' : 'text-slate-200'}`}>
                          {day}
                        </p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-200">{h.name}</p>
                        <p className="text-[11px] text-slate-500">{weekday}</p>
                      </div>
                      {h.isToday && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-wait/15 text-wait border border-wait/30 font-semibold">
                          Today
                        </span>
                      )}
                      {!h.isPast && !h.isToday && h.daysUntil <= 7 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 font-semibold whitespace-nowrap">
                          {daysUntilLabel(h.daysUntil)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {holidays.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-8">No holidays configured.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default HolidayCalendar;
