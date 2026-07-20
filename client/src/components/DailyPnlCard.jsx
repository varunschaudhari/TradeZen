/**
 * @file DailyPnlCard.jsx
 * @description Daily + overall net P&L on one IST-day axis, split by lane: swing
 *   (your closed trades, net of costs) vs intraday (settled paper entries). All
 *   figures NET of estimated charges + slippage; intraday is paper-only.
 */

import React from 'react';
import PropTypes from 'prop-types';
import StatCard from './StatCard.jsx';
import { formatCurrency } from '../utils/formatters.js';

const pnlColor = (n) => ((n ?? 0) === 0 ? 'text-slate-500' : n > 0 ? 'text-bull' : 'text-bear');
const pnlFmt = (n) => (n == null ? '—' : `${n >= 0 ? '+' : ''}${formatCurrency(n)}`);

const DailyPnlCard = ({ report }) => {
  if (!report) return null;
  const { days = [], overall, today } = report;
  if (((overall?.swingTrades ?? 0) + (overall?.intradayTrades ?? 0)) === 0) return null;

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-slate-300">Daily P&amp;L — Swing vs Intraday</h3>
        <span className="text-[11px] text-slate-500">
          Net of estimated charges + slippage · intraday is paper-only
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Swing books on the exit day (IST); intraday books per session at settlement.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <StatCard
          label={`Today (${today?.date ?? '—'})`}
          value={pnlFmt(today?.totalNet)}
          sub={`swing ${pnlFmt(today?.swingNet)} · intraday ${pnlFmt(today?.intradayNet)}`}
          color={pnlColor(today?.totalNet)}
        />
        <StatCard
          label="Overall Swing (net)"
          value={pnlFmt(overall?.swingNet)}
          sub={`${overall?.swingTrades ?? 0} closed trades`}
          color={pnlColor(overall?.swingNet)}
        />
        <StatCard
          label="Overall Intraday (net)"
          value={pnlFmt(overall?.intradayNet)}
          sub={`${overall?.intradayTrades ?? 0} settled paper entries`}
          color={pnlColor(overall?.intradayNet)}
        />
        <StatCard
          label="Overall Combined"
          value={pnlFmt(overall?.totalNet)}
          color={pnlColor(overall?.totalNet)}
        />
      </div>

      {days.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700">
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2 pr-4">Swing</th>
                <th className="pb-2 pr-4">Intraday</th>
                <th className="pb-2 pr-4">Total</th>
                <th className="pb-2">Entries</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className="border-b border-slate-800 hover:bg-slate-800/40">
                  <td className="py-2 pr-4 font-mono text-slate-400">{d.date}</td>
                  <td className={`py-2 pr-4 font-mono ${pnlColor(d.swingNet)}`}>
                    {d.swingTrades ? pnlFmt(d.swingNet) : '—'}
                  </td>
                  <td className={`py-2 pr-4 font-mono ${pnlColor(d.intradayNet)}`}>
                    {d.intradayTrades ? pnlFmt(d.intradayNet) : '—'}
                  </td>
                  <td className={`py-2 pr-4 font-mono font-semibold ${pnlColor(d.totalNet)}`}>
                    {pnlFmt(d.totalNet)}
                  </td>
                  <td className="py-2 text-slate-500">{d.swingTrades + d.intradayTrades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

DailyPnlCard.propTypes = {
  report: PropTypes.shape({
    days: PropTypes.array,
    overall: PropTypes.object,
    today: PropTypes.object,
  }),
};

export default DailyPnlCard;
