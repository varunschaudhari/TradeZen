/**
 * @file ChatWidget.jsx
 * @description Ask Claude anything — floating chat panel powered by POST /api/chat
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import React, { useState, useRef, useEffect } from 'react';
import { chatApi } from '../services/api.js';

const Message = ({ role, text }) => (
  <div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'} mb-2`}>
    <div
      className={`max-w-[85%] rounded-xl px-3 py-2 text-xs whitespace-pre-wrap leading-relaxed ${
        role === 'user'
          ? 'bg-blue-600 text-white'
          : 'bg-surface-elevated text-slate-200 border border-slate-700'
      }`}
    >
      {text}
    </div>
  </div>
);

const ChatWidget = () => {
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hi! Ask me anything about market conditions, your signals, or trading strategy.' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const message = input.trim();
    if (!message || loading) return;

    setMessages((prev) => [...prev, { role: 'user', text: message }]);
    setInput('');
    setLoading(true);

    try {
      const response = await chatApi.ask(message);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: response.data?.reply ?? 'No response received.' },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `Error: ${err.message}` },
      ]);
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

  return (
    <div className="card flex flex-col h-96">
      <h3 className="font-semibold text-sm text-slate-200 mb-3 flex items-center gap-2">
        <span className="text-purple-400">✦</span> Ask Claude
      </h3>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-1">
        {messages.map((msg, idx) => (
          <Message key={idx} role={msg.role} text={msg.text} />
        ))}
        {loading && (
          <div className="flex justify-start mb-2">
            <div className="bg-surface-elevated border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-400">
              <span className="animate-pulse">Claude is thinking...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2 mt-3">
        <textarea
          className="flex-1 bg-surface-elevated rounded-lg px-3 py-2 text-xs resize-none h-10 focus:outline-none focus:ring-1 focus:ring-purple-500 text-slate-200 placeholder-slate-500"
          placeholder="Ask anything... (Enter to send)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs rounded-lg transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default ChatWidget;
