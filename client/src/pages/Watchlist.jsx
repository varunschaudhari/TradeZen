/**
 * @file Watchlist.jsx
 * @description Full watchlist management: add/remove stocks, star favorites,
 *   view last signal per stock, live prices, bulk-paste, sector filter, sort.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { watchlistApi, signalsApi, universeApi } from '../services/api.js';
import useQuotes from '../hooks/useQuotes.js';
import useSocket from '../hooks/useSocket.js';
import { SOCKET_EVENTS } from '../utils/constants.js';
import { formatCurrency, formatPercent, timeAgo } from '../utils/formatters.js';

/* ── Constants ─────────────────────────────────────────────────────── */
const SYMBOL_RE  = /^[A-Z]{1,20}$/;
const FAV_KEY    = 'tradezen_wl_favorites';
const SORTS      = ['Symbol A–Z', 'Sector', 'Last Signal', 'Recently Added'];
const NSE_SECTORS = [
  'Automobiles', 'Banking', 'Capital Goods', 'Chemicals', 'Consumer Goods',
  'Financial Services', 'FMCG', 'Healthcare', 'IT', 'Infrastructure',
  'Insurance', 'Media', 'Metals & Mining', 'Oil & Gas', 'Pharma', 'Power',
  'Realty', 'Telecom', 'Textiles', 'Other',
];

