/**
 * @file NotificationDrawer.jsx
 * @description Right-side slide-in drawer with recent alerts, unread badge, and actions.
 */

import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../context/NotificationContext.jsx';
import { timeAgo } from '../utils/formatters.js';

/* ── Bell icon (also used externally for the trigger button) ─────── */
export const BellIcon = ({ count = 0, onClick, className = '' }) => (
  <button
    onClick={onClick}
    className={`relative p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-surface-elevated/50 transition-colors ${className}`}
    aria-label="Notifications"
  >
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
    {count > 0 && (
      <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
        {count > 99 ? '99+' : count}
      </span>
    )}
  </button>
);

BellIcon.propTypes = {
  count: PropTypes.number,
  onClick: PropTypes.func,
  className: PropTypes.string,
};

/* ── Single notification row ────────────────────────────────────── */
const NotifRow = ({ notif, meta }) => {
  const navigate = useNavigate();
  const { icon, color } = meta[notif.type] ?? { icon: '📣', color: 'text-slate-400' };

  const handleClick = () => {
    if (notif.type === 'BUY_SIGNAL' && notif.data?.symbol) navigate(`/stock/${notif.data.symbol}`);
    else if (notif.type === 'SCAN_COMPLETE') navigate('/signals');
    else if (notif.type === 'SL_WARNING') navigate('/positions');
    else if (notif.type === 'PRICE_ALERT' && notif.data?.symbol) navigate(`/stock/${notif.data.symbol}`);
  };

  return (
    <button
      onClick={handleClick}
      className={`w-full text-left flex items-start gap-3 px-4 py-3 border-b border-slate-800/60 last:border-0 transition-colors
        ${notif.read ? 'hover:bg-surface-elevated/30' : 'bg-accent/5 hover:bg-accent/10'}
      `}
    >
      <span className="text-base flex-shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-[12px] font-semibold leading-tight ${color} ${notif.read ? 'opacity-70' : ''}`}>
          {notif.title}
        </p>
        <p className="text-[11px] text-slate-400 mt-0.5 leading-tight line-clamp-2">{notif.message}</p>
        <p className="text-[10px] text-slate-600 mt-1">{timeAgo(notif.timestamp)}</p>
      </div>
      {!notif.read && (
        <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0 mt-1.5" />
      )}
    </button>
  );
};

NotifRow.propTypes = {
  notif: PropTypes.object.isRequired,
  meta:  PropTypes.object.isRequired,
};

/* ── Drawer ─────────────────────────────────────────────────────── */
const NotificationDrawer = ({ open, onClose }) => {
  const { notifications, unreadCount, markAllRead, clearAll, TYPE_META } = useNotifications();
  const drawerRef = useRef(null);

  // Mark all read when drawer opens
  useEffect(() => {
    if (open && unreadCount > 0) markAllRead();
  }, [open, unreadCount, markAllRead]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={`fixed top-0 right-0 h-full w-80 max-w-full bg-surface border-l border-slate-700/60
          shadow-2xl z-50 flex flex-col transition-transform duration-200 ease-in-out
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-800/80 flex-shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-100">Notifications</h2>
            {notifications.length > 0 && (
              <span className="text-[10px] text-slate-500">{notifications.length}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {notifications.length > 0 && (
              <button onClick={clearAll} className="text-[11px] text-slate-500 hover:text-slate-300 px-2 py-1">
                Clear all
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded text-slate-400 hover:text-slate-200">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
              <span className="text-4xl">🔔</span>
              <p className="text-slate-400 text-sm font-medium">No alerts yet</p>
              <p className="text-slate-600 text-xs">
                BUY signals, SL warnings, market mode changes, and scan results will appear here in real time.
              </p>
            </div>
          ) : (
            notifications.map((n) => (
              <NotifRow key={n.id} notif={n} meta={TYPE_META} />
            ))
          )}
        </div>

        {/* Footer hint */}
        {notifications.length > 0 && (
          <div className="px-4 py-2 border-t border-slate-800/60 flex-shrink-0">
            <p className="text-[10px] text-slate-600 text-center">
              Showing last {notifications.length} alerts · stored locally
            </p>
          </div>
        )}
      </div>
    </>
  );
};

NotificationDrawer.propTypes = {
  open:    PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default NotificationDrawer;
