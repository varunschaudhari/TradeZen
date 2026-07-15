/**
 * @file scanState.js
 * @description In-memory live scan state + a bounded ring buffer of recent monitor
 *   events (the "alerts feed"). The scan engines (marketScanner / scanPipeline) call
 *   the mutators below as a scan progresses; every mutation pushes a SCAN_PROGRESS
 *   socket event so the Monitor page updates in real time. State is intentionally
 *   process-local (single-node deployment) and resets on restart.
 * @author TradeZen Team
 * @created 2026-06-27
 */

import { logger } from '../config/logger.js';
import { emitGlobal, SOCKET_EVENTS } from '../socket/socketHandlers.js';

const MAX_EVENTS = 50; // ring-buffer size for the alerts feed

// Live progress for the scan currently running (or the last one that finished).
const state = {
  status: 'idle', // 'idle' | 'running' | 'complete' | 'error'
  phase: null, // 'market' | 'discovery' | 'analysis' | 'claude' | 'monitor' | 'done'
  note: null, // human-readable status line for the current phase
  scanType: null, // 'LIVE' | 'EOD_PREP' | 'MANUAL'
  startedAt: null, // ms epoch
  finishedAt: null, // ms epoch
  total: 0, // items to process in the current phase
  processed: 0, // items processed so far in the current phase
  currentSymbol: null, // symbol being processed right now
  signalsFound: 0,
  buySignals: 0,
  errors: 0,
  marketMode: null,
  durationMs: null,
};

// Bounded list of recent events, newest first. Each: { id, type, severity, message, symbol?, at }.
const events = [];
let eventSeq = 0;

// ── Internal helpers ──────────────────────────────────────────────────────────

function snapshot() {
  const elapsedMs = state.startedAt
    ? (state.finishedAt ?? Date.now()) - state.startedAt
    : 0;
  const pct =
    state.total > 0 ? Math.min(100, Math.round((state.processed / state.total) * 100)) : 0;
  // Linear ETA from average time-per-item; null until we have at least one item done.
  let etaMs = null;
  if (state.status === 'running' && state.processed > 0 && state.total > state.processed) {
    const perItem = elapsedMs / state.processed;
    etaMs = Math.round(perItem * (state.total - state.processed));
  }
  return { ...state, elapsedMs, pct, etaMs };
}

function push() {
  emitGlobal(SOCKET_EVENTS.SCAN_PROGRESS, snapshot());
}

/**
 * Record an event into the ring buffer and broadcast it.
 * @param {string} type - 'scan' | 'signal' | 'error' | 'data' | 'scanner'
 * @param {string} severity - 'info' | 'success' | 'warn' | 'error'
 * @param {string} message - Human-readable line
 * @param {object} [extra] - Optional { symbol }
 */
export function recordEvent(type, severity, message, extra = {}) {
  eventSeq += 1;
  const evt = {
    id: eventSeq,
    type,
    severity,
    message,
    symbol: extra.symbol ?? null,
    at: new Date().toISOString(),
  };
  events.unshift(evt);
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  emitGlobal(SOCKET_EVENTS.MONITOR_EVENT, evt);
  return evt;
}

// ── Public mutators (called by the scan engines) ───────────────────────────────

/**
 * Mark a scan as started; resets per-run counters.
 * @param {object} [opts] - { scanType, total }
 */
export function startScan({ scanType = 'LIVE', total = 0 } = {}) {
  state.status = 'running';
  state.phase = 'market';
  state.note = null;
  state.scanType = scanType;
  state.startedAt = Date.now();
  state.finishedAt = null;
  state.total = total;
  state.processed = 0;
  state.currentSymbol = null;
  state.signalsFound = 0;
  state.buySignals = 0;
  state.errors = 0;
  state.marketMode = null;
  state.durationMs = null;
  recordEvent('scan', 'info', `${scanType} scan started`);
  push();
}

/** Set the current phase label and optional status note. */
export function setPhase(phase, marketMode = null, note = null) {
  state.phase = phase;
  if (marketMode) state.marketMode = marketMode;
  state.note = note;
  push();
}

/**
 * Begin a counted phase: set the phase, its item total, and reset the processed
 * counter so the progress bar starts fresh for this stage.
 */
export function beginPhase(phase, total, note = null) {
  state.phase = phase;
  state.total = total;
  state.processed = 0;
  state.currentSymbol = null;
  state.note = note;
  push();
}

/** Set the total number of candidates entering the analysis phase. */
export function setTotal(total) {
  state.total = total;
  state.phase = 'analysis';
  push();
}

/** Advance the processed counter; optionally name the symbol just handled. */
export function tick(symbol = null) {
  state.processed += 1;
  state.currentSymbol = symbol;
  push();
}

/** Record that a signal was saved this run. */
export function recordSignal(verdict, symbol) {
  state.signalsFound += 1;
  if (verdict === 'BUY') {
    state.buySignals += 1;
    recordEvent('signal', 'success', `New BUY signal: ${symbol}`, { symbol });
  }
  push();
}

/** Record an analysis error for a symbol. */
export function recordError(symbol, message) {
  state.errors += 1;
  recordEvent('error', 'error', `Scan error${symbol ? ` (${symbol})` : ''}: ${message}`, { symbol });
  push();
}

/**
 * Mark the scan finished.
 * @param {object} [opts] - { signalsFound, buySignals, errors, durationMs, marketMode }
 */
export function endScan(opts = {}) {
  state.status = opts.error ? 'error' : 'complete';
  state.phase = 'done';
  state.finishedAt = Date.now();
  if (opts.signalsFound != null) state.signalsFound = opts.signalsFound;
  if (opts.buySignals != null) state.buySignals = opts.buySignals;
  if (opts.errors != null) state.errors = opts.errors;
  if (opts.marketMode) state.marketMode = opts.marketMode;
  state.durationMs = opts.durationMs ?? (state.startedAt ? state.finishedAt - state.startedAt : null);
  state.currentSymbol = null;
  const secs = state.durationMs ? (state.durationMs / 1000).toFixed(0) : '?';
  if (opts.error) {
    recordEvent('scan', 'error', `Scan failed: ${opts.error}`);
  } else {
    recordEvent(
      'scan',
      'success',
      `Scan complete — ${state.signalsFound} signals (${state.buySignals} BUY) in ${secs}s`
    );
  }
  push();
}

// ── Public readers (called by the monitor route) ───────────────────────────────

/** Current progress snapshot (computed fields included). */
export function getScanState() {
  return snapshot();
}

/** Recent events, newest first. */
export function getRecentEvents(limit = MAX_EVENTS) {
  return events.slice(0, limit);
}

/** Seed an event from elsewhere in the app (e.g. data-staleness warnings). */
export function emitMonitorEvent(type, severity, message, extra) {
  try {
    return recordEvent(type, severity, message, extra);
  } catch (err) {
    logger.error('emitMonitorEvent failed', { error: err.message });
    return null;
  }
}
