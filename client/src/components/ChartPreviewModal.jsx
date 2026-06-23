/**
 * @file ChartPreviewModal.jsx
 * @description Quick-look chart preview — opens from a signal card so the user can eyeball
 *   price action, S/R, and the trade levels without leaving the dashboard. Reuses the same
 *   CandlestickChart (with overlays) as the full detail page, and offers a one-click jump
 *   to the full /stock/:symbol page.
 * @author SwingTrader AI Team
 * @created 2026-06-23
 */

import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import CandlestickChart from './CandlestickChart.jsx';
import useCandleData from '../hooks/useCandleData.js';
import { stockApi } from '../services/api.js';
import { formatCurrency, formatPercent } from '../utils/formatters.js';

const ChartPreviewModal = ({ symbol, onClose }) => {
  const navigate = useNavigate();
  const [interval, setIntervalState] = useState('1d');
  const period = interval === '1d' ? '1y' : '60d';
  const { candles, loading: chartLoading } = useCandleData(symbol, period, interval);
  const [detail, setDetail] = useState(null);

  /* Close on Escape */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* Fetch S/R + the latest signal for the overlay */
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    stockApi.getDetail(symbol).then((res) => { if (!cancelled) setDetail(res.data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [symbol]);

  const dayUp = (detail?.dayChangePct ?? 0) >= 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl border border-slate-700 bg-surface-card shadow-drawer
                   animate-fade-in-up max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-700/70">
          <div className="flex items-baseline gap-3">
            <span className="font-mono font-bold text-lg text-slate-100">{symbol}</span>
            {detail?.currentPrice != null && (
              <span className="font-mono text-sm text-slate-200 tabular-nums">
                {formatCurrency(detail.currentPrice, 0)}
              </span>
            )}
            {detail?.dayChangePct != null && (
              <span className={`text-xs font-mono ${dayUp ? 'text-bull' : 'text-bear'}`}>
                {dayUp ? '▲' : '▼'} {formatPercent(detail.dayChangePct)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { onClose(); navigate(`/stock/${symbol}`); }}
              className="btn-success text-xs"
            >
              Open full page →
            </button>
            <button
              onClick={onClose}
              aria-label="Close preview"
              className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-surface-elevated/60 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Chart with overlays */}
        <div className="p-4">
          <CandlestickChart
            symbol={symbol}
            candles={candles}
            loading={chartLoading}
            height={360}
            supportLevels={detail?.supportLevels}
            resistanceLevels={detail?.resistanceLevels}
            signal={detail?.signal}
            interval={interval}
            onIntervalChange={setIntervalState}
          />
        </div>
      </div>
    </div>
  );
};

ChartPreviewModal.propTypes = {
  symbol: PropTypes.string.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default ChartPreviewModal;
