/**
 * @file ShortcutsModal.jsx
 * @description Global "?" keyboard shortcut reference. Press "?" (when not typing)
 *   to open. Press "?" or Escape to close.
 */
import React, { useState, useEffect } from 'react';

const SHORTCUTS = [
  {
    group: 'Global',
    items: [
      { keys: ['⌘K'],  label: 'Open command palette' },
      { keys: ['?'],   label: 'Show this reference' },
      { keys: ['Esc'], label: 'Close modal or palette' },
    ],
  },
  {
    group: 'Command Palette',
    items: [
      { keys: ['↑', '↓'], label: 'Navigate results' },
      { keys: ['↵'],      label: 'Select / go to page' },
      { keys: ['2+ chars'], label: 'Live search signals & trades' },
    ],
  },
  {
    group: 'Pages',
    items: [
      { keys: ['?'],    label: 'Keyboard shortcuts (any page)' },
      { keys: ['⌘K'],  label: 'Jump to any page by name' },
    ],
  },
];

const Kbd = ({ k }) => (
  <kbd className="inline-flex items-center px-1.5 py-0.5 rounded-md border border-slate-600/70 bg-surface-elevated text-slate-400 font-mono text-[11px] leading-tight">
    {k}
  </kbd>
);

const ShortcutsModal = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      const tag = (e.target?.tagName ?? '').toLowerCase();
      const editable = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
      if (editable) return;
      if (e.key === '?') { e.preventDefault(); setOpen((v) => !v); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <div
        className="fixed top-[12%] left-1/2 -translate-x-1/2 w-full max-w-sm z-[70] px-4"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <div className="bg-surface-card border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-700/60">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-sm">⌨</span>
              <h2 className="text-sm font-semibold text-slate-100">Keyboard Shortcuts</h2>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-slate-500 hover:text-slate-300 text-base leading-none transition-colors"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* Shortcut groups */}
          <div className="p-4 space-y-4">
            {SHORTCUTS.map(({ group, items }) => (
              <section key={group}>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2.5">
                  {group}
                </p>
                <div className="space-y-2">
                  {items.map(({ keys, label }) => (
                    <div key={label} className="flex items-center justify-between gap-4">
                      <span className="text-sm text-slate-300">{label}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {keys.map((k) => <Kbd key={k} k={k} />)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* Footer */}
          <div className="px-5 py-2.5 border-t border-slate-700/60 text-center">
            <p className="text-[10px] text-slate-600">
              Press <Kbd k="?" /> again or <Kbd k="Esc" /> to dismiss
            </p>
          </div>
        </div>
      </div>
    </>
  );
};

export default ShortcutsModal;
