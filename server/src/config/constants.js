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
export const NSE_HOLIDAY_LIST = [
  { date: '2026-01-26', name: 'Republic Day' },
  { date: '2026-03-04', name: 'Holi' },
  { date: '2026-03-25', name: 'Ram Navami' },
  { date: '2026-04-01', name: 'Mahavir Jayanti' },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-04-14', name: 'Dr. Ambedkar Jayanti' },
  { date: '2026-05-01', name: 'Maharashtra Day' },
  { date: '2026-05-27', name: 'Eid al-Adha' },
  { date: '2026-10-02', name: 'Gandhi Jayanti' },
  { date: '2026-10-20', name: 'Dussehra' },
  { date: '2026-11-10', name: 'Diwali Balipratipada' },
  { date: '2026-11-24', name: 'Guru Nanak Jayanti' },
  { date: '2026-12-25', name: 'Christmas' },
];
export const NSE_HOLIDAYS = new Set(NSE_HOLIDAY_LIST.map((h) => h.date));

// Gate thresholds
export const RSI_MIN = 40;
// 70 (was 65): 65–70 in a confirmed uptrend is strong momentum, not froth. RSI_MAX drives
// the Gate-4 sweet spot, the +10 composite bonus, the 52w-high bonus, AND the overbought
// penalty — so a momentum name at RSI 66 was triple-penalized. >70 still counts as overbought
// (the backtest shows genuine overbought dilutes returns), so the froth guard is preserved.
export const RSI_MAX = 70;
// 1.0 (was 1.5): the backtest found volume confirmation has INVERTED edge (low-volume entries
// outperformed — see COMPOSITE_POINTS note). Demanding a 1.5× spike suppressed ~89% of
// candidates for no measured benefit. 1.0 keeps an "at least average participation" liquidity
// floor (the screener already enforces turnover) without filtering out the better low-vol setups.
export const VOLUME_RATIO_MIN = 1.0;
export const RISK_REWARD_MIN = 2.0;
export const EARNINGS_BUFFER_DAYS = 15;
export const GATES_REQUIRED_FOR_CLAUDE = 5;
export const SIMONS_OVERRIDE_THRESHOLD = 80; // Simons score ≥ 80 allows soft-gate override
export const SL_WARNING_PCT = 2;

