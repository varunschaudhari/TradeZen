/**
 * @file IntradaySignal.js
 * @description Intraday alert record — the forward-tracking ledger for the intraday
 *   module (ORB, VWAP mean-reversion, momentum continuation; long AND short). One
 *   document per symbol+session+setupType+direction (unique index doubles as the atomic
 *   one-shot claim across overlapping scan cycles — a symbol CAN produce independent
 *   alerts across different setups/directions the same session, just not duplicates of
 *   the same one). Deliberately separate from the swing Signal collection: intraday
 *   alerts are experimental, never feed the swing risk budget, and never become Trade
 *   docs. The settlement job fills exit fields so the win rate is measurable from day one.
 * @author TradeZen Team
 * @created 2026-07-07
 * @lastModified 2026-07-09
 */

import mongoose from 'mongoose';
import { INTRADAY_SETUP_TYPES, TRADE_DIRECTIONS } from '../config/constants.js';

const intradaySignalSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, uppercase: true },
    sessionDate: { type: String, required: true }, // YYYY-MM-DD (IST)
    setupType: { type: String, enum: INTRADAY_SETUP_TYPES, default: 'ORB' },
    direction: {
      type: String,
      enum: Object.values(TRADE_DIRECTIONS),
      default: TRADE_DIRECTIONS.LONG,
    },
    // ORB/VWAP_REVERSION/MOMENTUM_CONTINUATION = scanner-generated; MANUAL = user-logged
    // intraday paper trade. MANUAL docs are excluded from the strategy track records and
    // the go-live gate — discretionary results must never inflate (or dilute) evidence.
    source: {
      type: String,
      enum: ['ORB', 'VWAP_REVERSION', 'MOMENTUM_CONTINUATION', 'MANUAL'],
      default: 'ORB',
      index: true,
    },
    experimental: { type: Boolean, default: true },
    notes: { type: String, default: '' },

    // Setup geometry at trigger time — generic fields used by every strategy:
    breakoutPrice: Number, // entry price (name kept for ORB continuity; = trigger price for all setups)
    vwap: Number,
    relVolume: Number, // time-of-day-adjusted vs prior sessions
    suggestedStop: Number,
    suggestedTarget: Number,

    // ORB-only geometry (null for VWAP_REVERSION / MOMENTUM_CONTINUATION)
    orHigh: Number,
    orLow: Number,
    orWindowMinutes: Number,

    // VWAP_REVERSION-only: the band edge that triggered entry, and the vol measure behind it
    vwapStdDevAtEntry: Number,
    vwapBandAtEntry: Number, // vwap ± (VWAP_REVERSION_ENTRY_BAND_MULT × vwapStdDev) at trigger

    // MOMENTUM_CONTINUATION-only: the trend/pullback reference at trigger
    ema9AtEntry: Number,

    // Market-regime snapshot at trigger time (read from Config.lastMarketHealth — the
    // swing scanner's own cached reading, not a fresh fetch). Pure data capture, doesn't
    // affect triggering — collected so a real, evidence-backed answer to "do ORB/Momentum
    // underperform on narrow-breadth days?" is possible once enough sessions have logged it.
    marketModeAtEntry: String,
    adRatioAtEntry: Number,
    vixAtEntry: Number,

    // Latency measurement: bar close → alert sent (is this actionable or stale?)
    barTime: Date, // open time of the confirming 5m bar
    alertedAt: Date,
    alertLatencyMs: Number,

    // Phase 3 live confirmation: the near-real-time price observed at alert time and
    // which feed served it. Entry stays the bar close (settlement replays bars) —
    // livePrice records how far the market had already moved when the alert fired.
    livePrice: Number,
    quoteSource: { type: String, enum: ['YAHOO_LIVE', 'YFINANCE', null], default: null },

    // Paper position (Phase 2): sized from ORB_PAPER_CAPITAL / ORB_PAPER_RISK_PCT —
    // a virtual container fully separate from the swing capital and trade caps.
    shares: Number,
    capitalDeployed: Number,

    // Paper exit, settled at 15:20 IST by 5m bar replay after the entry bar: first touch
    // of SL or target wins (bar-touch order flips for SHORT vs LONG); SL wins a same-bar
    // tie (conservative); otherwise square-off at the 15:10 bar close.
    exitPrice: Number,
    exitReason: {
      type: String,
      enum: ['STOPLOSS', 'TARGET', 'SQUAREOFF', 'MANUAL', null],
      default: null,
    },
    exitTime: Date,
    rMultiple: Number, // (exit − entry) / (entry − stop) — price-based, gross
    grossPnl: Number, // shares × (exit − entry), before costs
    estCosts: Number, // estimated charges + slippage (tradingCosts.js, INTRADAY mode)
    paperPnl: Number, // NET: grossPnl − estCosts — the number the track record judges
    resultPct: Number, // (exitPrice − breakoutPrice) / breakoutPrice × 100
    eodPrice: Number, // session close (reference only)
    settledAt: Date,
  },
  { timestamps: true, strict: true }
);

// One alert per symbol+session+setupType+direction — the cross-cycle atomic claim. A
// symbol CAN independently trigger, say, an ORB long AND a VWAP-reversion short the same
// session (different theses); it just can't duplicate the exact same one. Partial so
// MANUAL logs are unconstrained (a trader can re-enter the same symbol freely).
intradaySignalSchema.index(
  { symbol: 1, sessionDate: 1, setupType: 1, direction: 1 },
  { unique: true, partialFilterExpression: { source: { $ne: 'MANUAL' } } }
);
intradaySignalSchema.index({ sessionDate: -1 });

export default mongoose.model('IntradaySignal', intradaySignalSchema);
