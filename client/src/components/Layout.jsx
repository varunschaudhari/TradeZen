/**
 * @file Layout.jsx
 * @description App shell — responsive sidebar (desktop fixed, mobile slide-over) + content area.
 *
 *  Mobile  (< md): hamburger top-bar, sidebar slides in as overlay, backdrop closes it.
 *  Desktop (≥ md): sidebar always visible at left, content shifted right by w-52.
 */

import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { NavLink, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useNotifications } from '../context/NotificationContext.jsx';
import NotificationDrawer, { BellIcon } from './NotificationDrawer.jsx';
import useServiceHealth from '../hooks/useServiceHealth.js';

/* ── Mobile bottom tab config ───────────────────────────────────────────────── */
const BOTTOM_TABS = [
  {
    path: '/dashboard',
    label: 'Home',
    d: 'M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25',
  },
  {
    path: '/signals',
    label: 'Signals',
    d: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zm8.25-4.5c0-.621.504-1.125 1.125-1.125h2.25C15.496 7.5 16 8.004 16 8.625v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zm8.25-6c0-.621.504-1.125 1.125-1.125h2.25C21.496 1.5 22 2.004 22 2.625v17.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V2.625z',
  },
  {
    path: '/positions',
    label: 'Trades',
    d: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941',
  },
  {
    path: '/performance',
    label: 'Stats',
    d: 'M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z',
  },
  {
    path: '/watchlist',
    label: 'Watch',
    d: 'M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z',
  },
];

