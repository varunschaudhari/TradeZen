/**
 * @file DisciplineLedgerCard.jsx
 * @description Every trade the system blocked, marked to market later — the measured
 *   value of the system's NOs (both ways: protected losses and missed wins).
 */

import React from 'react';
import PropTypes from 'prop-types';
import StatCard from './StatCard.jsx';
import { formatCurrency, formatPercent } from '../utils/formatters.js';

const BLOCK_TYPE_LABELS = {
  HARD_BLOCK: 'Hard block',
  CAPITAL_GUARD: 'Capital guard',
  SECTOR_CAP: 'Sector cap',
  QUALITY_DOWNGRADE: 'Quality downgrade',
};

const LEDGER_VERDICT_META = {
  PROTECTED: { label: 'Protected', cls: 'bg-bull/20 text-bull' },
  COST:      { label: 'Missed win', cls: 'bg-bear/20 text-bear' },
  FLAT:      { label: 'Flat', cls: 'bg-slate-700 text-slate-300' },
};

const DisciplineLedgerCard = ({ ledger }) => {
  const summary = ledger?.summary;
  if (!summary || summary.totalBlocked === 0) return null;
  const recent = ledger?.recent ?? [];
  const protectedNet = summary.netCapitalProtected ?? 0;

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-slate-300">Discipline Ledger</h3>
        <span className="text-[11px] text-slate-500">
          Every blocked trade, marked to market after {summary.horizonDays} days — honest both ways
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        The system&rsquo;s NOs, measured. &ldquo;Protected&rdquo; = the blocked trade went on to
        lose; &ldquo;missed win&rdquo; = it went on to gain. The headline is the NET of both.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <StatCard
          label="Net Capital Protected"
          value={summary.evaluated > 0 ? formatCurrency(protectedNet) : '—'}
          sub={summary.evaluated > 0 ? `across ${summary.evaluated} evaluated blocks` : 'awaiting first evaluations'}
          color={protectedNet >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <StatCard
          label="Trades Blocked"
          value={summary.totalBlocked}
          sub={`${summary.pending} pending evaluation`}
        />
        <StatCard
          label="Protected / Missed"
          value={`${summary.byVerdict?.PROTECTED ?? 0} / ${summary.byVerdict?.COST ?? 0}`}
          sub={`${summary.byVerdict?.FLAT ?? 0} flat`}
          color="text-blue-400"
        />
        <StatCard
          label="Avg Fwd Return"
          value={summary.avgFwdReturnPct != null ? formatPercent(summary.avgFwdReturnPct) : '—'}
          sub="of blocked trades (lower = better blocks)"
          color={(summary.avgFwdReturnPct ?? 0) <= 0 ? 'text-emerald-400' : 'text-amber-400'}
        />
      </div>

      {recent.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700">
                <th className="pb-2 pr-4">Symbol</th>
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2 pr-4">Block</th>
                <th className="pb-2 pr-4">Reason</th>
                <th className="pb-2 pr-4">Fwd Return</th>
                <th className="pb-2">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((b) => {
                const meta = LEDGER_VERDICT_META[b.verdict];
                return (
                  <tr key={b._id} className="border-b border-slate-800 hover:bg-slate-800/40">
                    <td className="py-2 pr-4 font-mono font-semibold">{b.symbol}</td>
                    <td className="py-2 pr-4 text-slate-500">{b.sessionDate}</td>
                    <td className="py-2 pr-4 text-slate-400">{BLOCK_TYPE_LABELS[b.blockType] ?? b.blockType}</td>
                    <td className="py-2 pr-4 text-slate-500 max-w-[280px] truncate" title={b.reason}>
                      {b.reason ?? '—'}
                    </td>
                    <td className={`py-2 pr-4 font-mono ${
                      b.fwdReturnPct == null ? 'text-slate-500' : b.fwdReturnPct <= 0 ? 'text-bull' : 'text-bear'
                    }`}>
                      {b.fwdReturnPct != null ? formatPercent(b.fwdReturnPct) : 'pending'}
                    </td>
                    <td className="py-2">
                      {meta ? (
                        <span className={`px-1.5 py-0.5 rounded text-xs ${meta.cls}`}>{meta.label}</span>
                      ) : (
                        <span className="text-slate-500">pending</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

DisciplineLedgerCard.propTypes = {
  ledger: PropTypes.object,
};

export default DisciplineLedgerCard;
