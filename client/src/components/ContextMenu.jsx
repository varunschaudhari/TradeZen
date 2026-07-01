import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

const ContextMenu = ({ x, y, items, onClose }) => {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x, y });

  /* Keep menu inside viewport */
  useEffect(() => {
    if (!ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth  - width  - 8),
      y: Math.min(y, window.innerHeight - height - 8),
    });
  }, [x, y]);

  /* Close on outside click, second right-click, or Escape */
  useEffect(() => {
    const close = () => onClose();
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top: pos.y, left: pos.x, zIndex: 9999 }}
      className="glass rounded-xl shadow-2xl overflow-hidden min-w-[172px] py-1 animate-fade-in"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) =>
        item.divider ? (
          <div key={item.key} className="mx-3 my-1 border-t border-slate-700/60" />
        ) : (
          <button
            key={item.label}
            onClick={() => { item.action(); onClose(); }}
            disabled={item.disabled}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300
                       hover:bg-surface-elevated/60 hover:text-white transition-colors text-left
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="w-4 text-center flex-shrink-0 text-base leading-none opacity-80">
              {item.icon}
            </span>
            <span>{item.label}</span>
            {item.sub && (
              <span className="ml-auto text-[10px] text-slate-600 font-mono">{item.sub}</span>
            )}
          </button>
        )
      )}
    </div>
  );
};

ContextMenu.propTypes = {
  x: PropTypes.number.isRequired,
  y: PropTypes.number.isRequired,
  items: PropTypes.arrayOf(PropTypes.shape({
    label:   PropTypes.string,
    icon:    PropTypes.string,
    action:  PropTypes.func,
    disabled:PropTypes.bool,
    divider: PropTypes.bool,
    key:     PropTypes.string,
    sub:     PropTypes.string,
  })).isRequired,
  onClose: PropTypes.func.isRequired,
};

export default ContextMenu;
