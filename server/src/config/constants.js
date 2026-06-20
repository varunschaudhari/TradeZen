/**
 * @file constants.js
 * @description All application-wide named constants — no magic numbers anywhere else
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

// Market hours IST (UTC+5:30)
export const MARKET_OPEN_HOUR = 9;
export const MARKET_OPEN_MINUTE = 15;
export const MARKET_CLOSE_HOUR = 15;
export const MARKET_CLOSE_MINUTE = 30;

// NSE equity trading holidays — IST calendar days (YYYY-MM-DD), the scanner skips these.
// ⚠️ Compiled best-effort and MUST be verified yearly against the official NSE holiday
// circular (nseindia.com). Fixed-date entries are reliable; festival/lunar dates marked
// "(verify)" can shift — correct them from the circular. Weekend holidays are omitted
// (weekends are already skipped). A wrong/missing entry only skips or wastes a scan —
// it never places or affects a trade.
export const NSE_HOLIDAYS = new Set([
  '2026-01-26', // Republic Day
  '2026-03-04', // Holi (verify)
  '2026-03-25', // Ram Navami (verify)
  '2026-04-01', // Mahavir Jayanti (verify)
  '2026-04-03', // Good Friday
  '2026-04-14', // Dr. Ambedkar Jayanti
  '2026-05-01', // Maharashtra Day
  '2026-05-27', // Bakri Id / Eid al-Adha (verify)
  '2026-08-15', // Independence Day (Saturday — already closed)
  '2026-10-02', // Gandhi Jayanti
  '2026-10-20', // Dussehra / Vijaya Dashami (verify)
  '2026-11-10', // Diwali Balipratipada (verify)
  '2026-11-24', // Guru Nanak Jayanti (verify)
  '2026-12-25', // Christmas
]);

// Gate thresholds
export const RSI_MIN = 40;
export const RSI_MAX = 65;
export const VOLUME_RATIO_MIN = 1.5;
export const RISK_REWARD_MIN = 2.0;
export const EARNINGS_BUFFER_DAYS = 15;
export const GATES_REQUIRED_FOR_CLAUDE = 5;
export const SL_WARNING_PCT = 2;

// Capital protection rules (enforced in code)
export const MAX_OPEN_TRADES = 3;
export const MAX_CAPITAL_DEPLOYED_PCT = 60;
export const DEFAULT_RISK_PCT = 1;
export const DAILY_LOSS_PAUSE_PCT = 3;
export const DEDUPLICATION_HOURS = 4;

// Claude API cost control
export const CLAUDE_MAX_TOKENS = 1500;
export const DAILY_CLAUDE_COST_ALERT_INR = 50;
export const CLAUDE_TEMPERATURE = 0; // deterministic — same data → same verdict
export const CLAUDE_RATE_LIMIT_WAIT_MS = 60_000; // wait on HTTP 429 before retrying
export const SETUP_TYPES = Object.freeze([
  'MOMENTUM_BREAKOUT',
  'PULLBACK_TO_SUPPORT',
  'MEAN_REVERSION',
  'PEAD',
  'VOLUME_ANOMALY',
  'SECTOR_ROTATION',
  'OTHER',
]);

// Gate logic — richer spec (Flow 3 — gateChecker.js)
export const RSI_MEAN_REVERSION = 38; // Gate 4 mean-reversion RSI ceiling
export const BB_MEAN_REVERSION = 0.15; // Gate 4 mean-reversion Bollinger %B ceiling
export const RS_GATE2_MIN = 0.8; // Gate 2 relative-strength floor (when available)
export const EARNINGS_WARNING_DAYS = 20; // 15–20 days → warn Claude (not a block)
export const VOLUME_ANOMALY_THRESHOLD = 2.5; // 3-day cumulative volume vs 3× 20-day avg

// Auto-negative news keywords — instant Gate 8 SKIP regardless of sentiment score
export const NEGATIVE_NEWS_KEYWORDS = Object.freeze([
  'sebi notice',
  'sebi probe',
  'sebi investigation',
  'sebi penalty',
  'promoter selling',
  'promoter pledged',
  'promoter stake reduced',
  'analyst downgrade',
  'target cut',
  'sell rating',
  'reduce rating',
  'results miss',
  'below estimates',
  'profit decline',
  'revenue miss',
  'contract cancelled',
  'order cancelled',
  'client lost',
  'fraud',
  'scam',
  'corporate governance',
  'accounting irregularities',
  'md resigned',
  'ceo resigned',
  'cfo resigned',
  'npa increased',
  'bad loans',
  'write-off',
]);

// Composite score (Simons-style) — base + signal adjustments → confidence band
export const COMPOSITE_BASE_SCORE = 40;
export const SCORE_HIGH_CONFIDENCE = 70;
export const SCORE_MEDIUM_CONFIDENCE = 50;
export const RS_LEADER = 1.2; // relative strength "strong leader" threshold
export const PROXIMITY_52W_HIGH_PCT = 5; // within 5% of 52-week high
export const PC_RATIO_FEAR = 1.3; // Put/Call ratio fear (contrarian bullish)
export const BB_OVERBOUGHT = 0.85; // Bollinger %B overbought-within-band
export const SENTIMENT_STRONG_POSITIVE = 5; // sentiment score above this = strong positive
export const BULLISH_CANDLE_PATTERNS = Object.freeze([
  'HAMMER',
  'BULLISH_ENGULFING',
  'STRONG_BULL',
  'MORNING_STAR',
]);
export const COMPOSITE_POINTS = Object.freeze({
  VOLUME_ANOMALY: 10,
  RS_LEADER: 8,
  FII_BUYING: 8,
  PROMOTER_INCREASE: 7,
  PEAD: 7,
  TOP_SECTOR: 6,
  STRONG_SENTIMENT: 5,
  PC_FEAR: 5,
  NEAR_52W_HIGH: 4,
  BULLISH_CANDLE: 3,
  MACD_RISING: 2,
  FII_SELLING: -10,
  PROMOTER_DECREASE: -8,
  BOTTOM_SECTOR: -6,
  NIFTY_DOWN_STREAK: -5,
  BB_OVERBOUGHT: -3,
});

// Simons signal thresholds (Flow 5 — simonsSignals.js)
export const ATR_PCT_MEAN_REVERSION_MIN = 2; // signal 1: enough daily range to profit
export const MOMENTUM_6M_STRONG = 20;
export const MOMENTUM_6M_GOOD = 10;
export const MOMENTUM_6M_MIN = 5;
export const RS_STRONG_LEADER = 1.3;
export const RS_INLINE = 1.0;
export const RS_LAGGARD = 0.8;
export const VOLUME_ANOMALY_MODERATE = 1.8;
export const VOLUME_ANOMALY_ELEVATED = 1.3;
export const PROXIMITY_52W_MOMENTUM_PCT = 3; // signal 5: within 3% of 52W high
export const RSI_52W_MOMENTUM_MIN = 50;
export const RSI_52W_MOMENTUM_MAX = 65;
export const PEAD_BEAT_PCT = 15;
export const PEAD_LOOKBACK_DAYS = 10;
export const PC_RATIO_GREED = 0.8;
export const GAP_MIN_PCT = 1; // ignore gaps smaller than this
export const GAP_PROXIMITY_PCT = 15; // only track gaps within 15% of price
export const LOOKBACK_6M = 180;
export const LOOKBACK_3M = 90;
export const LOOKBACK_1M = 30;
export const LOOKBACK_RS_SHORT = 20;
export const LOOKBACK_RS_LONG = 60;
export const SIMONS_POINTS = Object.freeze({
  MEAN_REVERSION_STRONG: 8,
  MEAN_REVERSION_MODERATE: 4,
  MOMENTUM_STRONG: 8,
  MOMENTUM_GOOD: 5,
  MOMENTUM_OK: 3,
  MOMENTUM_NEG: -5,
  RS_STRONG_LEADER: 8,
  RS_LEADER: 4,
  RS_LAGGARD: -6,
  VOL_HIGH: 10,
  VOL_MODERATE: 5,
  VOL_ELEVATED: 2,
  FIFTYTWO_W: 4,
  PEAD: 7,
  SECTOR_TOP: 6,
  SECTOR_BOTTOM: -6,
  FII_BUYING: 8,
  FII_SELLING: -10,
  PC_FEAR: 5,
  PC_ELEVATED: 2,
  PC_GREED: -3,
});

// News fetcher (Flow 6 — newsFetcher.js)
export const NEWS_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4-hour per-symbol cache
export const NEWS_CACHE_TTL_SECONDS = 4 * 60 * 60; // MongoDB TTL index
export const NEWS_MAX_HEADLINES = 10; // cap after merge + dedup
export const NEWS_SOURCE_TIMEOUT_MS = 8000; // per-source fetch timeout
export const NEWS_AUTO_NEGATIVE_SCORE = -10; // score assigned on auto-negative block
export const NEWS_SENTIMENT_POSITIVE_MIN = 5; // Claude-scale: score > 5 → POSITIVE
export const NEWS_SENTIMENT_NEGATIVE_MAX = -1; // Claude-scale: score < -1 → NEGATIVE
// Claude-based sentiment scoring is opt-in: news is fetched for every candidate, so a
// per-stock Claude call would break the "Claude only when 5+ gates pass" cost model.
export const NEWS_USE_CLAUDE_SENTIMENT =
  (process.env.NEWS_USE_CLAUDE_SENTIMENT ?? 'false') === 'true';

// Market health thresholds (Flow 1 — marketHealthService.js)
export const VIX_SAFE = 15; // BULL requires VIX below this
export const VIX_CAUTION = 20; // BEAR if VIX above this; CAUTION between SAFE..CAUTION
export const AD_RATIO_BULL = 0.9; // BULL requires A/D above this
export const AD_RATIO_BEAR = 0.7; // BEAR if A/D below this; CAUTION between BEAR..BULL
export const EMA20_CAUTION_BAND_PCT = 1; // Nifty within ±1% of 20 EMA → CAUTION
export const MARKET_HEALTH_STALE_MIN = 30; // cached health older than this → block trading
export const CAUTION_POSITION_SIZE_FACTOR = 0.5; // halve position sizes in CAUTION mode
export const MIXED_POSITION_SIZE_FACTOR = 0.7; // narrow rally: reduce position sizes by 30%

// Universe screening (Step 2) — narrow the static NSE universe to candidates
// before the per-stock analyze + gate + Claude pipeline.
// SCREEN_TIERS = null → all tiers (Nifty50 + Next50 + Midcap150 + Smallcap100).
export const SCREEN_ENABLED = (process.env.SCREEN_ENABLED ?? 'true') !== 'false';
export const SCREEN_TIERS = null;
export const MAX_CANDIDATES_TO_ANALYZE = 45; // cap survivors sent to the heavy pipeline

// Stock discovery (Flow 2 — stockDiscovery.js)
export const MAX_CLAUDE_CALLS_PER_SCAN = 15; // stage-8 cap: candidates sent to Claude
export const DISCOVERY_CONCURRENCY = 6; // parallel per-candidate enrich+gate workers
// Parallel Claude+save workers in the scan pipeline. NOTE: throughput is ultimately
// capped by your Anthropic tier's output-tokens/min limit (~1,050 tok per signal). On a
// 4,000 tok/min tier, concurrency >2 just triggers 429s + 60s backoffs — set to 1 for the
// smoothest pacing, or raise once on a higher tier. Env-tunable.
export const SCAN_CLAUDE_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.SCAN_CLAUDE_CONCURRENCY ?? '2', 10)
);
export const SCAN_RESULT_TTL_SECONDS = 14 * 24 * 60 * 60; // keep scan snapshots 14 days

// Trade tracking (Flow 9 — tradeTracker.js)
export const EARNINGS_EXIT_REMINDER_DAYS = 5; // remind to exit N days before earnings
export const SL_WARNING_THROTTLE_MS = 60 * 60 * 1000; // at most one SL warning per hour

// Performance engine (Flow 10 — performanceEngine.js)
export const DEFAULT_CAPITAL = 1_000_000; // ₹10 lakh baseline
export const SIGNAL_DECAY_WINRATE = 0.48; // flag a setup/signal below 48% win rate
export const SIGNAL_DECAY_MIN_SAMPLES = 5; // minimum trades before decay is meaningful
export const GO_LIVE_MIN_WINRATE = 0.5; // paper win rate needed before going live
export const GO_LIVE_MIN_WEEKS = 3; // minimum paper-trading weeks before go-live

// Enums
export const MARKET_MODES = Object.freeze({
  BULL: 'BULL',
  CAUTION: 'CAUTION',
  MIXED: 'MIXED',
  BEAR: 'BEAR',
});
export const VERDICTS = Object.freeze({ BUY: 'BUY', WAIT: 'WAIT', SKIP: 'SKIP' });
export const CONFIDENCE_LEVELS = Object.freeze({ HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' });
export const TRADE_STATUSES = Object.freeze({ OPEN: 'OPEN', CLOSED: 'CLOSED', EXPIRED: 'EXPIRED' });
export const EXIT_REASONS = Object.freeze({
  TARGET1: 'TARGET1',
  TARGET2: 'TARGET2',
  STOPLOSS: 'STOPLOSS',
  MANUAL: 'MANUAL',
  EARNINGS: 'EARNINGS',
});
export const SENTIMENTS = Object.freeze({
  POSITIVE: 'POSITIVE',
  NEUTRAL: 'NEUTRAL',
  NEGATIVE: 'NEGATIVE',
});
export const WEEKLY_TRENDS = Object.freeze({
  BULLISH: 'BULLISH',
  BEARISH: 'BEARISH',
  SIDEWAYS: 'SIDEWAYS',
});

export const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:3000';
export const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? 'http://localhost:8001';
export const SERVER_VERSION = '1.0.0';
