/**
 * @file CandlestickChart.jsx
 * @description TradingView lightweight-charts candlestick chart with trading overlays:
 *   support/resistance price lines, the active signal's entry-zone / stop / targets,
 *   client-computed EMA 20/50/200 trend lines, and a volume pane. Includes an interval
 *   toggle (15m / 1D — owned by the parent's data fetch) and a colour legend so the
 *   overlays are self-explanatory. This is the "professional terminal" view.
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-23
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { createChart, LineStyle } from 'lightweight-charts';

const COLORS = {
  up: '#22c55e',
  down: '#ef4444',
  support: '#22c55e',
  resistance: '#ef4444',
  entry: '#3b82f6',
  stop: '#ef4444',
  target: '#10b981',
  ema20: '#eab308',
  ema50: '#60a5fa',
  ema200: '#a78bfa',
};

const CHART_OPTIONS = {
  layout: { background: { color: '#1e293b' }, textColor: '#94a3b8' },
  grid: { vertLines: { color: '#293548' }, horzLines: { color: '#293548' } },
  crosshair: { mode: 1 },
  rightPriceScale: { borderColor: '#475569' },
  timeScale: { borderColor: '#475569', timeVisible: true },
};

/** Exponential moving average over a close array → [{ time, value }] (seeded on first bar). */
function emaPoints(candles, period) {
  if (!candles.length) return [];
  const k = 2 / (period + 1);
  let prev = null;
  const out = [];
  for (const c of candles) {
    if (c.close == null) continue;
    prev = prev == null ? c.close : c.close * k + prev * (1 - k);
    out.push({ time: c.time, value: prev });
  }
  // Drop the warm-up region so the line doesn't render a misleading flat seed.
  return out.slice(Math.min(period, out.length - 1));
}

/* ── Legend chip ──────────────────────────────────────────────────────────── */
const LegendDot = ({ color, label, dashed }) => (
  <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
    <span
      className="inline-block w-3 h-0 border-t-2 rounded"
      style={{ borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }}
    />
    {label}
  </span>
);
LegendDot.propTypes = { color: PropTypes.string, label: PropTypes.string, dashed: PropTypes.bool };

const INTERVALS = [
  { key: '15m', label: '15m' },
  { key: '1d', label: '1D' },
];