/* ── Helpers ───────────────────────────────────────────────────────── */
const sigAge = (dateStr) => {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const verdictBadge = (verdict) => {
  const map = {
    BUY:  'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    WAIT: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    SKIP: 'bg-red-500/20 text-red-400 border-red-500/30',
  };
  return map[verdict] ?? 'bg-slate-700/40 text-slate-400 border-slate-600/40';
};

/* ── Symbol autocomplete input ─────────────────────────────────────── */
const SymbolInput = ({ value, onChange, universe, onSelect }) => {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef(null);
  const q = value.trim().toUpperCase();
  const matches = useMemo(
    () => (q.length >= 1 ? universe.filter((s) => s.startsWith(q)).slice(0, 7) : []),
    [q, universe]
  );

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        onFocus={() => setOpen(true)}
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 120); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && SYMBOL_RE.test(q)) { onSelect(q); setOpen(false); }
        }}
        placeholder="e.g. RELIANCE"
        maxLength={20}
        className="input font-mono w-40"
        spellCheck={false}
      />
      {open && matches.length > 0 && (
        <ul
          className="absolute z-40 mt-1 w-52 rounded-lg border border-slate-700 bg-surface-card shadow-xl overflow-hidden"
          onMouseEnter={() => clearTimeout(blurTimer.current)}
        >
          {matches.map((s) => (
            <li key={s}>
              <button
                onMouseDown={() => { onSelect(s); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-sm font-mono text-slate-200 hover:bg-surface-elevated/60"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/* ── Bulk paste modal ──────────────────────────────────────────────── */
const BulkModal = ({ onClose, onAdd }) => {
  const [text, setText] = useState('');
  const parsed = useMemo(() => {
    return [...new Set(
      text.split(/[\s,\n;]+/)
        .map((s) => s.trim().toUpperCase())
        .filter((s) => SYMBOL_RE.test(s))
    )];
  }, [text]);

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-100">Paste Multiple Symbols</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">✕</button>
        </div>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Paste symbols separated by commas, spaces, or new lines:\nRELIANCE, INFY, TCS\nHDFCBANK\nBAJFINANCE'}
          rows={6}
          className="input w-full font-mono text-sm resize-none"
        />
        <p className="text-xs text-slate-500">
          {parsed.length > 0
            ? `${parsed.length} valid symbol${parsed.length === 1 ? '' : 's'} detected: ${parsed.join(', ')}`
            : 'No valid symbols found yet'}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => { onAdd(parsed); onClose(); }}
            disabled={parsed.length === 0}
            className="flex-1 btn-primary"
          >
            Add {parsed.length > 0 ? `${parsed.length} Stock${parsed.length === 1 ? '' : 's'}` : ''}
          </button>
          <button onClick={onClose} className="btn-ghost px-4">Cancel</button>
        </div>
      </div>
    </div>
  );
};

/* ── Main Watchlist page ───────────────────────────────────────────── */
const Watchlist = () => {
  const navigate = useNavigate();
  const { subscribe } = useSocket();

  /* State */
  const [watchlist,    setWatchlist]    = useState([]);
  const [lastSignals,  setLastSignals]  = useState({});
  const [universe,     setUniverse]     = useState([]);
  const [favorites,    setFavorites]    = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]')); }
    catch { return new Set(); }
  });

  const [loading,      setLoading]      = useState(true);
  const [adding,       setAdding]       = useState(false);
  const [scanning,     setScanning]     = useState(false);
  const [showBulk,     setShowBulk]     = useState(false);

  /* Filters */
  const [search,       setSearch]       = useState('');
  const [filterSector, setFilterSector] = useState('ALL');
  const [sortKey,      setSortKey]      = useState(SORTS[0]);

  /* Add form */
  const [newSym,       setNewSym]       = useState('');
  const [newSector,    setNewSector]    = useState('');

  /* Inline notes editing */
  const [editingNotes, setEditingNotes] = useState(null); // { symbol, text } | null
  const notesRef = useRef(null);

  /* Live quotes for all watchlist symbols */
  const symbols = useMemo(() => watchlist.map((w) => w.symbol), [watchlist]);
  const { quotes } = useQuotes(symbols);

  /* ── Data loading ─────────────────────────────────────────────────── */
  const loadWatchlist = useCallback(async () => {
    try {
      const res = await watchlistApi.get();
      setWatchlist(res?.data ?? res?.watchlist ?? []);
    } catch (err) {
      toast.error(`Watchlist: ${err.message}`);
    }
  }, []);

  const loadSignals = useCallback(async () => {
    try {
      const res = await signalsApi.getAll({ limit: 500 });
      const all = res?.data?.signals ?? res?.signals ?? res?.data ?? [];
      const bySymbol = {};
      (Array.isArray(all) ? all : []).forEach((sig) => {
        if (!bySymbol[sig.symbol] || new Date(sig.createdAt) > new Date(bySymbol[sig.symbol].createdAt)) {
          bySymbol[sig.symbol] = sig;
        }
      });
      setLastSignals(bySymbol);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadWatchlist(), loadSignals()]);
      setLoading(false);
    };
    init();
    universeApi.get().then((r) => setUniverse(r?.data?.symbols ?? r?.symbols ?? [])).catch(() => {});
  }, [loadWatchlist, loadSignals]);

  /* Refresh signal data after a scan completes */
  useEffect(() => subscribe(SOCKET_EVENTS.SCAN_COMPLETE, loadSignals), [subscribe, loadSignals]);

  /* ── Favorites ────────────────────────────────────────────────────── */
  const toggleFav = useCallback((symbol) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
      try { localStorage.setItem(FAV_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  /* ── Add / remove ─────────────────────────────────────────────────── */
  const handleAdd = useCallback(async (sym = newSym, sector = newSector) => {
    const s = sym.trim().toUpperCase();
    if (!SYMBOL_RE.test(s)) { toast.error('Invalid symbol'); return; }
    try {
      setAdding(true);
      await watchlistApi.add(s, sector);
      toast.success(`${s} added to watchlist`);
      setNewSym(''); setNewSector('');
      await loadWatchlist();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  }, [newSym, newSector, loadWatchlist]);

  const handleBulkAdd = useCallback(async (syms) => {
    let added = 0, skipped = 0;
    for (const sym of syms) {
      try { await watchlistApi.add(sym, ''); added++; }
      catch { skipped++; }
    }
    toast.success(`Added ${added}${skipped ? `, ${skipped} already existed` : ''}`);
    await loadWatchlist();
  }, [loadWatchlist]);

  const handleSaveNote = useCallback(async () => {
    if (!editingNotes) return;
    const { symbol, text } = editingNotes;
    setEditingNotes(null);
    try {
      await watchlistApi.updateNote(symbol, text.trim());
      setWatchlist((prev) =>
        prev.map((w) => (w.symbol === symbol ? { ...w, notes: text.trim() } : w))
      );
    } catch (err) {
      toast.error(`Could not save note: ${err.message}`);
    }
  }, [editingNotes]);

  /* Focus textarea when notes editor opens */
  useEffect(() => {
    if (editingNotes) {
      requestAnimationFrame(() => notesRef.current?.focus());
    }
  }, [editingNotes?.symbol]);

  const handleRemove = useCallback(async (symbol) => {
    try {
      await watchlistApi.remove(symbol);
      toast.success(`${symbol} removed`);
      setWatchlist((prev) => prev.filter((s) => s.symbol !== symbol));
    } catch (err) {
      toast.error(err.message);
    }
  }, []);

  /* ── Scan ─────────────────────────────────────────────────────────── */
  const handleScanAll = useCallback(async () => {
    try {
      setScanning(true);
      await signalsApi.triggerScan();
      toast.success('Scan queued — results arrive via WebSocket');
    } catch (err) {
      toast.error(`Scan failed: ${err.message}`);
    } finally {
      setScanning(false);
    }
  }, []);

  /* ── Derived: filtered + sorted list ─────────────────────────────── */
  const sectors = useMemo(
    () => ['ALL', ...new Set(watchlist.map((w) => w.sector).filter(Boolean)).values()],
    [watchlist]
  );

  const displayed = useMemo(() => {
    const q = search.trim().toUpperCase();
    let list = watchlist.filter((w) => {
      if (filterSector !== 'ALL' && w.sector !== filterSector) return false;
      if (q && !w.symbol.includes(q)) return false;
      return true;
    });

    list = [...list].sort((a, b) => {
      // Favorites always float to top
      const fa = favorites.has(a.symbol) ? 0 : 1;
      const fb = favorites.has(b.symbol) ? 0 : 1;
      if (fa !== fb) return fa - fb;

      if (sortKey === 'Symbol A–Z') return a.symbol.localeCompare(b.symbol);
      if (sortKey === 'Sector') return (a.sector ?? '').localeCompare(b.sector ?? '');
      if (sortKey === 'Recently Added') return new Date(b.addedDate) - new Date(a.addedDate);
      if (sortKey === 'Last Signal') {
        const as = lastSignals[a.symbol], bs = lastSignals[b.symbol];
        if (!as && !bs) return 0;
        if (!as) return 1;
        if (!bs) return -1;
        return new Date(bs.createdAt) - new Date(as.createdAt);
      }
      return 0;
    });

    return list;
  }, [watchlist, search, filterSector, sortKey, favorites, lastSignals]);

  /* ── Stats ────────────────────────────────────────────────────────── */
  const stats = useMemo(() => {
    const sectorSet = new Set(watchlist.map((w) => w.sector).filter(Boolean));
    const nowIST  = new Date(Date.now() + 5.5 * 3600 * 1000);
    const today   = nowIST.toISOString().slice(0, 10);
    let buyToday  = 0, neverScanned = 0;
    watchlist.forEach((w) => {
      const sig = lastSignals[w.symbol];
      if (!sig) { neverScanned++; return; }
      if (sig.verdict === 'BUY') {
        const sigDay = new Date(new Date(sig.createdAt).getTime() + 5.5 * 3600 * 1000)
          .toISOString().slice(0, 10);
        if (sigDay === today) buyToday++;
      }
    });
    return { total: watchlist.length, sectors: sectorSet.size, buyToday, neverScanned };
  }, [watchlist, lastSignals]);

  /* ── Loading state ────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="min-h-screen bg-surface p-4 space-y-4">
        <div className="h-8 w-48 bg-slate-700/60 rounded animate-pulse" />
        <div className="card space-y-3 animate-pulse">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-14 bg-slate-700/40 rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface p-4 sm:p-6 space-y-4 max-w-[1400px] mx-auto">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Watchlist</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {stats.total} stock{stats.total !== 1 ? 's' : ''} · scanner checks these every 15 min during market hours
          </p>
        </div>
        <button
          onClick={handleScanAll}
          disabled={scanning || watchlist.length === 0}
          className="btn-success flex items-center gap-1.5"
        >
          ⚡ {scanning ? 'Queuing scan…' : `Scan All (${stats.total})`}
        </button>
      </header>

      {/* ── Stats strip ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Stocks',    value: stats.total,       color: 'text-slate-100' },
          { label: 'Sectors',         value: stats.sectors,     color: 'text-slate-100' },
          { label: 'BUY Today',       value: stats.buyToday,    color: stats.buyToday > 0 ? 'text-emerald-400' : 'text-slate-400' },
          { label: 'Never Scanned',   value: stats.neverScanned,color: stats.neverScanned > 0 ? 'text-amber-400' : 'text-slate-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card py-3 text-center">
            <p className="text-[10px] uppercase tracking-widest text-slate-500">{label}</p>
            <p className={`text-2xl font-mono font-extrabold mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Add stock panel ────────────────────────────────────────── */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Add Stocks</h2>

        {/* Single add */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-[11px] text-slate-500 block mb-1 uppercase tracking-wide">NSE Symbol</label>
            <SymbolInput
              value={newSym}
              onChange={setNewSym}
              universe={universe}
              onSelect={(s) => setNewSym(s)}
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-500 block mb-1 uppercase tracking-wide">Sector (optional)</label>
            <select
              value={newSector}
              onChange={(e) => setNewSector(e.target.value)}
              className="input w-44 py-2 text-sm"
            >
              <option value="">— Select sector —</option>
              {NSE_SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <button
            onClick={() => handleAdd()}
            disabled={adding || !SYMBOL_RE.test(newSym.trim())}
            className="btn-primary"
          >
            {adding ? 'Adding…' : '+ Add Stock'}
          </button>
          <button
            onClick={() => setShowBulk(true)}
            className="btn-ghost text-sm"
          >
            📋 Paste Multiple
          </button>
        </div>
      </div>

      {/* ── Filter / search bar ────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by symbol…"
          className="input py-1.5 text-sm w-44 font-mono"
        />

        {/* Sector filter */}
        {sectors.length > 2 && (
          <select
            value={filterSector}
            onChange={(e) => setFilterSector(e.target.value)}
            className="input py-1.5 text-sm w-auto"
          >
            {sectors.map((s) => <option key={s} value={s}>{s === 'ALL' ? 'All Sectors' : s}</option>)}
          </select>
        )}

        {/* Sort */}
        <div className="seg-group">
          {SORTS.map((s) => (
            <button
              key={s}
              onClick={() => setSortKey(s)}
              className={`seg ${sortKey === s ? 'seg-active' : ''}`}
            >
              {s}
            </button>
          ))}
        </div>

        <span className="text-xs text-slate-600 ml-auto">{displayed.length} shown</span>
      </div>

      {/* ── Stock list ─────────────────────────────────────────────── */}
      {watchlist.length === 0 ? (
        <div className="card text-center py-16 space-y-3">
          <p className="text-4xl">📋</p>
          <p className="text-slate-300 font-semibold text-lg">Watchlist is empty</p>
          <p className="text-slate-500 text-sm">
            Add your first NSE stock above — the scanner will check it every 15 minutes during market hours.
          </p>
        </div>
      ) : displayed.length === 0 ? (
        <div className="card text-center py-10 text-slate-500">
          No stocks match the current filter.
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          {/* Table header */}
          <div className="hidden sm:grid grid-cols-[36px_1fr_130px_210px_110px_130px_90px] gap-3 px-4 py-2.5 bg-surface-elevated/50 border-b border-slate-700/60">
            <div />
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Stock</p>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Live Price</p>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Last Signal</p>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Scan Age</p>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Notes</p>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 text-right">Actions</p>
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-700/40">
            {displayed.map((item) => {
              const sig   = lastSignals[item.symbol];
              const q     = quotes[item.symbol];
              const isFav = favorites.has(item.symbol);
              const age   = sig ? sigAge(sig.createdAt) : null;
              const stale = sig && (Date.now() - new Date(sig.createdAt).getTime()) > 7 * 86400000;

              const isEditingThis = editingNotes?.symbol === item.symbol;

              return (
                <div
                  key={item.symbol}
                  className="grid grid-cols-[36px_1fr] sm:grid-cols-[36px_1fr_130px_210px_110px_130px_90px]
                             gap-3 px-4 py-3 items-start hover:bg-surface-elevated/30 transition-colors group"
                >
                  {/* ★ Favorite */}
                  <button
                    onClick={() => toggleFav(item.symbol)}
                    title={isFav ? 'Unpin from top' : 'Pin to top'}
                    className={`text-lg leading-none transition-colors ${
                      isFav ? 'text-amber-400' : 'text-slate-700 hover:text-amber-400'
                    }`}
                  >
                    {isFav ? '★' : '☆'}
                  </button>

                  {/* Symbol + sector + mobile note */}
                  <div className="min-w-0">
                    <button
                      onClick={() => navigate(`/stock/${item.symbol}`)}
                      className="font-mono font-bold text-slate-100 hover:text-accent transition-colors text-sm"
                    >
                      {item.symbol}
                    </button>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {item.sector && (
                        <span className="chip bg-slate-700/50 text-slate-400">{item.sector}</span>
                      )}
                      {isFav && <span className="chip bg-amber-500/15 text-amber-400">Pinned</span>}
                    </div>
                    {/* Notes on mobile */}
                    {item.notes && (
                      <p className="sm:hidden text-[11px] text-slate-500 mt-1 line-clamp-1 leading-snug">
                        📝 {item.notes}
                      </p>
                    )}
                  </div>

                  {/* Live price */}
                  <div className="hidden sm:block">
                    {q ? (
                      <>
                        <p className="font-mono text-sm font-semibold text-slate-100 tabular-nums">
                          {formatCurrency(q.price, 0)}
                        </p>
                        <p className={`font-mono text-[11px] tabular-nums ${
                          (q.changePct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {(q.changePct ?? 0) >= 0 ? '▲' : '▼'} {Math.abs(q.changePct ?? 0).toFixed(2)}%
                        </p>
                      </>
                    ) : (
                      <p className="text-slate-600 text-xs">—</p>
                    )}
                  </div>

                  {/* Last signal */}
                  <div className="hidden sm:flex items-center gap-2 flex-wrap">
                    {sig ? (
                      <>
                        <span className={`chip border ${verdictBadge(sig.verdict)}`}>
                          {sig.verdict}
                        </span>
                        {sig.verdict === 'BUY' && sig.riskReward && (
                          <span className="text-[11px] font-mono text-emerald-400">
                            RR {sig.riskReward.toFixed(1)}:1
                          </span>
                        )}
                        {sig.gatesPassed != null && (
                          <span className="text-[11px] text-slate-500">
                            {sig.gatesPassed}/8 gates
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="chip bg-slate-700/40 text-slate-500 border border-slate-700/40">
                        Never scanned
                      </span>
                    )}
                  </div>

                  {/* Scan age */}
                  <div className="hidden sm:block">
                    {age ? (
                      <p className={`text-xs font-mono ${stale ? 'text-amber-400' : 'text-slate-500'}`}>
                        {stale && <span title="Stale — not scanned in 7+ days">⚠ </span>}
                        {age}
                      </p>
                    ) : (
                      <p className="text-slate-600 text-xs">—</p>
                    )}
                  </div>

                  {/* Notes column */}
                  <div className="hidden sm:block">
                    {isEditingThis ? (
                      <div className="flex flex-col gap-1">
                        <textarea
                          ref={notesRef}
                          value={editingNotes.text}
                          onChange={(e) => setEditingNotes((n) => ({ ...n, text: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveNote(); }
                            if (e.key === 'Escape') setEditingNotes(null);
                          }}
                          rows={2}
                          maxLength={300}
                          placeholder="Why did you add this stock?"
                          className="input text-xs w-full resize-none py-1 px-2 leading-snug"
                        />
                        <div className="flex gap-1.5">
                          <button onClick={handleSaveNote} className="text-[10px] text-emerald-400 hover:text-emerald-300 font-medium">Save</button>
                          <button onClick={() => setEditingNotes(null)} className="text-[10px] text-slate-500 hover:text-slate-300">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditingNotes({ symbol: item.symbol, text: item.notes ?? '' })}
                        title="Add / edit note"
                        className={`text-xs text-left w-full max-w-[120px] transition-colors group/note ${
                          item.notes ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-400'
                        }`}
                      >
                        {item.notes
                          ? <span className="line-clamp-2 leading-snug">{item.notes}</span>
                          : <span className="opacity-0 group-hover/note:opacity-100 transition-opacity">+ add note</span>
                        }
                      </button>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="col-span-1 sm:col-auto flex items-center gap-2 justify-end">
                    <button
                      onClick={() => navigate(`/stock/${item.symbol}`)}
                      className="text-xs text-accent hover:text-accent-light font-medium transition-colors"
                    >
                      Analyze →
                    </button>
                    <button
                      onClick={() => handleRemove(item.symbol)}
                      className="text-xs text-slate-600 hover:text-red-400 transition-colors"
                      title={`Remove ${item.symbol}`}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Legend */}
      {watchlist.length > 0 && (
        <p className="text-[11px] text-slate-600 text-center">
          ★ Pinned stocks stay at the top · Notes column: click to add your thesis for adding the stock ·
          ⚠ = not scanned in 7+ days · <span className="text-accent">Analyze →</span> opens full chart + gate breakdown
        </p>
      )}

      {/* Bulk paste modal */}
      {showBulk && (
        <BulkModal onClose={() => setShowBulk(false)} onAdd={handleBulkAdd} />
      )}
    </div>
  );
};

export default Watchlist;
