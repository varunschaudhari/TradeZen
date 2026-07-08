/**
 * @file goLiveGate.js
 * @description The go-live gate: hard, evidence-based PASS/FAIL per lane (swing /
 *   intraday) computed from the ACTUAL accumulated paper record — so the "am I ready
 *   to trade real money" decision is made by numbers, not mood. Every check judges
 *   NET results (after estimated charges + slippage); older closed trades that predate
 *   the cost fields are netted on the fly.
 *
 *   Thresholds are deliberately strict: passing this gate does not guarantee profits —
 *   it certifies that the paper evidence is at least consistent with a real,
 *   cost-surviving edge. Failing it means the market would probably have taken this
 *   tuition in cash.
 *
 * @author TradeZen Team
 * @created 2026-07-07
 */

import Config from '../models/Config.js';
import IntradaySignal from '../models/IntradaySignal.js';
import Trade from '../models/Trade.js';
import { TRADE_STATUSES } from '../config/constants.js';
import { netAfterCosts } from './tradingCosts.js';

const round2 = (n) => Math.round(n * 100) / 100;

// Gate thresholds — change only with a written reason; loosening a gate to pass it
// defeats its entire purpose.
export const GATE_THRESHOLDS = Object.freeze({
  MIN_SAMPLE: 30, // settled results before any stat is trusted
  MIN_PROFIT_FACTOR: 1.3, // net gross-wins / net gross-losses
  MIN_NET_EXPECTANCY_INR: 0, // mean net P&L per trade must be positive
  MAX_DRAWDOWN_PCT_OF_CAPITAL: 10, // peak-to-trough of cumulative net P&L
  MIN_SPAN_DAYS: 42, // ≥ 6 weeks — one hot fortnight is not evidence
  MAX_AVG_ALERT_LATENCY_SEC: 90, // intraday lane only: alerts must be actionable
});

/**
 * Compute the shared evidence checks from a list of net per-trade results (pure).
 *
 * @param {Array<{ net:number, at:Date }>} results - Settled results, any order
 * @param {number} capital - Reference capital for drawdown %
 * @returns {object} { sample, spanDays, netExpectancy, profitFactor, maxDrawdownPct, totalNet }
 */
export function computeEvidenceStats(results, capital) {
  const ordered = [...results].sort((a, b) => new Date(a.at) - new Date(b.at));
  const sample = ordered.length;
  const totalNet = ordered.reduce((s, r) => s + r.net, 0);
  const wins = ordered.filter((r) => r.net > 0).reduce((s, r) => s + r.net, 0);
  const losses = Math.abs(ordered.filter((r) => r.net <= 0).reduce((s, r) => s + r.net, 0));
  const spanDays = sample >= 2
    ? Math.round((new Date(ordered[sample - 1].at) - new Date(ordered[0].at)) / 86_400_000)
    : 0;

  let peak = 0;
  let cum = 0;
  let maxDd = 0;
  for (const r of ordered) {
    cum += r.net;
    peak = Math.max(peak, cum);
    maxDd = Math.max(maxDd, peak - cum);
  }

  return {
    sample,
    spanDays,
    netExpectancy: sample ? round2(totalNet / sample) : null,
    profitFactor: losses > 0 ? round2(wins / losses) : wins > 0 ? Infinity : null,
    maxDrawdownPct: capital > 0 ? round2((maxDd / capital) * 100) : null,
    totalNet: round2(totalNet),
  };
}

const check = (key, label, actual, required, pass) => ({ key, label, actual, required, pass });

