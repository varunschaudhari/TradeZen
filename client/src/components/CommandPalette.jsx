/**
 * @file CommandPalette.jsx
 * @description Global Cmd+K / Ctrl+K command palette.
 *   - Type a page name to navigate instantly (nav items).
 *   - Type a stock symbol (2+ chars) to search across all Signals and Trades.
 *   Keyboard: ↑↓ navigate, Enter select, Escape close.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signalsApi, searchApi } from '../services/api.js';
import Spinner from './Spinner.jsx';

const NAV_ITEMS = [
  { label: 'Dashboard',    path: '/dashboard',   icon: '◈', group: 'Navigate' },
  { label: 'Signals',      path: '/signals',     icon: '⚡', group: 'Navigate' },
  { label: 'Positions',    path: '/positions',   icon: '↗', group: 'Navigate' },
  { label: 'Performance',  path: '/performance', icon: '◉', group: 'Navigate' },
  { label: 'Watchlist',    path: '/watchlist',   icon: '◎', group: 'Navigate' },
  { label: 'Universe',     path: '/universe',    icon: '⊕', group: 'Navigate' },
  { label: 'Monitor',      path: '/monitor',     icon: '◌', group: 'Navigate' },
  { label: 'Risk',          path: '/risk',        icon: '⚠', group: 'Navigate' },
  { label: 'Backtesting',  path: '/backtest',    icon: '◷', group: 'Navigate' },
  { label: 'Gate Analytics', path: '/gates',    icon: '⊛', group: 'Navigate' },
  { label: 'Settings',     path: '/settings',    icon: '◧', group: 'Navigate' },
  { label: 'Trigger Scan', action: 'scan',       icon: '⟳', group: 'Actions'  },
];

const VERDICT_STYLES = {
  BUY:  'bg-emerald-500/20 text-emerald-400',
  WAIT: 'bg-amber-500/20 text-amber-400',
  SKIP: 'bg-red-500/20 text-red-400',
};
const STATUS_STYLES = {
  OPEN:    'bg-blue-500/20 text-blue-400',
  CLOSED:  'bg-slate-700/60 text-slate-400',
  EXPIRED: 'bg-red-500/20 text-red-400',
};

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '';

const SearchIcon = () => (
  <svg className="w-4 h-4 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
  </svg>
);

const CommandPalette = () => {
  const [open,     setOpen]     = useState(false);
  const [query,    setQuery]    = useState('');
  const [selected, setSelected] = useState(0);
  const [scanning, setScanning] = useState(false);

  /* ── DB search state ── */
  const [dbResults, setDbResults] = useState({ signals: [], trades: [] });
  const [searching, setSearching] = useState(false);

  const itemRefs = useRef(new Map());
  const navigate = useNavigate();
  const location = useLocation();

  /* ── Close on route change ── */
  useEffect(() => { setOpen(false); }, [location.pathname]);

  /* ── Global shortcut Cmd+K / Ctrl+K ── */
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /* ── Focus + reset on open ── */
  const inputRef = useRef(null);
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      setDbResults({ signals: [], trades: [] });
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  /* ── Escape key ── */
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  /* ── Debounced live search (fires when query ≥ 2 chars) ── */
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setDbResults({ signals: [], trades: [] });
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchApi.global(q, 5);
        setDbResults({ signals: res.signals ?? [], trades: res.trades ?? [] });
      } catch { /* ignore */ }
      setSearching(false);
    }, 280);
    return () => {
      clearTimeout(timer);
      setSearching(false);
    };
  }, [query]);

  /* ── Build combined items array (nav matches + DB results) ── */
  const navFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV_ITEMS;
    return NAV_ITEMS.filter((i) => i.label.toLowerCase().includes(q));
  }, [query]);

  const hasDb = dbResults.signals.length > 0 || dbResults.trades.length > 0;

  const allItems = useMemo(() => [
    ...navFiltered.map((i) => ({ ...i, _kind: 'nav' })),
    ...dbResults.signals.map((s) => ({
      ...s,
      _kind: 'signal',
      label: s.symbol,
      path:  `/stock/${s.symbol}`,
    })),
    ...dbResults.trades.map((t) => ({
      ...t,
      _kind: 'trade',
      label: t.symbol,
      path:  t.status === 'OPEN' ? '/positions' : '/performance',
    })),
  ], [navFiltered, dbResults]);

  /* Clamp selected when list changes */
  useEffect(() => {
    setSelected((s) => Math.max(0, Math.min(s, allItems.length - 1)));
  }, [allItems]);

  /* Scroll selected button into view */
  useEffect(() => {
    itemRefs.current.get(selected)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const handleSelect = useCallback(async (item) => {
    if (item.action === 'scan') {
      setScanning(true);
      try { await signalsApi.triggerScan(); } catch { /* ignore */ }
      setScanning(false);
      setOpen(false);
      return;
    }
    if (item.path) navigate(item.path);
    setOpen(false);
  }, [navigate]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => (s + 1) % Math.max(1, allItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => (s - 1 + Math.max(1, allItems.length)) % Math.max(1, allItems.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (allItems[selected]) handleSelect(allItems[selected]);
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Palette panel */}
      <div
        className="fixed top-[18%] left-1/2 -translate-x-1/2 w-full max-w-lg z-[70] px-4"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="bg-surface-card border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden">

          {/* Search input row */}
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-700/60">
            <SearchIcon />
            <input
              ref={inputRef}
              value={scanning ? 'Queuing scan…' : query}
              onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
              onKeyDown={handleKeyDown}
              placeholder="Go to page or search symbols…"
              disabled={scanning}
              className="flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-500 outline-none"
            />
            {searching
              ? <Spinner size={13} />
              : <kbd className="text-[10px] bg-surface-elevated text-slate-500 px-1.5 py-0.5 rounded font-mono border border-slate-700/60">ESC</kbd>
            }
          </div>

          {/* Results list */}
          <div className="max-h-80 overflow-y-auto py-1.5">
            {allItems.length === 0 && !searching ? (
              <p className="text-center text-slate-500 text-sm py-8">
                {query.trim().length >= 2 ? `No results for "${query.trim()}"` : 'No results'}
              </p>
            ) : (
              allItems.map((item, i) => {
                const isActive  = i === selected;
                const prevKind  = i > 0 ? allItems[i - 1]._kind : null;
                const isFirst   = item._kind !== prevKind;
                const showHdr   = isFirst && (item._kind !== 'nav' || (hasDb && i === 0));

                const hdrLabel =
                  item._kind === 'nav'    ? 'Navigate'
                  : item._kind === 'signal' ? 'Signals'
                  : 'Trades';

                return (
                  <React.Fragment key={`${item._kind}-${item._id ?? item.label ?? i}`}>
                    {showHdr && (
                      <div className={`px-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-600 ${
                        i === 0 ? 'pt-2' : 'pt-3 border-t border-slate-700/40 mt-1'
                      }`}>
                        {hdrLabel}
                      </div>
                    )}
                    <button
                      ref={(el) => {
                        if (el) itemRefs.current.set(i, el);
                        else itemRefs.current.delete(i);
                      }}
                      onClick={() => handleSelect(item)}
                      onMouseEnter={() => setSelected(i)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left ${
                        isActive
                          ? 'bg-accent/10 text-accent'
                          : 'text-slate-300 hover:bg-surface-elevated/40'
                      }`}
                    >
                      {/* ── Nav item ── */}
                      {item._kind === 'nav' && (
                        <>
                          <span className="font-mono text-base w-5 text-center flex-shrink-0 opacity-70">
                            {item.icon}
                          </span>
                          <span className="flex-1">{item.label}</span>
                          {item.path && (
                            <span className="text-[10px] text-slate-600 font-mono hidden sm:block">
                              {item.path}
                            </span>
                          )}
                          {item.group === 'Actions' && (
                            <span className="text-[9px] bg-surface-elevated text-slate-500 px-1.5 py-0.5 rounded uppercase tracking-wide">
                              action
                            </span>
                          )}
                        </>
                      )}

                      {/* ── Signal result ── */}
                      {item._kind === 'signal' && (
                        <>
                          <span className="font-mono text-sm w-5 text-center flex-shrink-0 opacity-60">
                            {item.verdict === 'BUY' ? '⚡' : item.verdict === 'WAIT' ? '⏸' : '✕'}
                          </span>
                          <span className="flex-1 font-mono font-bold text-slate-100">{item.symbol}</span>
                          <span className={`chip text-[10px] ${VERDICT_STYLES[item.verdict] ?? ''}`}>
                            {item.verdict}
                          </span>
                          {item.confidence === 'HIGH' && (
                            <span className="chip bg-emerald-500/15 text-emerald-400 text-[10px] hidden sm:inline-flex">
                              HIGH
                            </span>
                          )}
                          {item.gatesPassed != null && (
                            <span className="text-[10px] text-slate-600 font-mono hidden sm:block">
                              {item.gatesPassed}/8
                            </span>
                          )}
                          <span className="text-[10px] text-slate-600 font-mono hidden md:block">
                            {fmtDate(item.createdAt)}
                          </span>
                        </>
                      )}

                      {/* ── Trade result ── */}
                      {item._kind === 'trade' && (
                        <>
                          <span className="font-mono text-sm w-5 text-center flex-shrink-0 opacity-60">
                            {item.status === 'OPEN' ? '↗' : '✓'}
                          </span>
                          <span className="flex-1 font-mono font-bold text-slate-100">{item.symbol}</span>
                          <span className={`chip text-[10px] ${STATUS_STYLES[item.status] ?? ''}`}>
                            {item.status}
                          </span>
                          {item.realizedPnl != null ? (
                            <span className={`text-[10px] font-mono hidden sm:block ${item.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {item.realizedPnl >= 0 ? '+' : ''}₹{Math.abs(item.realizedPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                            </span>
                          ) : item.entryPrice != null ? (
                            <span className="text-[10px] text-slate-600 font-mono hidden sm:block">
                              entry ₹{item.entryPrice.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                            </span>
                          ) : null}
                          <span className="text-[10px] text-slate-600 font-mono hidden md:block">
                            {fmtDate(item.entryDate)}
                          </span>
                        </>
                      )}
                    </button>
                  </React.Fragment>
                );
              })
            )}

            {/* Show "Searching…" placeholder while fetching */}
            {searching && !hasDb && query.trim().length >= 2 && (
              <div className="flex items-center gap-3 px-4 py-3 text-xs text-slate-500">
                <Spinner size={12} />
                <span>Searching signals &amp; trades…</span>
              </div>
            )}
          </div>

          {/* Footer hints */}
          <div className="px-4 py-2.5 border-t border-slate-700/60 flex items-center gap-5 text-[10px] text-slate-600">
            <span><kbd className="font-mono bg-surface-elevated px-1 py-px rounded text-[9px]">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono bg-surface-elevated px-1 py-px rounded text-[9px]">↵</kbd> select</span>
            {query.trim().length >= 2 && (
              <span className="text-slate-700">searching signals &amp; trades</span>
            )}
            <span className="ml-auto"><kbd className="font-mono bg-surface-elevated px-1 py-px rounded text-[9px]">⌘K</kbd> toggle</span>
          </div>
        </div>
      </div>
    </>
  );
};

export default CommandPalette;
