/**
 * @file constants.js
 * @description Frontend constants — gate names, colors, enums mirroring backend
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

export const VERDICTS = Object.freeze({ BUY: 'BUY', WAIT: 'WAIT', SKIP: 'SKIP' });
export const CONFIDENCE = Object.freeze({ HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' });
export const MARKET_MODES = Object.freeze({ BULL: 'BULL', CAUTION: 'CAUTION', BEAR: 'BEAR' });
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
  BEAR: 'text-bear',
});

export const SOCKET_EVENTS = Object.freeze({
  SIGNAL_NEW: 'signal:new',
  SIGNAL_UPDATE: 'signal:update',
  MARKET_UPDATE: 'market:update',
  TRADE_TARGET1: 'trade:target1',
  TRADE_TARGET2: 'trade:target2',
  TRADE_SL_WARNING: 'trade:sl_warning',
  TRADE_EARNINGS: 'trade:earnings',
  MARKET_BEARMODE: 'market:bearmode',
  MARKET_VIXSPIKE: 'market:vixspike',
  SCAN_COMPLETE: 'scan:complete',
});

export const EXIT_REASONS = Object.freeze({
  TARGET1: 'TARGET1',
  TARGET2: 'TARGET2',
  STOPLOSS: 'STOPLOSS',
  MANUAL: 'MANUAL',
  EARNINGS: 'EARNINGS',
});
