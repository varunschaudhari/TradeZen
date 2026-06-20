/**
 * @file Layout.jsx
 * @description App shell — responsive sidebar (desktop fixed, mobile slide-over) + content area.
 *
 *  Mobile  (< md): hamburger top-bar, sidebar slides in as overlay, backdrop closes it.
 *  Desktop (≥ md): sidebar always visible at left, content shifted right by w-52.
 */

import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { NavLink, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';

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
const NAV = [
  {
    path: '/dashboard',
    label: 'Dashboard',
    d: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25A2.25 2.25 0 0113.5 8.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z',
  },
  {
    path: '/signals',
    label: 'Signals',
    d: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zm8.25-4.5c0-.621.504-1.125 1.125-1.125h2.25C15.496 7.5 16 8.004 16 8.625v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zm8.25-6c0-.621.504-1.125 1.125-1.125h2.25C21.496 1.5 22 2.004 22 2.625v17.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V2.625z',
  },
  {
    path: '/positions',
    label: 'Positions',
    d: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941',
  },
  {
    path: '/performance',
    label: 'Performance',
    d: 'M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z',
  },
  {
    path: '/watchlist',
    label: 'Watchlist',
    d: 'M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z',
  },
  {
    path: '/settings',
    label: 'Settings',
    d: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  },
];

/* ── Sidebar content (shared between desktop + mobile) ───────────────────────── */
const SidebarContent = ({ onNavClick }) => {
  const { isConnected, marketMode } = useApp();

  const modeColor = { BULL: 'text-bull', CAUTION: 'text-wait', BEAR: 'text-bear' }[marketMode] ?? 'text-slate-400';

  return (
    <>
      {/* Brand */}
      <div className="px-4 py-4 border-b border-slate-800">
        <p className="font-bold text-blue-400 text-sm tracking-wide">SwingTrader AI</p>
        <p className="text-slate-500 text-xs mt-0.5">NSE Swing Trading</p>
      </div>

      {/* Nav links */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {NAV.map(({ path, label, d }) => (
          <NavLink
            key={path}
            to={path}
            onClick={onNavClick}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'bg-blue-600/20 text-blue-400 border-r-2 border-blue-400'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`
            }
          >
            <Icon d={d} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer status */}
      <div className="px-4 py-3 border-t border-slate-800 space-y-1.5">
        <div className="flex items-center gap-2 text-xs">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isConnected ? 'bg-bull animate-pulse' : 'bg-slate-600'}`} />
          <span className={isConnected ? 'text-bull' : 'text-slate-500'}>
            {isConnected ? 'WebSocket Live' : 'Disconnected'}
          </span>
        </div>
        <div className="text-xs">
          <span className="text-slate-500">Market: </span>
          <span className={`font-semibold ${modeColor}`}>{marketMode}</span>
        </div>
      </div>
    </>
  );
};

SidebarContent.propTypes = {
  onNavClick: PropTypes.func,
};

/* ── Layout ─────────────────────────────────────────────────────────────────── */
const Layout = ({ children }) => {
  const [open, setOpen] = useState(false);
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
          fixed top-0 left-0 h-full w-52 bg-slate-900 border-r border-slate-800
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

        <SidebarContent onNavClick={() => setOpen(false)} />
      </aside>

      {/* ── Mobile top-bar ────────────────────────────────────────────────── */}
      <header className="md:hidden fixed top-0 left-0 right-0 h-12 bg-slate-900 border-b border-slate-800 flex items-center px-4 z-20 gap-3">
        <button
          onClick={() => setOpen(true)}
          className="p-1 rounded text-slate-400 hover:text-slate-200 transition-colors"
          aria-label="Open menu"
        >
          <HamburgerIcon />
        </button>
        <span className="font-bold text-blue-400 text-sm tracking-wide">SwingTrader AI</span>
      </header>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      {/* pt-12 on mobile for the top-bar; no padding on desktop */}
      <main className="flex-1 min-h-screen overflow-x-hidden md:ml-52 pt-12 md:pt-0">
        {children}
      </main>
    </div>
  );
};

Layout.propTypes = { children: PropTypes.node.isRequired };

export default Layout;
