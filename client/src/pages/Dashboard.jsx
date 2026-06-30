/**
 * @file Dashboard.jsx
 * @description Command-center dashboard — market status, KPI row, and a searchable,
 *   filterable signal grid with live prices. Clicking a stock (or searching any NSE
 *   symbol) opens the dedicated /stock/:symbol detail page.
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-23
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import MarketStatusBar from '../components/MarketStatusBar.jsx';
import SignalCard from '../components/SignalCard.jsx';
import KpiCard from '../components/KpiCard.jsx';
import ChartPreviewModal from '../components/ChartPreviewModal.jsx';
import WatchlistPrep from '../components/WatchlistPrep.jsx';
import ActionHero from '../components/ActionHero.jsx';
import useSignals from '../hooks/useSignals.js';
import useMarketStatus from '../hooks/useMarketStatus.js';
import useSocket from '../hooks/useSocket.js';
import useQuotes from '../hooks/useQuotes.js';
import { useApp } from '../context/AppContext.jsx';
import { SOCKET_EVENTS } from '../utils/constants.js';
import { timeAgo, formatCurrency, formatPercent } from '../utils/formatters.js';
import { signalsApi, performanceApi, universeApi } from '../services/api.js';

const MAX_OPEN_TRADES = 15;      // mirrors backend constants.js
const MAX_CAPITAL_PCT = 95;      // mirrors MAX_CAPITAL_DEPLOYED_PCT
const VERDICT_ORDER = { BUY: 0, WAIT: 1, SKIP: 2 };
const SYMBOL_RE = /^[A-Z]{1,20}$/;

/* ── Inline icons (18px) ───────────────────────────────────────────────────── */
const I = ({ d, className = 'w-[18px] h-[18px]' }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);
const ICONS = {
  bolt:   'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
  layers: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941',
  pnl:    'M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  wallet: 'M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3',
  search: 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z',
};

const FILTERS = ['ALL', 'BUY', 'WAIT', 'SKIP'];
const CONFIDENCES = ['ALL', 'HIGH', 'MEDIUM', 'LOW'];
const SENTIMENTS_F = ['ALL', 'POSITIVE', 'NEUTRAL', 'NEGATIVE'];
const MIN_GATES = [0, 5, 6, 7, 8];
const SORTS = [
  { key: 'verdict', label: 'Default' },
  { key: 'rr', label: 'Risk:Reward' },
  { key: 'gates', label: 'Gates passed' },
  { key: 'time', label: 'Newest' },
  { key: 'rsi', label: 'RSI (low→high)' },
];