// Capital protection rules (enforced in code)
// NOTE: raised to a 15-stock diversified book (was 3 positions / 60% cap / 1% risk).
// Risk-per-trade dropped to 0.4% so 15 concurrent positions ≈ 6% total portfolio risk if
// all stop out, and the 95% cap leaves room for ~12–15 modest positions.
export const MAX_OPEN_TRADES = 15;
export const MAX_CAPITAL_DEPLOYED_PCT = 95;
export const DEFAULT_RISK_PCT = 0.4;
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
// Calibrated to where measured edge concentrates (re-backtest 2026-06): the 60–69 bucket
// carries +0.20–0.35R vs ~+0.06R base, so HIGH=60 (was 70, which was unreachable from
// price signals alone — max ≈ 62 = base 40 + RSI-sweet 10 + RS-strong 8 + 52W 4).
export const SCORE_HIGH_CONFIDENCE = 60;
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
// Calibrated to MEASURED per-signal edge (signal-edge backtest, 2y/40-symbol, n≥30).
// Price-derived signals carry the weight here because they're the only ones that fire
// historically; the external signals (FII/PEAD/promoter/sector/sentiment/PCR/candle/MACD)
// remain scored so they contribute the day real data is wired — but the BUY threshold is
// calibrated to what price signals alone can reach (see SCORE_HIGH_CONFIDENCE).
export const COMPOSITE_POINTS = Object.freeze({
  // ── Measured price-signal edge (drive the score today) ──
  RSI_SWEET_SPOT: 10, // +0.17R lift — strongest measured signal (was only a gate, unscored)
  RS_STRONG_LEADER: 8, // +0.12R lift — TOP RS tier only (rs ≥ 1.3); plain leaders were dilutive
  NEAR_52W_HIGH: 4, // only when paired with a healthy (non-overbought) RSI — raw proximity was dilutive
  // ── External signals (fire only once their data feeds are wired) ──
  FII_BUYING: 8,
  PROMOTER_INCREASE: 7,
  PEAD: 7,
  TOP_SECTOR: 6,
  STRONG_SENTIMENT: 5,
  PC_FEAR: 5,
  BULLISH_CANDLE: 3,
  MACD_RISING: 2,
  // ── Penalties (measured-dilutive conditions) ──
  RSI_OVERBOUGHT: -8, // −0.17R lift — buying overbought hurt
  BB_OVERBOUGHT: -8, // −0.20R lift — the most dilutive condition (was −3)
  FII_SELLING: -10,
  PROMOTER_DECREASE: -8,
  BOTTOM_SECTOR: -6,
  NIFTY_DOWN_STREAK: -5,
  // NOTE: VOLUME_ANOMALY reward removed — measured edge was INVERTED (low-volume entries
  // outperformed). Volume still gates entry (Gate 5); it just no longer boosts the score.
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

// EOD prep scan (post-close next-session watchlist build — no Claude, no signals)
export const EOD_PREP_MAX_CANDIDATES = 12; // top gate-qualified candidates kept for the watchlist

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

// Backtesting (Flow — backtestEngine.js)
export const BACKTEST_PERIOD = '2y'; // history window pulled per symbol
export const BACKTEST_WARMUP_BARS = 200; // skip until EMA200 + RS lookbacks are valid
export const BACKTEST_HOLD_DAYS = 10; // fixed-mode: max bars held before a time-based exit
export const BACKTEST_SL_ATR_MULT = 1.5; // fallback stop = entry − ATR×mult
export const BACKTEST_ENTRY_EMA20_BAND = 0.05; // use EMA20 as entry if within 5% of price

// ATR-adaptive hold window (Flow — backtestEngine.js, holdMode='adaptive'|'linear')
// Sizes the time-stop to each trade's velocity instead of a flat 10 bars.
//   linear   : days = (targetMove% / atr%) × buffer        (clean-trend assumption)
//   adaptive : days = (targetMove% / atr%)²                (random-walk/diffusion; longer)
// targetMove% is the distance to T2 for that trade (R-based, so it varies per trade).
export const BACKTEST_HOLD_MIN_DAYS = 3; // never time-stop sooner than this
export const BACKTEST_HOLD_MAX_DAYS = 30; // never hold a swing longer than this
export const BACKTEST_HOLD_BUFFER = 1.4; // linear-mode choppiness buffer (1.3–1.5×)

// Transaction-cost model (NSE delivery). costInR = round-trip% ÷ (risk as % of price), so
// tighter stops correctly cost more per trade. Slippage is ATR-scaled — volatility is the
// liquidity proxy, so higher-ATR (mid/small-cap) names are charged more without a tier lookup.
export const BACKTEST_COST_STATUTORY_PCT = 0.12; // STT+exchange+stamp+GST, per side, % of notional
export const BACKTEST_SLIPPAGE_ATR_MULT = 0.05; // slippage per side = this × ATR%
export const BACKTEST_SLIPPAGE_MIN_PCT = 0.03; // per-side slippage floor (%)
export const BACKTEST_SLIPPAGE_MAX_PCT = 0.4; // per-side slippage cap (%)

// Trade tracking (Flow 9 — tradeTracker.js)
export const EARNINGS_EXIT_REMINDER_DAYS = 5; // remind to exit N days before earnings
export const SL_WARNING_THROTTLE_MS = 60 * 60 * 1000; // at most one SL warning per hour
// Auto paper trades close at the current price after this many calendar days if neither
// target nor stop was hit (~15 trading days), so the paper record resolves for calibration.
export const MAX_PAPER_HOLD_DAYS = 21;

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
export const FII_TRENDS = Object.freeze({
  BUYING: 'BUYING',
  SELLING: 'SELLING',
  NEUTRAL: 'NEUTRAL',
});
export const WEEKLY_TRENDS = Object.freeze({
  BULLISH: 'BULLISH',
  BEARISH: 'BEARISH',
  SIDEWAYS: 'SIDEWAYS',
});

export const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:3000';
export const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? 'http://localhost:8001';
export const SERVER_VERSION = '1.0.0';
