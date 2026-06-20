/**
 * @file CandlestickChart.jsx
 * @description TradingView lightweight-charts candlestick widget for a stock symbol
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { createChart } from 'lightweight-charts';

const CHART_OPTIONS = {
  layout: {
    background: { color: '#1e293b' },
    textColor: '#94a3b8',
  },
  grid: {
    vertLines: { color: '#334155' },
    horzLines: { color: '#334155' },
  },
  crosshair: { mode: 1 },
  rightPriceScale: { borderColor: '#475569' },
  timeScale: { borderColor: '#475569', timeVisible: true },
};

/**
 * Renders a TradingView lightweight-charts candlestick chart for a given symbol.
 * Candle data must be pre-fetched by the parent and passed as `candles` prop.
 *
 * @param {object} props
 * @param {string} props.symbol - NSE symbol for display
 * @param {object[]} props.candles - Array of { time, open, high, low, close } objects
 * @param {number} [props.height=280] - Chart height in pixels
 */
const CandlestickChart = ({ symbol, candles, height }) => {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    chartRef.current = createChart(containerRef.current, {
      ...CHART_OPTIONS,
      width: containerRef.current.clientWidth,
      height,
    });

    seriesRef.current = chartRef.current.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    const resizeObserver = new ResizeObserver(() => {
      chartRef.current?.applyOptions({ width: containerRef.current?.clientWidth });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chartRef.current?.remove();
    };
  }, [height]);

  useEffect(() => {
    if (seriesRef.current && candles.length > 0) {
      seriesRef.current.setData(candles);
      chartRef.current?.timeScale().fitContent();
    }
  }, [candles]);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono font-semibold text-slate-200">{symbol}</span>
        <span className="text-xs text-slate-500">15-min candles</span>
      </div>
      {candles.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
          No candle data available
        </div>
      ) : (
        <div ref={containerRef} style={{ height }} />
      )}
    </div>
  );
};

CandlestickChart.propTypes = {
  symbol: PropTypes.string.isRequired,
  candles: PropTypes.arrayOf(
    PropTypes.shape({
      time: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      open: PropTypes.number,
      high: PropTypes.number,
      low: PropTypes.number,
      close: PropTypes.number,
    })
  ),
  height: PropTypes.number,
};

CandlestickChart.defaultProps = { candles: [], height: 280 };

export default CandlestickChart;
