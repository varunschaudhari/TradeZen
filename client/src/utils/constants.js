/**
 * @file constants.js
 * @description Frontend constants — gate names, colors, enums mirroring backend
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

export const VERDICTS = Object.freeze({ BUY: 'BUY', WAIT: 'WAIT', SKIP: 'SKIP' });
export const CONFIDENCE = Object.freeze({ HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' });
export const MARKET_MODES = Object.freeze({ BULL: 'BULL', CAUTION: 'CAUTION', MIXED: 'MIXED', BEAR: 'BEAR' });
export const SENTIMENTS = Object.freeze({ POSITIVE: 'POSITIVE', NEUTRAL: 'NEUTRAL', NEGATIVE: 'NEGATIVE' });

export const GATE_NAMES = Object.freeze({
  gate1: 'Nifty above 20 EMA',
  gate2: 'Stock above weekly 50 EMA',
  gate3: 'No earnings within 15 days',
  gate4: 'RSI between 40–65',
  gate5: 'Volume ≥ 1.5x average',
  gate6: 'Risk:Reward ≥ 2:1',
  gate7: 'Claude confidence HIGH',
  gate8: 'News sentiment not negative',
});

// Plain-language explanation of what each gate protects against (used as hover tooltips).
export const GATE_DESCRIPTIONS = Object.freeze({
  gate1: 'Hard block. The whole market must be in an uptrend — Nifty 50 above its 20-day EMA — or no BUYs are allowed.',
  gate2: 'Hard block. The stock itself must be in a bullish weekly trend (above its weekly 50 EMA).',
  gate3: 'Hard block. No earnings announcement within 15 days — earnings cause unpredictable gaps.',
  gate4: 'Strong filter. RSI in the 40–65 sweet spot: enough momentum, not overbought.',
  gate5: 'Strong filter. Volume at least 1.5× the 20-day average — confirms institutional participation.',
  gate6: 'Hard block. The setup must offer at least 2× reward for the risk taken (R:R ≥ 2:1).',
  gate7: 'Hard block. Claude must return HIGH confidence — MEDIUM/LOW is downgraded to WAIT.',
  gate8: 'Hard block. No negative news environment around the stock.',
});

export const VERDICT_COLORS = Object.freeze({
  BUY: 'text-buy',
  WAIT: 'text-wait',
  SKIP: 'text-skip',
});

export const VERDICT_BG = Object.freeze({
  BUY: 'bg-buy/10 border-buy/30',
  WAIT: 'bg-wait/10 border-wait/30',
  SKIP: 'bg-skip/10 border-skip/30',
});

export const MARKET_MODE_COLORS = Object.freeze({
  BULL: 'text-bull',
  CAUTION: 'text-wait',
  MIXED: 'text-orange-400',
  BEAR: 'text-bear',
});

// Stage a stock dropped out of the scan funnel (ScanResult.stocks[].droppedAtStage)
export const SCAN_STAGE_STYLES = Object.freeze({
  SIGNAL: 'bg-buy/15 text-buy border-buy/30',
  CLAUDE: 'bg-wait/15 text-wait border-wait/30',
  RANKED_OUT: 'bg-slate-700/40 text-slate-300 border-slate-600',
  GATES: 'bg-skip/15 text-skip border-skip/30',
  ANALYZE_CAP: 'bg-slate-700/40 text-slate-400 border-slate-600',
  SCREEN: 'bg-slate-800 text-slate-500 border-slate-700',
});

export const SOCKET_EVENTS = Object.freeze({
  SIGNAL_NEW: 'signal:new',
  SIGNAL_UPDATE: 'signal:update',
  MARKET_UPDATE: 'market:update',
  TRADE_TARGET1: 'trade:target1',
  TRADE_TARGET2: 'trade:target2',
  TRADE_CLOSED: 'trade:closed',
  TRADE_SL_WARNING: 'trade:sl_warning',
  TRADE_EARNINGS: 'trade:earnings',
  MARKET_BEARMODE: 'market:bearmode',
  MARKET_VIXSPIKE: 'market:vixspike',
  SCAN_COMPLETE: 'scan:complete',
  SCAN_PROGRESS: 'scan:progress',
  MONITOR_EVENT: 'monitor:event',
});

export const EXIT_REASONS = Object.freeze({
  TARGET1: 'TARGET1',
  TARGET2: 'TARGET2',
  STOPLOSS: 'STOPLOSS',
  MANUAL: 'MANUAL',
  EARNINGS: 'EARNINGS',
});

// Mirror of server/src/config/constants.js trading limits
export const MAX_OPEN_TRADES          = 3;
export const MAX_CAPITAL_DEPLOYED_PCT = 60;
export const DEFAULT_RISK_PCT         = 1;
