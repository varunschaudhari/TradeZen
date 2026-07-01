/**
 * @file gates.js
 * @description Gate failure analytics endpoint.
 *
 * GET /api/gates?days=30
 *
 * Aggregates Signal.gateDetails across all documents in the requested window.
 * Per gate: pass count, fail count, fail rate, top 3 failure reasons, and a
 * week-over-week trend comparison (last 7d vs the prior 7d).
 *
 * Runs in-process rather than via MongoDB aggregation pipeline because:
 *   - Typical data volume is low (≤ 5k signals / 30 days for a normal watchlist)
 *   - Reason grouping per gate is trivial in JS, complex in the pipeline
 *   - Trend comparison reuses the same in-memory slice
 */

import express from 'express';
import Signal from '../models/Signal.js';
import { logger } from '../config/logger.js';

const router = express.Router();

const GATE_KEYS = ['gate1', 'gate2', 'gate3', 'gate4', 'gate5', 'gate6', 'gate7', 'gate8'];

/**
 * Compute per-gate stats from a slice of signal documents.
 * @param {object[]} signals - lean Signal docs with gateDetails
 * @returns {Record<string, { passed:number, failed:number, reasons:Record<string,number> }>}
 */
function computeGateStats(signals) {
  const stats = {};
  for (const key of GATE_KEYS) {
    stats[key] = { passed: 0, failed: 0, reasons: {} };
  }

  for (const sig of signals) {
    const d = sig.gateDetails;
    if (!d) continue;
    for (const key of GATE_KEYS) {
      const gd = d[key];
      if (!gd || typeof gd.passed !== 'boolean') continue;
      if (gd.passed) {
        stats[key].passed += 1;
      } else {
        stats[key].failed += 1;
        const r = (gd.reason ?? 'Unknown').trim();
        stats[key].reasons[r] = (stats[key].reasons[r] ?? 0) + 1;
      }
    }
  }

  return stats;
}

/**
 * Convert a reasons map to a sorted top-N array.
 * @param {Record<string,number>} reasons
 * @param {number} n
 */
function topReasons(reasons, n = 3) {
  return Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([reason, count]) => ({ reason, count }));
}

// ── GET /api/gates?days=30 ───────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const now = new Date();
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const week7ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const week14ago = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const signals = await Signal.find({ createdAt: { $gte: from } })
      .select('gateDetails gatesPassed verdict symbol createdAt')
      .lean();

    const total = signals.length;
    const verdicts = { BUY: 0, WAIT: 0, SKIP: 0 };
    for (const s of signals) {
      if (s.verdict in verdicts) verdicts[s.verdict]++;
    }

    /* Full-period stats */
    const full = computeGateStats(signals);

    /* Trend: last 7 days vs the prior 7 days */
    const last7  = signals.filter((s) => new Date(s.createdAt) >= week7ago);
    const prev7  = signals.filter((s) => {
      const t = new Date(s.createdAt);
      return t >= week14ago && t < week7ago;
    });
    const trendLast = computeGateStats(last7);
    const trendPrev = computeGateStats(prev7);

    /* Build gate result array */
    const gates = GATE_KEYS.map((key) => {
      const s = full[key];
      const evaluated = s.passed + s.failed;
      const failRate  = evaluated > 0 ? +(s.failed / evaluated * 100).toFixed(1) : 0;

      /* Trend */
      const tl = trendLast[key];
      const tp = trendPrev[key];
      const tlEval = tl.passed + tl.failed;
      const tpEval = tp.passed + tp.failed;
      const tlRate = tlEval > 0 ? +(tl.failed / tlEval * 100).toFixed(1) : null;
      const tpRate = tpEval > 0 ? +(tp.failed / tpEval * 100).toFixed(1) : null;
      const delta  = tlRate != null && tpRate != null ? +(tlRate - tpRate).toFixed(1) : null;
      const direction =
        delta == null  ? 'UNKNOWN' :
        delta > 3      ? 'WORSE'   :
        delta < -3     ? 'BETTER'  : 'STABLE';

      return {
        id:          key,
        evaluated,
        notEvaluated: total - evaluated,
        passed:      s.passed,
        failed:      s.failed,
        failRate,
        topReasons:  topReasons(s.reasons, 3),
        trend: {
          last7dSignals:  last7.length,
          prev7dSignals:  prev7.length,
          last7dFailRate: tlRate,
          prev7dFailRate: tpRate,
          delta,
          direction,
        },
      };
    });

    /* Top blocked symbols: symbols that appear most often with gate failures */
    const symFailMap = {};
    for (const sig of signals) {
      if (!sig.gateDetails) continue;
      const sym = sig.symbol;
      if (!symFailMap[sym]) symFailMap[sym] = { symbol: sym, failures: 0, gates: {} };
      for (const key of GATE_KEYS) {
        const gd = sig.gateDetails[key];
        if (gd?.passed === false) {
          symFailMap[sym].failures++;
          symFailMap[sym].gates[key] = (symFailMap[sym].gates[key] ?? 0) + 1;
        }
      }
    }
    const topSymbols = Object.values(symFailMap)
      .sort((a, b) => b.failures - a.failures)
      .slice(0, 8);

    res.json({
      success:   true,
      period:    `${days}d`,
      dateRange: { from, to: now },
      totalSignals: total,
      verdicts,
      gates,
      topSymbols,
    });
  } catch (err) {
    logger.error('GET /api/gates failed', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
