/**
 * @file Universe.jsx
 * @description NSE stock universe management — toggle stocks active/inactive,
 *   add new symbols, delete, filter by sector / index / market-cap tier.
 *   Active stocks are the ones the scanner will process each cycle.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import toast from 'react-hot-toast';
import { stocksApi } from '../services/api.js';

const SYMBOL_RE = /^[A-Z0-9&.-]{1,20}$/;

const TIERS = ['ALL', 'LARGE', 'MID', 'SMALL', 'MICRO'];
const INDICES = ['ALL', 'NIFTY50', 'NIFTY100', 'NIFTY500', 'MIDCAP150'];
const PAGE_SIZE = 100;

/* ── helpers ──────────────────────────────────────────────────────── */
const tierColor = (t) => ({
  LARGE: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  MID:   'bg-blue-500/15 text-blue-300 border-blue-500/30',
  SMALL: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  MICRO: 'bg-slate-600/40 text-slate-400 border-slate-600',
}[t] ?? 'bg-slate-700/40 text-slate-500 border-slate-700');

/* ── Toggle switch ────────────────────────────────────────────────── */
const Toggle = ({ value, onChange, disabled }) => (
  <button
    onClick={onChange}
    disabled={disabled}
    className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none ${
      value ? 'bg-emerald-500' : 'bg-slate-600'
    } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    aria-checked={value}
    role="switch"
  >
    <span
      className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform ${
        value ? 'translate-x-4' : 'translate-x-0.5'
      }`}
    />
  </button>
);
Toggle.propTypes = { value: PropTypes.bool, onChange: PropTypes.func, disabled: PropTypes.bool };

/* ── Add stock modal ──────────────────────────────────────────────── */
const AddModal = ({ onClose, onAdded }) => {
  const [sym,  setSym]  = useState('');
  const [name, setName] = useState('');
  const [sector, setSector] = useState('');
  const [tier, setTier] = useState('MID');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const valid = SYMBOL_RE.test(sym.trim().toUpperCase());

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await stocksApi.add({
        symbol: sym.trim().toUpperCase(),
        companyName: name.trim() || undefined,
        sector: sector.trim() || undefined,
        marketCapTier: tier || undefined,
        active: true,
      });
      toast.success(`${sym.toUpperCase()} added to universe`);
      onAdded();
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-card border border-slate-700 rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
        <h3 className="text-base font-semibold text-slate-100">Add stock to universe</h3>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-slate-500 uppercase tracking-wide">NSE Symbol *</label>
            <input
              ref={ref}
              value={sym}
              onChange={(e) => setSym(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="e.g. RELIANCE"
              className="input mt-1 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-500 uppercase tracking-wide">Company name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" className="input mt-1 text-sm" />
          </div>
          <div>
            <label className="text-[11px] text-slate-500 uppercase tracking-wide">Sector</label>
            <input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="e.g. IT, Banking, Pharma" className="input mt-1 text-sm" />
          </div>
          <div>
            <label className="text-[11px] text-slate-500 uppercase tracking-wide">Market-cap tier</label>
            <select value={tier} onChange={(e) => setTier(e.target.value)} className="input mt-1 text-sm">
              {['LARGE', 'MID', 'SMALL', 'MICRO'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="btn-ghost text-sm px-4">Cancel</button>
          <button onClick={submit} disabled={!valid || busy} className="btn-primary text-sm px-4">
            {busy ? 'Adding…' : 'Add stock'}
          </button>
        </div>
      </div>
    </div>
  );
};
AddModal.propTypes = { onClose: PropTypes.func.isRequired, onAdded: PropTypes.func.isRequired };

/* ── Universe page ────────────────────────────────────────────────── */
const Universe = () => {
  const [stocks,  setStocks]  = useState([]);
  const [stats,   setStats]   = useState(null);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(0);
  const [loading, setLoading] = useState(true);

  const [q,        setQ]       = useState('');
  const [sector,   setSector]  = useState('ALL');
  const [activeF,  setActiveF] = useState('ALL');   // ALL | true | false
  const [indexF,   setIndexF]  = useState('ALL');
  const [tier,     setTier]    = useState('ALL');

  const [toggling, setToggling] = useState(new Set());
  const [selected, setSelected] = useState(new Set());
  const [showAdd,  setShowAdd]  = useState(false);

  const sectors = useMemo(() => {
    const s = new Set(stocks.map((st) => st.sector).filter(Boolean));
    return ['ALL', ...[...s].sort()];
  }, [stocks]);

  /* ── Data loading ──────────────────────────────────────────────── */
  const loadStats = useCallback(async () => {
    try {
      const res = await stocksApi.getStats();
      setStats(res?.data ?? res);
    } catch { /* non-critical */ }
  }, []);

  const loadStocks = useCallback(async (pg = 0) => {
    setLoading(true);
    try {
      const params = { page: pg };
      if (q.trim())         params.q      = q.trim().toUpperCase();
      if (sector !== 'ALL') params.sector  = sector;
      if (activeF !== 'ALL') params.active = activeF;
      if (indexF !== 'ALL') params.indices = indexF;
      if (tier !== 'ALL')   params.tier    = tier;

      const res = await stocksApi.getAll(params);
      const body = res?.data ?? res;
      setStocks(body?.stocks ?? []);
      setTotal(body?.total ?? 0);
      setPage(pg);
    } catch (err) {
      toast.error(`Failed to load stocks: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [q, sector, activeF, indexF, tier]);

  useEffect(() => { loadStats(); loadStocks(0); }, [loadStats, loadStocks]);

  /* ── Toggle single stock ───────────────────────────────────────── */
  const handleToggle = useCallback(async (symbol) => {
    setToggling((prev) => new Set([...prev, symbol]));
    try {
      const res = await stocksApi.toggle(symbol);
      const body = res?.data ?? res;
      setStocks((prev) => prev.map((s) => s.symbol === symbol ? { ...s, active: body.active } : s));
      loadStats();
    } catch (err) {
      toast.error(`Toggle failed: ${err.message}`);
    } finally {
      setToggling((prev) => { const next = new Set(prev); next.delete(symbol); return next; });
    }
  }, [loadStats]);

  /* ── Delete stock ──────────────────────────────────────────────── */
  const handleDelete = useCallback(async (symbol) => {
    if (!window.confirm(`Remove ${symbol} from the universe? This cannot be undone.`)) return;
    try {
      await stocksApi.remove(symbol);
      toast.success(`${symbol} removed`);
      loadStocks(page);
      loadStats();
    } catch (err) {
      toast.error(`Delete failed: ${err.message}`);
    }
  }, [page, loadStocks, loadStats]);

  /* ── Bulk toggle ───────────────────────────────────────────────── */
  const handleBulkToggle = useCallback(async (makeActive) => {
    const syms = selected.size > 0 ? [...selected] : stocks.map((s) => s.symbol);
    if (!syms.length) return;
    try {
      await stocksApi.bulkToggle(syms, makeActive);
      toast.success(`${syms.length} stocks ${makeActive ? 'activated' : 'deactivated'}`);
      setSelected(new Set());
      loadStocks(page);
      loadStats();
    } catch (err) {
      toast.error(`Bulk toggle failed: ${err.message}`);
    }
  }, [selected, stocks, page, loadStocks, loadStats]);

  /* ── Selection ─────────────────────────────────────────────────── */
  const toggleSelect = (sym) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(sym) ? next.delete(sym) : next.add(sym);
    return next;
  });
  const allSelected = stocks.length > 0 && stocks.every((s) => selected.has(s.symbol));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(stocks.map((s) => s.symbol)));

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-surface p-4 sm:p-6 space-y-4 max-w-[1400px] mx-auto">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">NSE Universe</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {stats
              ? `${stats.total} total · ${stats.active} active (scanned) · ${stats.inactive} inactive`
              : 'Loading…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { loadStocks(page); loadStats(); }} className="btn-ghost text-sm">↺ Refresh</button>
          <button onClick={() => setShowAdd(true)} className="btn-primary text-sm">+ Add stock</button>
        </div>
      </header>

      {/* ── Stats chips ─────────────────────────────────────────────── */}
      {stats?.byTier?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {stats.byTier.filter((t) => t._id).sort((a, b) => b.total - a.total).map((t) => (
            <div key={t._id} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium ${tierColor(t._id)}`}>
              <span>{t._id}</span>
              <span className="opacity-60">{t.active}/{t.total}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────────── */}
      <div className="card flex flex-wrap items-center gap-2">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search symbol…"
          className="input text-sm py-1.5 w-40"
        />

        <select value={sector} onChange={(e) => setSector(e.target.value)} className="input text-sm py-1.5 w-36">
          {sectors.map((s) => <option key={s} value={s}>{s === 'ALL' ? 'All sectors' : s}</option>)}
        </select>

        <select value={indexF} onChange={(e) => setIndexF(e.target.value)} className="input text-sm py-1.5 w-32">
          {INDICES.map((i) => <option key={i} value={i}>{i === 'ALL' ? 'All indices' : i}</option>)}
        </select>

        <select value={tier} onChange={(e) => setTier(e.target.value)} className="input text-sm py-1.5 w-28">
          {TIERS.map((t) => <option key={t} value={t}>{t === 'ALL' ? 'All tiers' : t}</option>)}
        </select>

        <div className="flex gap-1 ml-auto">
          {[['ALL', 'All'], ['true', 'Active'], ['false', 'Inactive']].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setActiveF(v)}
              className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                activeF === v
                  ? 'bg-accent text-white border-accent'
                  : 'bg-surface-card text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Bulk actions ────────────────────────────────────────────── */}
      {(selected.size > 0 || stocks.length > 0) && (
        <div className="flex items-center gap-2 flex-wrap">
          {selected.size > 0 && (
            <span className="text-xs text-slate-400">{selected.size} selected</span>
          )}
          <button onClick={() => handleBulkToggle(true)}  className="text-xs px-3 py-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20">
            {selected.size > 0 ? `Activate (${selected.size})` : 'Activate all on page'}
          </button>
          <button onClick={() => handleBulkToggle(false)} className="text-xs px-3 py-1.5 rounded border border-slate-600 bg-slate-700/30 text-slate-400 hover:bg-slate-700/60">
            {selected.size > 0 ? `Deactivate (${selected.size})` : 'Deactivate all on page'}
          </button>
          {selected.size > 0 && (
            <button onClick={() => setSelected(new Set())} className="text-xs text-slate-500 hover:text-slate-300">
              Clear selection
            </button>
          )}
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-slate-500">
            Showing {stocks.length} of {total} · page {page + 1} / {pageCount}
          </p>
          <div className="flex gap-2">
            <button onClick={() => loadStocks(Math.max(0, page - 1))} disabled={page === 0}
              className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-40">‹</button>
            <button onClick={() => loadStocks(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1}
              className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-40">›</button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-9 rounded bg-slate-700/30 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-[11px] text-slate-500 border-b border-slate-700">
                  <th className="pb-2 pr-2 w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      className="rounded border-slate-600 bg-surface-card text-accent" />
                  </th>
                  <th className="pb-2 pr-3 font-medium">Symbol</th>
                  <th className="pb-2 pr-3 font-medium">Company</th>
                  <th className="pb-2 pr-3 font-medium">Sector</th>
                  <th className="pb-2 pr-3 font-medium">Indices</th>
                  <th className="pb-2 pr-3 font-medium">Tier</th>
                  <th className="pb-2 pr-3 font-medium text-center">Active</th>
                  <th className="pb-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((s) => (
                  <tr
                    key={s.symbol}
                    className={`border-b border-slate-800 last:border-0 hover:bg-surface-elevated/30 ${
                      selected.has(s.symbol) ? 'bg-accent/5' : ''
                    }`}
                  >
                    <td className="py-2 pr-2">
                      <input type="checkbox" checked={selected.has(s.symbol)}
                        onChange={() => toggleSelect(s.symbol)}
                        className="rounded border-slate-600 bg-surface-card text-accent" />
                    </td>
                    <td className="py-2 pr-3">
                      <span className="font-mono font-semibold text-slate-100">{s.symbol}</span>
                    </td>
                    <td className="py-2 pr-3 text-slate-400 text-xs max-w-[160px] truncate">
                      {s.companyName || '—'}
                    </td>
                    <td className="py-2 pr-3 text-slate-400 text-xs">{s.sector || '—'}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {(s.indices ?? []).slice(0, 2).map((idx) => (
                          <span key={idx} className="text-[9px] px-1 py-px rounded bg-slate-700/50 text-slate-400 font-mono">
                            {idx}
                          </span>
                        ))}
                        {(s.indices ?? []).length > 2 && (
                          <span className="text-[9px] text-slate-600">+{s.indices.length - 2}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      {s.marketCapTier ? (
                        <span className={`text-[10px] px-1.5 py-px rounded border font-medium ${tierColor(s.marketCapTier)}`}>
                          {s.marketCapTier}
                        </span>
                      ) : <span className="text-slate-700">—</span>}
                    </td>
                    <td className="py-2 pr-3 text-center">
                      <Toggle
                        value={s.active}
                        onChange={() => handleToggle(s.symbol)}
                        disabled={toggling.has(s.symbol)}
                      />
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => handleDelete(s.symbol)}
                        className="text-[11px] text-slate-600 hover:text-red-400 transition-colors px-2"
                        title={`Remove ${s.symbol}`}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {stocks.length === 0 && !loading && (
                  <tr><td colSpan={8} className="py-10 text-center text-slate-500 text-sm">
                    No stocks match these filters. <button onClick={() => { setQ(''); setSector('ALL'); setActiveF('ALL'); setIndexF('ALL'); setTier('ALL'); }} className="text-accent hover:underline ml-1">Clear filters</button>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && <AddModal onClose={() => setShowAdd(false)} onAdded={() => { loadStocks(page); loadStats(); }} />}
    </div>
  );
};

export default Universe;