const CandlestickChart = ({
  symbol,
  candles,
  height,
  supportLevels,
  resistanceLevels,
  signal,
  interval,
  onIntervalChange,
  loading,
}) => {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volSeriesRef = useRef(null);
  const emaRefs = useRef({});
  const priceLinesRef = useRef([]);
  const [showEmas, setShowEmas] = useState(true);

  /* Stable keys so the price-line effect only re-runs when the levels truly change. */
  const supportKey = useMemo(() => JSON.stringify(supportLevels ?? []), [supportLevels]);
  const resistanceKey = useMemo(() => JSON.stringify(resistanceLevels ?? []), [resistanceLevels]);
  const signalKey = useMemo(
    () =>
      JSON.stringify(
        signal
          ? { e: signal.entryZone, s: signal.stopLoss, t1: signal.target1, t2: signal.target2 }
          : null
      ),
    [signal]
  );

  /* ── Build chart + series once ──────────────────────────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return undefined;

    const chart = createChart(containerRef.current, {
      ...CHART_OPTIONS,
      width: containerRef.current.clientWidth,
      height,
    });
    chartRef.current = chart;

    candleSeriesRef.current = chart.addCandlestickSeries({
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderUpColor: COLORS.up,
      borderDownColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
    });

    volSeriesRef.current = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    const lineOpts = (color) => ({
      color,
      lineWidth: 1.5,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    emaRefs.current = {
      ema20: chart.addLineSeries(lineOpts(COLORS.ema20)),
      ema50: chart.addLineSeries(lineOpts(COLORS.ema50)),
      ema200: chart.addLineSeries(lineOpts(COLORS.ema200)),
    };

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: containerRef.current?.clientWidth });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
      emaRefs.current = {};
      priceLinesRef.current = [];
    };
  }, [height]);

  /* ── Feed data (candles, volume, EMAs) ──────────────────────────────────── */
  useEffect(() => {
    if (!candleSeriesRef.current || !candles.length) return;
    candleSeriesRef.current.setData(candles);
    volSeriesRef.current?.setData(
      candles.map((c) => ({
        time: c.time,
        value: c.volume ?? 0,
        color: (c.close ?? 0) >= (c.open ?? 0) ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)',
      }))
    );
    emaRefs.current.ema20?.setData(emaPoints(candles, 20));
    emaRefs.current.ema50?.setData(emaPoints(candles, 50));
    emaRefs.current.ema200?.setData(emaPoints(candles, 200));
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  /* ── EMA visibility toggle ──────────────────────────────────────────────── */
  useEffect(() => {
    Object.values(emaRefs.current).forEach((s) => s?.applyOptions({ visible: showEmas }));
  }, [showEmas, candles]);

  /* ── Support / resistance / signal price lines ──────────────────────────── */
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    priceLinesRef.current.forEach((pl) => series.removePriceLine(pl));
    priceLinesRef.current = [];

    const add = (price, color, title, style = LineStyle.Dashed, width = 1) => {
      if (price == null || Number.isNaN(price)) return;
      priceLinesRef.current.push(
        series.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: true, title })
      );
    };

    (resistanceLevels ?? []).slice(0, 3).forEach((r, i) => add(r.price, COLORS.resistance, `R${i + 1}`));
    (supportLevels ?? []).slice(0, 3).forEach((s, i) => add(s.price, COLORS.support, `S${i + 1}`));

    if (signal) {
      if (signal.entryZone?.low) add(signal.entryZone.low, COLORS.entry, 'Entry', LineStyle.Solid, 2);
      if (signal.entryZone?.high && signal.entryZone.high !== signal.entryZone.low) {
        add(signal.entryZone.high, COLORS.entry, 'Entry hi');
      }
      add(signal.stopLoss, COLORS.stop, 'Stop', LineStyle.Solid, 2);
      add(signal.target1, COLORS.target, 'T1');
      add(signal.target2, COLORS.target, 'T2');
    }
  }, [supportKey, resistanceKey, signalKey, candles]);

  const hasData = candles.length > 0;

  return (
    <div className="card">
      {/* Header: title + interval toggle + EMA toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold text-slate-200">{symbol}</span>
          <span className="text-xs text-slate-500">{interval === '1d' ? 'Daily' : '15-min'} candles</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowEmas((v) => !v)}
            className={`seg ${showEmas ? 'seg-active' : ''}`}
            title="Toggle EMA 20/50/200"
          >
            EMAs
          </button>
          {onIntervalChange && (
            <div className="seg-group">
              {INTERVALS.map((iv) => (
                <button
                  key={iv.key}
                  onClick={() => onIntervalChange(iv.key)}
                  className={`seg ${interval === iv.key ? 'seg-active' : ''}`}
                >
                  {iv.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3">
        <LegendDot color={COLORS.support} label="Support" dashed />
        <LegendDot color={COLORS.resistance} label="Resistance" dashed />
        {signal && <LegendDot color={COLORS.entry} label="Entry" />}
        {signal && <LegendDot color={COLORS.stop} label="Stop" />}
        {signal && <LegendDot color={COLORS.target} label="Targets" dashed />}
        {showEmas && <LegendDot color={COLORS.ema20} label="EMA20" />}
        {showEmas && <LegendDot color={COLORS.ema50} label="EMA50" />}
        {showEmas && <LegendDot color={COLORS.ema200} label="EMA200" />}
      </div>

      {/* Container is ALWAYS rendered so lightweight-charts can attach on mount;
          loading / empty states are overlaid on top. */}
      <div className="relative" style={{ height }}>
        <div ref={containerRef} style={{ height }} />
        {(loading || !hasData) && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-card/50 text-slate-500 text-sm">
            {loading ? (
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-700 border-t-accent" />
            ) : (
              'No candle data available'
            )}
          </div>
        )}
      </div>
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
      volume: PropTypes.number,
    })
  ),
  height: PropTypes.number,
  supportLevels: PropTypes.arrayOf(PropTypes.shape({ price: PropTypes.number, strength: PropTypes.string })),
  resistanceLevels: PropTypes.arrayOf(PropTypes.shape({ price: PropTypes.number, strength: PropTypes.string })),
  signal: PropTypes.shape({
    entryZone: PropTypes.shape({ low: PropTypes.number, high: PropTypes.number }),
    stopLoss: PropTypes.number,
    target1: PropTypes.number,
    target2: PropTypes.number,
  }),
  interval: PropTypes.string,
  onIntervalChange: PropTypes.func,
  loading: PropTypes.bool,
};

CandlestickChart.defaultProps = {
  candles: [],
  height: 340,
  supportLevels: [],
  resistanceLevels: [],
  signal: null,
  interval: '1d',
  onIntervalChange: null,
  loading: false,
};

export default CandlestickChart;
