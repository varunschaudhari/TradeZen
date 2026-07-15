/**
 * @file PnlCalendar.jsx
 * @description 52-week GitHub-style P&L heatmap calendar for closed swing trades.
 */

import React, { useMemo } from 'react';
import PropTypes from 'prop-types';

const CAL_CELL = 12;
const CAL_GAP  = 3;
const CAL_STEP = CAL_CELL + CAL_GAP;

const PnlCalendar = ({ trades }) => {
  const daily = useMemo(() => {
    const map = {};
    trades.forEach((t) => {
      if (!t.exitDate) return;
      const d = new Date(t.exitDate).toISOString().slice(0, 10);
      map[d] = (map[d] ?? 0) + (t.realizedPnl ?? 0);
    });
    return map;
  }, [trades]);

  const { weeks, monthLabels, maxAbs } = useMemo(() => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const start = new Date(today);
    start.setDate(start.getDate() - 52 * 7);
    start.setDate(start.getDate() - start.getDay()); // align to Sunday

    const weeks = [];
    const monthLabels = [];
    let lastMonth = -1;
    const cur = new Date(start);

    while (cur <= today) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        if (d === 0 && cur.getMonth() !== lastMonth) {
          monthLabels.push({
            weekIdx: weeks.length,
            label: cur.toLocaleString('en-IN', { month: 'short' }),
          });
          lastMonth = cur.getMonth();
        }
        const dateStr = cur.toISOString().slice(0, 10);
        week.push({ date: dateStr, pnl: daily[dateStr] ?? null, future: cur > today });
        cur.setDate(cur.getDate() + 1);
      }
      weeks.push(week);
    }

    const vals = Object.values(daily).map(Math.abs);
    return { weeks, monthLabels, maxAbs: vals.length ? Math.max(...vals) : 1 };
  }, [daily]);

  const cellBg = (cell) => {
    if (cell.future || cell.pnl === null) return '#1e293b';
    if (cell.pnl === 0) return '#334155';
    const intensity = Math.min(Math.abs(cell.pnl) / maxAbs, 1);
    const alpha = (0.2 + intensity * 0.8).toFixed(2);
    return cell.pnl > 0 ? `rgba(34,197,94,${alpha})` : `rgba(239,68,68,${alpha})`;
  };

  const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-slate-300 mb-4">P&amp;L Calendar — 52 weeks</h3>
      <div className="overflow-x-auto">
        <div className="min-w-max">
          {/* Month labels */}
          <div className="relative h-4 mb-1" style={{ marginLeft: 22 }}>
            {monthLabels.map(({ weekIdx, label }) => (
              <span
                key={label + weekIdx}
                className="absolute text-[10px] text-slate-500 leading-none"
                style={{ left: weekIdx * CAL_STEP }}
              >
                {label}
              </span>
            ))}
          </div>

          {/* Grid */}
          <div className="flex">
            {/* Day labels */}
            <div className="flex flex-col mr-1" style={{ gap: CAL_GAP }}>
              {DAY_LABELS.map((d, i) => (
                <div
                  key={i}
                  className="text-[9px] text-slate-600 flex items-center justify-end"
                  style={{ height: CAL_CELL, width: 14 }}
                >
                  {i % 2 === 1 ? d : ''}
                </div>
              ))}
            </div>

            {/* Week columns */}
            <div className="flex" style={{ gap: CAL_GAP }}>
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col" style={{ gap: CAL_GAP }}>
                  {week.map((cell, di) => (
                    <div
                      key={di}
                      style={{
                        width: CAL_CELL,
                        height: CAL_CELL,
                        background: cellBg(cell),
                        borderRadius: 2,
                        cursor: 'default',
                      }}
                      title={
                        cell.pnl !== null
                          ? `${cell.date}: ${cell.pnl >= 0 ? '+' : ''}₹${Math.abs(cell.pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
                          : cell.date
                      }
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-1.5 mt-3" style={{ marginLeft: 22 }}>
            <span className="text-[10px] text-slate-600 mr-1">Less</span>
            {[0.2, 0.4, 0.6, 0.8, 1.0].map((a) => (
              <div
                key={a}
                style={{ width: 10, height: 10, borderRadius: 2, background: `rgba(34,197,94,${a})` }}
              />
            ))}
            <span className="text-[10px] text-slate-600 mx-2">Profit — Loss</span>
            {[0.2, 0.4, 0.6, 0.8, 1.0].map((a) => (
              <div
                key={a}
                style={{ width: 10, height: 10, borderRadius: 2, background: `rgba(239,68,68,${a})` }}
              />
            ))}
            <span className="text-[10px] text-slate-600 ml-1">More</span>
          </div>
        </div>
      </div>
    </div>
  );
};

PnlCalendar.propTypes = {
  trades: PropTypes.array.isRequired,
};

export default PnlCalendar;
