/**
 * @file ChatWidget.jsx
 * @description Ask Claude — a floating, context-aware chat panel mounted globally in the
 *   app shell (Layout). A bottom-right launcher opens a slide-up panel that overlays the
 *   page without consuming layout space, so it's reachable from anywhere without scrolling.
 *   When the user is on a stock page (/stock/:symbol) the panel passes that symbol as
 *   context so answers are about the stock being viewed.
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-23
 */

import React, { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { chatApi } from '../services/api.js';

const Message = ({ role, text }) => (
  <div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'} mb-2`}>
    <div
      className={`max-w-[85%] rounded-xl px-3 py-2 text-xs whitespace-pre-wrap leading-relaxed ${
        role === 'user'
          ? 'bg-accent text-white'
          : 'bg-surface-elevated text-slate-200 border border-slate-700'
      }`}
    >
      {text}
    </div>
  </div>
);

const SparkIcon = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2l1.9 5.2L19 9l-5.1 1.8L12 16l-1.9-5.2L5 9l5.1-1.8L12 2z" />
  </svg>
);

const GREETING = {
  role: 'assistant',
  text: 'Hi! Ask me anything about market conditions, your signals, or a specific stock.',
};

const ChatWidget = () => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  /* Derive context from the current route — on /stock/:symbol we're "talking about" that stock. */
  const { pathname } = useLocation();
  const symbolMatch = pathname.match(/^\/stock\/([A-Za-z0-9.&-]+)/);
  const symbol = symbolMatch ? symbolMatch[1].toUpperCase() : null;

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const handleSend = async () => {
    const message = input.trim();
    if (!message || loading) return;

    setMessages((prev) => [...prev, { role: 'user', text: message }]);
    setInput('');
    setLoading(true);

    try {
      const response = await chatApi.ask(message, symbol ? { symbol } : undefined);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: response.data?.reply ?? 'No response received.' },
      ]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', text: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /* ── Launcher (collapsed) ─────────────────────────────────────────────────── */
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Ask Claude"
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full pl-3 pr-4 py-3
                   bg-gradient-to-br from-accent to-accent-dark text-white font-medium text-sm
                   shadow-lg shadow-accent/30 hover:shadow-accent/50 hover:-translate-y-0.5
                   transition-all duration-150 animate-fade-in-up"
      >
        <SparkIcon className="w-5 h-5" />
        <span className="hidden sm:inline">Ask Claude</span>
      </button>
    );
  }

  /* ── Panel (expanded) ─────────────────────────────────────────────────────── */
  return (
    <div
      className="fixed bottom-5 right-5 z-50 flex flex-col
                 w-[min(384px,calc(100vw-2.5rem))] h-[min(560px,calc(100vh-6rem))]
                 rounded-2xl border border-slate-700 bg-surface-card shadow-drawer
                 animate-fade-in-up overflow-hidden"
      role="dialog"
      aria-label="Ask Claude"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/70 bg-surface-elevated/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="grid place-items-center w-7 h-7 rounded-lg bg-accent/15 text-accent flex-shrink-0">
            <SparkIcon className="w-4 h-4" />
          </span>
          <div className="leading-tight min-w-0">
            <p className="text-sm font-semibold text-slate-100">Ask Claude</p>
            {symbol ? (
              <p className="text-[11px] text-accent-light truncate">Talking about {symbol}</p>
            ) : (
              <p className="text-[11px] text-slate-500">Market &amp; strategy</p>
            )}
          </div>
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close chat"
          className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-surface-elevated/60 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {messages.map((msg, idx) => (
          <Message key={idx} role={msg.role} text={msg.text} />
        ))}
        {loading && (
          <div className="flex justify-start mb-2">
            <div className="bg-surface-elevated border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-400">
              <span className="animate-pulse">Claude is thinking…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2 p-3 border-t border-slate-700/70">
        <textarea
          className="flex-1 bg-surface-elevated rounded-lg px-3 py-2 text-xs resize-none h-10
                     focus:outline-none focus:ring-1 focus:ring-accent text-slate-200 placeholder-slate-500"
          placeholder={symbol ? `Ask about ${symbol}… (Enter to send)` : 'Ask anything… (Enter to send)'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="px-3 py-2 bg-accent hover:bg-accent-dark disabled:opacity-50 disabled:cursor-not-allowed
                     text-white text-xs rounded-lg transition-colors self-stretch"
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default ChatWidget;