/* ── Stock search with universe autocomplete ──────────────────────────────── */
const StockSearch = ({ value, onChange, universe, onPick }) => {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef(null);
  const q = value.trim().toUpperCase();
  const matches = useMemo(
    () => (q ? universe.filter((s) => s.includes(q)).slice(0, 7) : []),
    [q, universe]
  );
  const canAnalyze = SYMBOL_RE.test(q);

  return (
    <div className="relative w-full sm:w-72">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
        <I d={ICONS.search} className="w-4 h-4" />
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 120); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && canAnalyze) { onPick(q); setOpen(false); } }}
        placeholder="Search or analyze any NSE stock…"
        className="input pl-9"
        spellCheck={false}
      />
      {open && q && (
        <ul
          className="absolute z-30 mt-1 w-full rounded-lg border border-slate-700 bg-surface-card shadow-drawer overflow-hidden"
          onMouseEnter={() => clearTimeout(blurTimer.current)}
        >
          {matches.map((s) => (
            <li key={s}>
              <button
                onMouseDown={() => { onPick(s); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm font-mono text-slate-200 hover:bg-surface-elevated/60"
              >
                {s}
              </button>
            </li>
          ))}
          {canAnalyze && (
            <li className="border-t border-slate-700/60">
              <button
                onMouseDown={() => { onPick(q); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm text-accent hover:bg-surface-elevated/60"
              >
                Analyze &ldquo;{q}&rdquo; →
              </button>
            </li>
          )}
          {!matches.length && !canAnalyze && (
            <li className="px-3 py-2 text-xs text-slate-500">No matches</li>
          )}
        </ul>
      )}
    </div>
  );
};

StockSearch.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  universe: PropTypes.arrayOf(PropTypes.string).isRequired,
  onPick: PropTypes.func.isRequired,
};

/* ── Labeled select ───────────────────────────────────────────────────────── */
const FilterSelect = ({ label, value, onChange, options }) => (
  <label className="flex items-center gap-1.5 text-xs text-slate-500">
    <span className="hidden sm:inline">{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input py-1 text-xs w-auto">
      {options.map((o) =>
        typeof o === 'object'
          ? <option key={o.key} value={o.key}>{o.label}</option>
          : <option key={o} value={o}>{o === 'ALL' ? `${label}: all` : o}</option>
      )}
    </select>
  </label>
);

FilterSelect.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.array.isRequired,
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { signals, loading, error, refresh } = useSignals();
  const { market } = useMarketStatus();
  const { subscribe } = useSocket();
  const { lastScanTime, setLastScanTime } = useApp();

  const [scanning, setScanning] = useState(false);
  const [perf, setPerf] = useState(null);
  const [universe, setUniverse] = useState([]);
  const [previewSymbol, setPreviewSymbol] = useState(null);
  const [compact, setCompact] = useState(false);

  // Filters
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [confidence, setConfidence] = useState('ALL');
  const [sentiment, setSentiment] = useState('ALL');
  const [minGates, setMinGates] = useState(0);
  const [sortBy, setSortBy] = useState('verdict');

  // Live quotes for every signal symbol
  const allSymbols = useMemo(() => signals.map((s) => s.symbol), [signals]);
  const { quotes } = useQuotes(allSymbols);

  /* ── Data loads ────────────────────────────────────────────────────────── */
  const loadPerf = useCallback(async () => {
    try {
      const res = await performanceApi.get();
      setPerf(res.data);
    } catch { /* KPIs are non-critical */ }
  }, []);
  useEffect(() => { loadPerf(); }, [loadPerf]);

  useEffect(() => {
    universeApi.get().then((res) => setUniverse(res.data?.symbols ?? [])).catch(() => {});
  }, []);

  /* ── Socket wiring ─────────────────────────────────────────────────────── */
  useEffect(() => {
    return subscribe(SOCKET_EVENTS.SCAN_COMPLETE, (data) => {
      setLastScanTime(new Date());
      loadPerf();
      if (data.buySignals > 0) refresh();
    });
  }, [subscribe, setLastScanTime, refresh, loadPerf]);

  useEffect(() => {
    return subscribe(SOCKET_EVENTS.MARKET_BEARMODE, () => {
      toast.error('BEAR MODE activated — all BUY signals are blocked', { duration: 8000 });
    });
  }, [subscribe]);

  useEffect(() => {
    return subscribe(SOCKET_EVENTS.MARKET_VIXSPIKE, ({ vix }) => {
      toast.error(`VIX spike: ${vix?.toFixed(1) ?? '—'} — elevated market risk`, { duration: 8000 });
    });
  }, [subscribe]);

  const handleManualScan = useCallback(async () => {
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

  const openStock = useCallback((sym) => {
    if (SYMBOL_RE.test(sym)) navigate(`/stock/${sym}`);
  }, [navigate]);

  /* ── Derived data ──────────────────────────────────────────────────────── */
  const counts = useMemo(() => {
    const c = { ALL: signals.length, BUY: 0, WAIT: 0, SKIP: 0 };
    signals.forEach((s) => { if (c[s.verdict] != null) c[s.verdict] += 1; });
    return c;
  }, [signals]);

  const visibleSignals = useMemo(() => {
    const q = search.trim().toUpperCase();
    const filtered = signals.filter((s) => {
      if (filter !== 'ALL' && s.verdict !== filter) return false;
      if (confidence !== 'ALL' && s.confidence !== confidence) return false;
      if (sentiment !== 'ALL' && s.newsSentiment !== sentiment) return false;
      if ((s.gatesPassed ?? 0) < minGates) return false;
      if (q && !s.symbol?.toUpperCase().includes(q)) return false;
      return true;
    });

    const sorters = {
      rr: (a, b) => (b.riskReward ?? 0) - (a.riskReward ?? 0),
      gates: (a, b) => (b.gatesPassed ?? 0) - (a.gatesPassed ?? 0),
      time: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      rsi: (a, b) => (a.indicators?.rsi ?? 999) - (b.indicators?.rsi ?? 999),
      verdict: (a, b) => {
        const vo = (VERDICT_ORDER[a.verdict] ?? 9) - (VERDICT_ORDER[b.verdict] ?? 9);
        return vo !== 0 ? vo : new Date(b.createdAt) - new Date(a.createdAt);
      },
    };
    return [...filtered].sort(sorters[sortBy] ?? sorters.verdict);
  }, [signals, filter, search, confidence, sentiment, minGates, sortBy]);

  /* KPI values */
  const deployed = perf?.totalDeployed ?? 0;
  const capital = perf?.capital ?? 0;
  const deployedPct = capital > 0 ? (deployed / capital) * 100 : 0;
  const overCap = deployedPct > MAX_CAPITAL_PCT;
  const unrealized = perf?.unrealizedPnl ?? 0;
  const unrealizedPct = deployed > 0 ? (unrealized / deployed) * 100 : 0;
  const openPositions = perf?.openPositions ?? 0;

  /* ── Loading ───────────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-slate-700 border-t-accent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface p-4 sm:p-6 space-y-5 max-w-[1600px] mx-auto">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Live signal scanner ·{' '}
            <span className="text-slate-400">
              last scan {lastScanTime ? timeAgo(lastScanTime.toISOString()) : '—'}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { refresh(); loadPerf(); }} className="btn-ghost text-sm">Refresh</button>
          <button onClick={handleManualScan} disabled={scanning} className="btn-success text-sm flex items-center gap-1.5">
            <I d={ICONS.bolt} className="w-4 h-4" />
            {scanning ? 'Queuing…' : 'Scan Now'}
          </button>
        </div>
      </header>

      {/* ── Today's action — the headline "what do I do now?" ────────────── */}
      <ActionHero
        buyCount={counts.BUY}
        waitCount={counts.WAIT}
        totalSignals={counts.ALL}
        market={market}
        onViewBuys={() => setFilter('BUY')}
      />

      {/* ── Market status ────────────────────────────────────────────────── */}
      <MarketStatusBar market={market} />

      {error && <div className="card border-bear/30 bg-bear/10 text-bear text-sm">{error}</div>}

      {/* ── KPI command row ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          label="Active BUY signals"
          value={counts.BUY}
          sub={`${counts.ALL} signal${counts.ALL === 1 ? '' : 's'} scanned`}
          accent="buy"
          valueColor={counts.BUY > 0 ? 'text-buy' : 'text-slate-100'}
          icon={<I d={ICONS.bolt} />}
          hint="Signals that cleared all hard gates and Claude with HIGH confidence — the only ones the system suggests acting on."
        />
        <KpiCard
          label="Open positions"
          value={`${openPositions} / ${MAX_OPEN_TRADES}`}
          sub={`${MAX_OPEN_TRADES - openPositions} slot${MAX_OPEN_TRADES - openPositions === 1 ? '' : 's'} available`}
          accent="accent"
          icon={<I d={ICONS.layers} />}
          progress={(openPositions / MAX_OPEN_TRADES) * 100}
          loading={!perf}
          hint={`Manually logged open trades. Capped at ${MAX_OPEN_TRADES} simultaneous positions to limit concentration risk.`}
        />
        <KpiCard
          label="Unrealized P&L"
          value={formatCurrency(unrealized, 0)}
          sub={deployed > 0 ? `${formatPercent(unrealizedPct)} on deployed` : 'No open capital'}
          accent={unrealized >= 0 ? 'buy' : 'bear'}
          valueColor={unrealized >= 0 ? 'text-bull' : 'text-bear'}
          icon={<I d={ICONS.pnl} />}
          loading={!perf}
          hint="Mark-to-market profit/loss on currently open positions, before costs. Updates when prices are refreshed."
        />
        <KpiCard
          label="Capital deployed"
          value={formatCurrency(deployed, 0)}
          sub={capital > 0 ? `${deployedPct.toFixed(0)}% of ${formatCurrency(capital, 0)} · cap ${MAX_CAPITAL_PCT}%` : '—'}
          accent={overCap ? 'bear' : 'wait'}
          icon={<I d={ICONS.wallet} />}
          progress={deployedPct}
          loading={!perf}
          hint={`Capital tied up in open positions. The system won't deploy beyond ${MAX_CAPITAL_PCT}% of total capital.`}
        />
      </div>

      {/* ── Next-session watchlist (EOD prep — self-hides when empty) ──────── */}
      <WatchlistPrep />

      {/* ── Signals section ──────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Signals</h2>
          <StockSearch value={search} onChange={setSearch} universe={universe} onPick={openStock} />
        </div>

        {/* Toolbar: verdict tabs + filters */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="seg-group">
            {FILTERS.map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`seg ${filter === f ? 'seg-active' : ''}`}>
                {f === 'ALL' ? 'All' : f}
                <span className="ml-1.5 text-slate-500">{counts[f]}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect label="Confidence" value={confidence} onChange={setConfidence} options={CONFIDENCES} />
            <FilterSelect label="Sentiment" value={sentiment} onChange={setSentiment} options={SENTIMENTS_F} />
            <FilterSelect
              label="Min gates"
              value={minGates}
              onChange={(v) => setMinGates(Number(v))}
              options={MIN_GATES.map((g) => ({ key: g, label: g === 0 ? 'Min gates: any' : `≥ ${g} gates` }))}
            />
            <FilterSelect label="Sort" value={sortBy} onChange={setSortBy} options={SORTS} />
            <button
              onClick={() => setCompact((v) => !v)}
              title={compact ? 'Comfortable view' : 'Compact view (more per row)'}
              className={`seg ${compact ? 'seg-active' : ''} border border-slate-700/70`}
            >
              {compact ? 'Comfortable' : 'Compact'}
            </button>
          </div>
        </div>

        {visibleSignals.length === 0 ? (
          <div className="card text-center py-16">
            <div className="grid place-items-center w-12 h-12 rounded-xl bg-surface-elevated/50 mx-auto mb-3">
              <I d={ICONS.bolt} className="w-6 h-6 text-slate-500" />
            </div>
            <p className="text-slate-300 font-medium">
              {signals.length === 0 ? 'No signals yet' : 'No signals match your filters'}
            </p>
            <p className="text-slate-500 text-sm mt-1">
              {signals.length === 0
                ? 'Add stocks to your watchlist and click Scan Now.'
                : 'Loosen the filters above, or search any stock to analyze it directly.'}
            </p>
          </div>
        ) : (
          <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${compact ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
            {visibleSignals.map((signal) => (
              <div
                key={signal._id}
                onClick={() => openStock(signal.symbol)}
                className="cursor-pointer rounded-xl transition duration-150 ring-1 ring-transparent hover:ring-slate-600"
              >
                <SignalCard signal={signal} quote={quotes[signal.symbol]} onPreview={setPreviewSymbol} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Quick chart preview (no navigation) */}
      {previewSymbol && (
        <ChartPreviewModal symbol={previewSymbol} onClose={() => setPreviewSymbol(null)} />
      )}
    </div>
  );
};

export default Dashboard;
