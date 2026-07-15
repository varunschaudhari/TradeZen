/**
 * @file Dashboard.jsx
 * @description Portfolio-first command center: market pulse, portfolio hero,
 *   heat map, position progress bars, and today's BUY highlights.
 *   Full signal history lives on the /signals page.
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import MarketPulseStrip from '../components/MarketPulseStrip.jsx';
import PortfolioPanel from '../components/PortfolioPanel.jsx';
import TodaySignals from '../components/TodaySignals.jsx';
import WatchlistPrep from '../components/WatchlistPrep.jsx';
import SectorConcentrationBanner from '../components/SectorConcentrationBanner.jsx';
import ChartPreviewModal from '../components/ChartPreviewModal.jsx';
import useSignals from '../hooks/useSignals.js';
import useMarketStatus from '../hooks/useMarketStatus.js';
import useSocket from '../hooks/useSocket.js';
import { useApp } from '../context/AppContext.jsx';
import { SOCKET_EVENTS } from '../utils/constants.js';
import { timeAgo } from '../utils/formatters.js';
import { signalsApi, performanceApi, universeApi, tradesApi, watchlistApi } from '../services/api.js';

const SYMBOL_RE = /^[A-Z]{1,20}$/;

/* ── Streak Tracker ──────────────────────────────────────────────── */
const StreakCard = ({ trades }) => {
  const streak = useMemo(() => {
    if (!trades.length) return null;
    const sorted = [...trades].sort((a, b) => new Date(a.exitDate) - new Date(b.exitDate));
    let cur = 0, type = null, maxWin = 0, maxLoss = 0;
    for (const t of sorted) {
      const won = (t.realizedPnl ?? 0) > 0;
      const kind = won ? 'win' : 'loss';
      cur  = kind === type ? cur + 1 : 1;
      type = kind;
      if (won) maxWin  = Math.max(maxWin,  cur);
      else     maxLoss = Math.max(maxLoss, cur);
    }
    return { cur, type, maxWin, maxLoss, total: trades.length };
  }, [trades]);

  if (!streak) return null;

  return (
    <div className="card flex flex-wrap items-center gap-4">
      <div>
        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Current Streak</p>
        <div className="flex items-center gap-2">
          <span className="text-xl leading-none">{streak.type === 'win' ? '🔥' : '📉'}</span>
          <span className={`text-2xl font-mono font-bold leading-none ${streak.type === 'win' ? 'text-emerald-400' : 'text-red-400'}`}>
            {streak.cur}
          </span>
          <span className={`text-sm ${streak.type === 'win' ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
            {streak.type === 'win' ? 'consecutive wins' : 'consecutive losses'}
          </span>
        </div>
      </div>
      <div className="ml-auto flex gap-6">
        <div className="text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">Best run</p>
          <p className="text-emerald-400 font-mono font-bold text-lg leading-none mt-1">{streak.maxWin}W</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">Worst run</p>
          <p className="text-red-400 font-mono font-bold text-lg leading-none mt-1">{streak.maxLoss}L</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">Total</p>
          <p className="text-slate-300 font-mono font-bold text-lg leading-none mt-1">{streak.total}</p>
        </div>
      </div>
    </div>
  );
};

/* ── Quick stock search / analyze ────────────────────────────────── */
const StockSearch = ({ value, onChange, universe, onPick }) => {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef(null);
  const q = value.trim().toUpperCase();
  const matches = useMemo(
    () => (q.length >= 1 ? universe.filter((s) => s.includes(q)).slice(0, 6) : []),
    [q, universe]
  );
  const canAnalyze = SYMBOL_RE.test(q);

  return (
    <div className="relative w-full sm:w-64">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 120); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && canAnalyze) { onPick(q); setOpen(false); } }}
        placeholder="Analyze any NSE stock…"
        className="input py-1.5 text-sm"
        spellCheck={false}
      />
      {open && q && (
        <ul
          className="absolute z-30 mt-1 w-full rounded-lg border border-slate-700 bg-surface-card shadow-xl overflow-hidden"
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
  value:    PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  universe: PropTypes.arrayOf(PropTypes.string).isRequired,
  onPick:   PropTypes.func.isRequired,
};

/* ── Onboarding ──────────────────────────────────────────────────── */
const ONBOARDING_STEPS = [
  {
    n: '1',
    title: 'Add stocks to your watchlist',
    body: 'Go to Watchlist → add any NSE symbol. The scanner checks every stock every 15 minutes during market hours.',
    link: '/watchlist',
    cta: 'Open Watchlist →',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/25',
  },
  {
    n: '2',
    title: 'Let the 8-gate system filter setups',
    body: 'Nifty trend, RSI, volume, risk:reward and 4 more gates must pass before a verdict is even computed.',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/25',
  },
  {
    n: '3',
    title: 'BUY signals appear here',
    body: 'When all gates pass and the composite score reaches HIGH confidence, a BUY signal lands on this dashboard in real time.',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/25',
  },
];

const OnboardingBanner = ({ watchlistEmpty, navigate }) => (
  <div className="card border border-accent/20 bg-accent/5 space-y-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-100">Welcome to TradeZen</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          {watchlistEmpty
            ? 'Your watchlist is empty — follow these steps to get your first signal.'
            : 'Your watchlist is ready — the scanner will produce signals during market hours.'}
        </p>
      </div>
      <span className="text-2xl leading-none">⚡</span>
    </div>
    <div className="grid sm:grid-cols-3 gap-3">
      {ONBOARDING_STEPS.map((s) => (
        <div key={s.n} className={`rounded-xl border p-4 space-y-1.5 ${s.bg}`}>
          <div className={`text-[11px] font-bold uppercase tracking-widest ${s.color}`}>
            Step {s.n}
          </div>
          <p className="text-sm font-semibold text-slate-200">{s.title}</p>
          <p className="text-xs text-slate-400 leading-relaxed">{s.body}</p>
          {s.link && (
            <button
              onClick={() => navigate(s.link)}
              className={`text-xs font-medium mt-1 ${s.color} hover:opacity-80 transition-opacity`}
            >
              {s.cta}
            </button>
          )}
        </div>
      ))}
    </div>
  </div>
);

/* ── Scan pulse icon ─────────────────────────────────────────────── */
const BoltIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
  </svg>
);

/* ── Dashboard ───────────────────────────────────────────────────── */
const Dashboard = () => {
  const navigate = useNavigate();
  const { signals, loading, refresh } = useSignals();
  const { market }                    = useMarketStatus();
  const { subscribe }                 = useSocket();
  const { lastScanTime, setLastScanTime } = useApp();

  const [scanning,      setScanning]      = useState(false);
  const [perf,          setPerf]          = useState(null);
  const [sectorData,    setSectorData]    = useState(null);
  const [closedTrades,  setClosedTrades]  = useState([]);
  const [watchlistLen,  setWatchlistLen]  = useState(null);
  const [universe,      setUniverse]      = useState([]);
  const [search,        setSearch]        = useState('');
  const [previewSymbol, setPreviewSymbol] = useState(null);
  const [, setTick]     = useState(0); // forces re-render every 60s so scan badge stays current

  /* ── Data loads ─────────────────────────────────────────────────── */
  const loadPerf = useCallback(async () => {
    try {
      const res = await performanceApi.get();
      setPerf(res?.data ?? res);
    } catch { /* non-critical — portfolio panel falls back gracefully */ }
  }, []);

  const loadSector = useCallback(async () => {
    try {
      const res = await tradesApi.getSectorConcentration();
      setSectorData(res?.data ?? res);
    } catch { /* non-critical */ }
  }, []);

  const loadStreak = useCallback(async () => {
    try {
      const res = await tradesApi.getAll();
      const all = res?.data ?? res ?? [];
      setClosedTrades(all.filter((t) => t.status === 'CLOSED'));
    } catch { /* non-critical */ }
  }, []);

  const loadWatchlistLen = useCallback(async () => {
    try {
      const res = await watchlistApi.get();
      setWatchlistLen((res?.data ?? res ?? []).length);
    } catch { setWatchlistLen(0); }
  }, []);

  useEffect(() => {
    loadPerf(); loadSector(); loadStreak(); loadWatchlistLen();
  }, [loadPerf, loadSector, loadStreak, loadWatchlistLen]);

  useEffect(() => {
    universeApi.get()
      .then((r) => setUniverse(r?.data?.symbols ?? r?.symbols ?? []))
      .catch(() => {});
  }, []);

  /* Keep the scan badge text fresh — re-render every 60s */
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  /* ── Socket events ─────────────────────────────────────────────── */
  useEffect(() => {
    return subscribe(SOCKET_EVENTS.SCAN_COMPLETE, (data) => {
      setLastScanTime(new Date());
      loadPerf();
      loadSector();
      loadStreak();
      if ((data?.buySignals ?? 1) > 0) refresh();
    });
  }, [subscribe, setLastScanTime, loadPerf, loadSector, loadStreak, refresh]);

  useEffect(() => {
    return subscribe(SOCKET_EVENTS.MARKET_BEARMODE, () => {
      toast.error('BEAR MODE — BUY signals blocked for now', { duration: 8000 });
    });
  }, [subscribe]);

  useEffect(() => {
    return subscribe(SOCKET_EVENTS.MARKET_VIXSPIKE, ({ vix }) => {
      toast.error(`VIX spike: ${vix?.toFixed(1)} — elevated market risk`, { duration: 8000 });
    });
  }, [subscribe]);

  /* ── Handlers ───────────────────────────────────────────────────── */
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
    setSearch('');
  }, [navigate]);

  /* ── Today's BUY signals (IST date boundary) ────────────────────── */
  const todayBuys = useMemo(() => {
    const nowIST  = new Date(Date.now() + 5.5 * 3600 * 1000);
    const todayStr = nowIST.toISOString().slice(0, 10);
    return signals.filter((s) => {
      if (s.verdict !== 'BUY') return false;
      const d    = new Date(s.createdAt);
      const dIST = new Date(d.getTime() + 5.5 * 3600 * 1000);
      return dIST.toISOString().slice(0, 10) === todayStr;
    });
  }, [signals]);

  /* ── Loading skeleton ───────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-slate-700 border-t-accent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface p-4 sm:p-6 space-y-4 max-w-[1600px] mx-auto">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Command Center</h1>
          <p className="text-xs text-slate-500 mt-0.5">Paper portfolio · NSE swing signals</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StockSearch value={search} onChange={setSearch} universe={universe} onPick={openStock} />
          <button
            onClick={() => { refresh(); loadPerf(); loadStreak(); }}
            className="btn-ghost text-sm"
            title="Refresh data"
          >
            ↺ Refresh
          </button>
          {/* Scan time badge — prominently grouped with the Scan Now action */}
          {lastScanTime && (
            <span
              title="Time of the last completed scanner run"
              className="text-xs font-mono text-slate-400 bg-surface-card border border-slate-700/60 rounded-md px-2.5 py-1.5 whitespace-nowrap"
            >
              ⏱ {timeAgo(lastScanTime.toISOString())}
            </span>
          )}
          <button
            onClick={handleManualScan}
            disabled={scanning}
            className="btn-success text-sm flex items-center gap-1.5"
          >
            <BoltIcon />
            {scanning ? 'Queuing…' : 'Scan Now'}
          </button>
        </div>
      </header>

      {/* ── Onboarding (new users: no signals yet) ──────────────────── */}
      {!loading && signals.length === 0 && watchlistLen !== null && (
        <OnboardingBanner watchlistEmpty={watchlistLen === 0} navigate={navigate} />
      )}

      {/* ── Market pulse strip ──────────────────────────────────────── */}
      <MarketPulseStrip market={market} />

      {/* ── Sector concentration (warning or compact bar) ────────────── */}
      <SectorConcentrationBanner data={sectorData} />

      {/* ── Portfolio command center (hero + heat map + positions) ───── */}
      <PortfolioPanel perf={perf} />

      {/* ── Streak tracker ──────────────────────────────────────────── */}
      <StreakCard trades={closedTrades} />

      {/* ── Today's BUY signals (max 5, compact) ────────────────────── */}
      <TodaySignals
        signals={todayBuys}
        onViewAll={() => navigate('/signals')}
      />

      {/* ── EOD prep watchlist (self-hides when empty) ──────────────── */}
      <WatchlistPrep />

      {/* ── Quick chart preview modal ────────────────────────────────── */}
      {previewSymbol && (
        <ChartPreviewModal symbol={previewSymbol} onClose={() => setPreviewSymbol(null)} />
      )}
    </div>
  );
};

export default Dashboard;