function evidenceChecks(stats) {
  const T = GATE_THRESHOLDS;
  return [
    check('sample', 'Settled results', stats.sample, `≥ ${T.MIN_SAMPLE}`, stats.sample >= T.MIN_SAMPLE),
    check('span', 'Track-record span (days)', stats.spanDays, `≥ ${T.MIN_SPAN_DAYS}`, stats.spanDays >= T.MIN_SPAN_DAYS),
    check(
      'expectancy', 'Net expectancy per trade (₹)', stats.netExpectancy,
      `> ${T.MIN_NET_EXPECTANCY_INR}`,
      stats.netExpectancy != null && stats.netExpectancy > T.MIN_NET_EXPECTANCY_INR
    ),
    check(
      'profitFactor', 'Profit factor (net)',
      stats.profitFactor === Infinity ? '∞' : stats.profitFactor,
      `≥ ${T.MIN_PROFIT_FACTOR}`,
      stats.profitFactor != null && stats.profitFactor >= T.MIN_PROFIT_FACTOR
    ),
    check(
      'drawdown', 'Max drawdown (% of capital)', stats.maxDrawdownPct,
      `≤ ${T.MAX_DRAWDOWN_PCT_OF_CAPITAL}`,
      stats.maxDrawdownPct != null && stats.maxDrawdownPct <= T.MAX_DRAWDOWN_PCT_OF_CAPITAL
    ),
  ];
}

/**
 * Evaluate both lanes against the gate. Never throws — DB errors surface as a
 * zero-evidence gate (all checks failing), which is the safe answer.
 *
 * @returns {Promise<{ swing:object, intraday:object, thresholds:object }>}
 */
export const evaluateGoLiveGate = async () => {
  const config = await Config.findOne().lean().catch(() => null);
  const capital = config?.capital ?? 1_000_000;

  // ── Swing lane: closed trades, netted (on the fly for docs predating netPnl) ──
  const closed = await Trade.find({ status: TRADE_STATUSES.CLOSED })
    .select('entryPrice exitPrice shares realizedPnl netPnl exitDate createdAt')
    .lean()
    .catch(() => []);
  const swingResults = closed
    .filter((t) => t.exitPrice != null && t.realizedPnl != null)
    .map((t) => ({
      net:
        t.netPnl ??
        netAfterCosts(t.realizedPnl, t.entryPrice, t.exitPrice, t.shares, 'DELIVERY').netPnl,
      at: t.exitDate ?? t.createdAt,
    }));
  const swingStats = computeEvidenceStats(swingResults, capital);
  const swingChecks = evidenceChecks(swingStats);

  // ── Intraday lane: settled ORB paper trades (paperPnl is already net) + latency ──
  // Scanner evidence only: MANUAL (discretionary) intraday logs are a different
  // strategy and must not inflate or dilute the ORB go-live case.
  const settled = await IntradaySignal.find({
    exitReason: { $ne: null },
    source: { $ne: 'MANUAL' },
  })
    .select('paperPnl settledAt alertLatencyMs sessionDate')
    .lean()
    .catch(() => []);
  const intradayResults = settled.map((s) => ({
    net: s.paperPnl ?? 0,
    at: s.settledAt ?? s.sessionDate,
  }));
  // Intraday paper capital is the ORB virtual container, but drawdown vs the same
  // reference capital keeps the two lanes comparable on one scale.
  const intradayStats = computeEvidenceStats(intradayResults, capital);
  const latencies = settled.filter((s) => s.alertLatencyMs != null);
  const avgLatencySec = latencies.length
    ? Math.round(latencies.reduce((s, x) => s + x.alertLatencyMs, 0) / latencies.length / 1000)
    : null;
  const intradayChecks = [
    ...evidenceChecks(intradayStats),
    check(
      'latency', 'Avg alert latency (sec)', avgLatencySec,
      `≤ ${GATE_THRESHOLDS.MAX_AVG_ALERT_LATENCY_SEC}`,
      avgLatencySec != null && avgLatencySec <= GATE_THRESHOLDS.MAX_AVG_ALERT_LATENCY_SEC
    ),
  ];

  return {
    swing: {
      pass: swingChecks.every((c) => c.pass),
      checks: swingChecks,
      stats: swingStats,
    },
    intraday: {
      pass: intradayChecks.every((c) => c.pass),
      checks: intradayChecks,
      stats: { ...intradayStats, avgLatencySec },
    },
    thresholds: GATE_THRESHOLDS,
  };
};
