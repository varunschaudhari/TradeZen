/**
 * @file IntradaySignal.js
 * @description Intraday ORB alert record — the forward-tracking ledger for the Phase 1
 *   intraday module. One document per symbol per session (unique index doubles as the
 *   atomic one-shot claim across overlapping scan cycles). Deliberately separate from
 *   the swing Signal collection: intraday alerts are experimental, never feed the
 *   swing risk budget, and never become Trade docs. The EOD stamp job fills eodPrice /
 *   resultPct so the win rate is measurable from day one.
 * @author TradeZen Team
 * @created 2026-07-07
 */

import mongoose from 'mongoose';

const intradaySignalSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, uppercase: true },
    sessionDate: { type: String, required: true }, // YYYY-MM-DD (IST)
    setupType: { type: String, default: 'ORB' },
    // ORB = scanner-generated alert; MANUAL = user-logged intraday paper trade.
    // MANUAL docs are excluded from the ORB track record and the go-live gate —
    // discretionary results must never inflate (or dilute) the scanner's evidence.
    source: { type: String, enum: ['ORB', 'MANUAL'], default: 'ORB', index: true },
    experimental: { type: Boolean, default: true },
    notes: { type: String, default: '' },

    // Setup geometry at trigger time
    orHigh: Number,
    orLow: Number,
    orWindowMinutes: Number,
    breakoutPrice: Number, // last 5m close that confirmed the breakout
    vwap: Number,
    relVolume: Number, // time-of-day-adjusted vs prior sessions
    suggestedStop: Number, // OR low
    suggestedTarget: Number, // measured move: OR high + OR height

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

    // Paper exit, settled at 15:20 IST by 5m bar replay after the breakout bar:
    // first touch of SL (OR low) or target (measured move) wins; SL wins a same-bar
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

// One ORB alert per symbol per session — the cross-cycle atomic claim. Partial so
// MANUAL logs are unconstrained (a trader can re-enter the same symbol in a session).
intradaySignalSchema.index(
  { symbol: 1, sessionDate: 1 },
  { unique: true, partialFilterExpression: { source: 'ORB' } }
);
intradaySignalSchema.index({ sessionDate: -1 });

export default mongoose.model('IntradaySignal', intradaySignalSchema);