/* ── Icons ──────────────────────────────────────────────────────────────────── */
const Icon = ({ d, className = 'w-5 h-5 flex-shrink-0' }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

const HamburgerIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

const CloseIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

/* ── Nav definition ─────────────────────────────────────────────────────────── */
const NAV_SECTIONS = [
  {
    heading: 'Trading',
    items: [
      {
        path: '/dashboard',
        label: 'Dashboard',
        d: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25A2.25 2.25 0 0113.5 8.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z',
      },
      {
        path: '/swing-trading',
        label: 'Swing Trading',
        d: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941',
      },
      {
        path: '/intraday-trading',
        label: 'Intraday Trading',
        d: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
      },
      {
        path: '/signals',
        label: 'Signals',
        d: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zm8.25-4.5c0-.621.504-1.125 1.125-1.125h2.25C15.496 7.5 16 8.004 16 8.625v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zm8.25-6c0-.621.504-1.125 1.125-1.125h2.25C21.496 1.5 22 2.004 22 2.625v17.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V2.625z',
      },
      {
        path: '/scan',
        label: 'Scan Results',
        d: 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z',
      },
      {
        path: '/stocks',
        label: 'Stocks',
        d: 'M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5',
      },
      {
        path: '/universe',
        label: 'Universe',
        d: 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418',
      },
      {
        path: '/positions',
        label: 'Positions',
        d: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941',
      },
      {
        path: '/risk',
        label: 'Risk',
        d: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z',
      },
    ],
  },
  {
    heading: 'Analytics',
    items: [
      {
        path: '/monitor',
        label: 'Monitor',
        d: 'M3 12h3.75l1.5-6 3 12 2.25-9 1.5 3H21',
      },
      {
        path: '/performance',
        label: 'Performance',
        d: 'M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z',
      },
      {
        path: '/trade-ledger',
        label: 'Trade Ledger',
        d: 'M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5',
      },
      {
        path: '/risk-attribution',
        label: 'Risk & Attribution',
        d: 'M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z',
      },
      {
        path: '/go-live-evidence',
        label: 'Go-Live Evidence',
        d: 'M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.19 4.63a1.5 1.5 0 01-.163 1.605l-.147.14a1.5 1.5 0 01-1.607.145L18.75 12M5.25 4.97c-1.01.143-2.01.317-3 .52m3-.52l2.19 4.63a1.5 1.5 0 01-.163 1.605l-.147.14a1.5 1.5 0 01-1.607.145L5.25 12M5.25 12v6.75A1.5 1.5 0 006.75 20.25h10.5a1.5 1.5 0 001.5-1.5V12',
      },
      {
        path: '/watchlist',
        label: 'Watchlist',
        d: 'M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z',
      },
      {
        path: '/backtest',
        label: 'Backtesting',
        d: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
      },
      {
        path: '/gates',
        label: 'Gate Analytics',
        d: 'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
      },
    ],
  },
  {
    heading: 'System',
    items: [
      {
        path: '/alerts',
        label: 'Price Alerts',
        d: 'M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0',
      },
      {
        path: '/holidays',
        label: 'Holiday Calendar',
        d: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5',
      },
      {
        path: '/settings',
        label: 'Settings',
        d: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
      },
    ],
  },
];

const MODE_STYLES = {
  BULL: { dot: 'bg-bull', text: 'text-bull', label: 'Bull' },
  CAUTION: { dot: 'bg-wait', text: 'text-wait', label: 'Caution' },
  MIXED: { dot: 'bg-orange-400', text: 'text-orange-400', label: 'Mixed' },
  BEAR: { dot: 'bg-bear', text: 'text-bear', label: 'Bear' },
};

/* ── Sidebar content (shared between desktop + mobile) ───────────────────────── */
const DOT = {
  ok:      'bg-bull',
  down:    'bg-bear',
  loading: 'bg-slate-600',
};

const SidebarContent = ({ onNavClick, onBell }) => {
  const { isConnected, marketMode } = useApp();
  const { user, logout } = useAuth();
  const { unreadCount } = useNotifications();
  const health = useServiceHealth();
  const mode = MODE_STYLES[marketMode] ?? { dot: 'bg-slate-600', text: 'text-slate-400', label: marketMode ?? '—' };
  const [bellRing, setBellRing] = useState(false);
  const prevCount = useRef(unreadCount);

  useEffect(() => {
    if (unreadCount > prevCount.current) {
      setBellRing(true);
      const t = setTimeout(() => setBellRing(false), 700);
      return () => clearTimeout(t);
    }
    prevCount.current = unreadCount;
  }, [unreadCount]);

  return (
    <>
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-slate-800/80 flex-shrink-0">
        <div className="grid place-items-center w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-accent-dark shadow-lg shadow-accent/20">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 7h4v4" />
          </svg>
        </div>
        <div className="leading-tight">
          <p className="font-semibold text-slate-100 text-sm tracking-tight">SwingTrader<span className="text-accent"> AI</span></p>
          <p className="text-slate-500 text-[10px] uppercase tracking-wider flex items-center gap-1.5">
            NSE Swing Trading
            <span
              className="px-1 py-px rounded bg-wait/15 text-wait text-[9px] font-bold tracking-wide normal-case"
              title="Paper mode — hypothetical positions only. The system never places real orders."
            >
              PAPER
            </span>
          </p>
        </div>
      </div>

      {/* Nav links */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {NAV_SECTIONS.map(({ heading, items }) => (
          <div key={heading} className="mb-4 last:mb-0">
            <p className="px-4 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              {heading}
            </p>
            {items.map(({ path, label, d }) => (
              <NavLink
                key={path}
                to={path}
                onClick={onNavClick}
                className={({ isActive }) =>
                  `relative flex items-center gap-3 mx-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-accent/10 text-accent font-medium'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-surface-elevated/50'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-accent" />
                    )}
                    <Icon d={d} />
                    <span>{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer status */}
      <div className="px-3 py-3 border-t border-slate-800/80 space-y-2 flex-shrink-0">
        {user && (
          <div className="flex items-center justify-between rounded-lg bg-surface-elevated/40 px-3 py-2 border border-slate-700/60">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-200 truncate">{user.name}</p>
              <p className="text-[10px] text-slate-500 truncate">{user.email}</p>
            </div>
            <button
              onClick={logout}
              className="text-[11px] text-slate-400 hover:text-red-400 transition-colors flex-shrink-0 ml-2"
              title="Log out"
            >
              Log out
            </button>
          </div>
        )}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isConnected ? 'bg-bull animate-pulse' : 'bg-slate-600'}`} />
            <span className={isConnected ? 'text-slate-300' : 'text-slate-500'}>
              {isConnected ? 'Live feed' : 'Disconnected'}
            </span>
          </div>
          <span className={bellRing ? 'bell-ring' : ''}>
            <BellIcon count={unreadCount} onClick={onBell} />
          </span>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-surface-elevated/40 px-3 py-2 border border-slate-700/60">
          <span className="text-[11px] text-slate-500 uppercase tracking-wide">Market</span>
          <span className={`flex items-center gap-1.5 text-xs font-semibold ${mode.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${mode.dot}`} />
            {mode.label}
          </span>
        </div>

        {/* Service health */}
        <div className="flex items-center justify-between rounded-lg bg-surface-elevated/40 px-3 py-1.5 border border-slate-700/60">
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">Services</span>
          <div className="flex items-center gap-2.5">
            {[['Node', health.node], ['DB', health.db], ['Py', health.python]].map(([label, status]) => (
              <span
                key={label}
                title={`${label}: ${status}`}
                className="flex items-center gap-1 text-[10px]"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${DOT[status] ?? DOT.loading}`} />
                <span className={status === 'ok' ? 'text-slate-400' : status === 'down' ? 'text-bear' : 'text-slate-600'}>
                  {label}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

SidebarContent.propTypes = {
  onNavClick: PropTypes.func,
  onBell:     PropTypes.func,
};

/* ── Layout ─────────────────────────────────────────────────────────────────── */
const Layout = ({ children }) => {
  const [open,         setOpen]         = useState(false);
  const [notifOpen,    setNotifOpen]    = useState(false);
  const { unreadCount } = useNotifications();
  const location = useLocation();

  /* Close sidebar on route change (mobile) */
  useEffect(() => { setOpen(false); }, [location.pathname]);

  /* Prevent body scroll when mobile sidebar is open */
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <div className="flex min-h-screen bg-surface">

      {/* ── Mobile backdrop ───────────────────────────────────────────────── */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-30 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      {/* Desktop: always visible (translate-x-0), fixed */}
      {/* Mobile:  slides from left; -translate-x-full when closed */}
      <aside
        className={`
          fixed top-0 left-0 h-full w-60 bg-surface border-r border-slate-800/80
          flex flex-col z-40 transition-transform duration-200 ease-in-out
          ${open ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0
        `}
      >
        {/* Mobile close button inside sidebar */}
        <button
          className="md:hidden absolute top-3 right-3 p-1 rounded text-slate-400 hover:text-slate-200"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
        >
          <CloseIcon />
        </button>

        <SidebarContent onNavClick={() => setOpen(false)} onBell={() => setNotifOpen(true)} />
      </aside>

      {/* ── Mobile top-bar ────────────────────────────────────────────────── */}
      <header className="md:hidden fixed top-0 left-0 right-0 h-12 bg-surface/95 backdrop-blur border-b border-slate-800/80 flex items-center px-4 z-20 gap-3">
        <button
          onClick={() => setOpen(true)}
          className="p-1 rounded text-slate-400 hover:text-slate-200 transition-colors"
          aria-label="Open menu"
        >
          <HamburgerIcon />
        </button>
        <span className="font-semibold text-slate-100 text-sm tracking-tight">
          SwingTrader<span className="text-accent"> AI</span>
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <BellIcon count={unreadCount} onClick={() => setNotifOpen(true)} />
          <span
            className="px-1.5 py-0.5 rounded bg-wait/15 text-wait text-[10px] font-bold"
            title="Paper mode — hypothetical positions only. The system never places real orders."
          >
            PAPER
          </span>
        </div>
      </header>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      {/* pt-12 on mobile for the top-bar + pb-16 for bottom tab bar */}
      <main className="flex-1 min-h-screen overflow-x-hidden md:ml-60 pt-12 md:pt-0 pb-16 md:pb-0">
        {children}
      </main>

      {/* ── Mobile bottom tab bar ─────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 glass border-t border-slate-700/60 flex items-stretch h-16">
        {BOTTOM_TABS.map(({ path, label, d }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
                isActive ? 'text-accent' : 'text-slate-500 hover:text-slate-300'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <svg
                  className={`w-5 h-5 flex-shrink-0 transition-transform ${isActive ? 'scale-110' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={isActive ? 2.2 : 1.8}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d={d} />
                </svg>
                <span className={`font-medium ${isActive ? 'text-accent' : ''}`}>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── Notification drawer ───────────────────────────────────────────── */}
      <NotificationDrawer open={notifOpen} onClose={() => setNotifOpen(false)} />
    </div>
  );
};

Layout.propTypes = { children: PropTypes.node.isRequired };

export default Layout;
