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
// Exit management — enforced on Claude's FINAL levels (Claude's own riskReward arithmetic
// is unreliable: ~30% of live signals stored an inflated R:R vs their saved levels).
// T1_MIN_R: a BUY whose target1 is closer than 1.5× risk gets downgraded to WAIT.
// ATR trail: after T1, the stop ratchets to hwm − ATR_TRAIL_MULT × ATR(14) (never below
// entry). With ATR_TRAIL_REPLACES_T2 the runner is exited by the trail, not a fixed T2 —
// fat right tails are where swing expectancy lives. Trades without atr14 keep the legacy
// behavior (trail to entry at T1, hard T2 close).
export const T1_MIN_R = 1.5;
export const ATR_TRAIL_ENABLED = true;
export const ATR_TRAIL_MULT = 2.75;
export const ATR_TRAIL_REPLACES_T2 = true;
export const EARNINGS_BUFFER_DAYS = 15;
// Minimum pre-verdict gates before a candidate reaches the deterministic verdict engine.
// (Name kept from the Claude era — this was the "5+ gates before a Claude call" bar, and
// shouldCallClaude/reachedClaude field names persist in stored ScanResult docs.)
export const GATES_REQUIRED_FOR_CLAUDE = 5;
export const SIMONS_OVERRIDE_THRESHOLD = 80; // Simons score ≥ 80 allows soft-gate override
export const SL_WARNING_PCT = 2;

// Capital protection rules (enforced in code)
// NOTE: raised to a 25-stock diversified book (was 15 positions / 3 before that / 1%
// risk originally). At DEFAULT_RISK_PCT=0.4%, 25 concurrent positions ≈ 10% total
// portfolio risk if every one stops out simultaneously (worst case; positions aren't
// perfectly correlated in practice) — up from 6% at the 15-slot cap. In practice the
// 95% capital cap binds first at typical position sizing (~15–16 positions before
// MAX_CAPITAL_DEPLOYED_PCT is reached, per the ₹61k average deployed/trade observed
// 2026-07-15) — 25 slots removes the count as the artificial bottleneck and lets
// capital/sector caps do the real gatekeeping instead.
export const MAX_OPEN_TRADES = 25;
export const MAX_CAPITAL_DEPLOYED_PCT = 95;
export const DEFAULT_RISK_PCT = 0.4;
export const DAILY_LOSS_PAUSE_PCT = 3;
export const DEDUPLICATION_HOURS = 4;

// Portfolio-level guards — the gates score one stock at a time and can't see
// concentration (the book once sat 59% in financials). Checked when a BUY is saved
// AND re-checked at auto-open. Sector caps use CAPITAL as the denominator: a
// %-of-deployed rule misfires on a small book (the first position is always 100%).
export const MAX_POSITIONS_PER_SECTOR = 3;
export const MAX_SECTOR_DEPLOYED_PCT = 25;
// Regime-tiered deployment ceiling (takes the MIN with MAX_CAPITAL_DEPLOYED_PCT).
// 95% deployed in a CAUTION tape turns a 3% index dip into a full-book drawdown —
// capacity should shrink as the regime degrades, not just per-trade size.
export const DEPLOYMENT_CAP_BY_MODE = Object.freeze({
  BULL: 80,
  MIXED: 65,
  CAUTION: 50,
  BEAR: 20,
});

// Claude API cost control
// (Retired 2026-07-13: CLAUDE_MAX_TOKENS / DAILY_CLAUDE_COST_ALERT_INR /
// CLAUDE_TEMPERATURE / CLAUDE_RATE_LIMIT_WAIT_MS — the Claude verdict engine was
// replaced by the deterministic verdictEngine.js. The Ask-Claude chat widget was
// removed 2026-07-20. Claude remains only in Haiku headline sentiment (newsFetcher).)
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
// Claude-based sentiment scoring is ON by default (set NEWS_USE_CLAUDE_SENTIMENT=false
// to fall back to keyword counting). It runs on Haiku (CLAUDE_SENTIMENT_MODEL), not the
// main Sonnet model, and results are cached 4h per symbol — so the "Claude only when
// 5+ gates pass" cost model for the expensive analysis calls is preserved.
export const NEWS_USE_CLAUDE_SENTIMENT =
  (process.env.NEWS_USE_CLAUDE_SENTIMENT ?? 'true') === 'true';

// NSE earnings calendar feed (Gate 3 input — earningsCalendar.js)
export const NSE_EARNINGS_TIMEOUT_MS = 10_000; // per-request timeout (handshake + calendar)
export const NSE_EARNINGS_FRESH_DAYS = 7; // NSE date older than this → fall back to yfinance

// Live quotes (Phase 3 — liveQuotes.js / quoteService.js). Near-real-time NSE LTP via
// Yahoo's v8 chart API (measured lag 2–6s; NSE's own quote APIs are bot-blocked, and no
// broker account is needed). Circuit-breaks to the yfinance path on repeat failures.
export const LIVE_QUOTES_ENABLED = (process.env.LIVE_QUOTES_ENABLED ?? 'true') === 'true';
export const LIVE_QUOTES_TIMEOUT_MS = 6_000; // per-quote request timeout
export const LIVE_QUOTES_CACHE_MS = 15_000; // per-symbol LTP cache
export const LIVE_QUOTES_FAILURE_THRESHOLD = 3; // consecutive failures → open breaker
export const LIVE_QUOTES_FAILURE_BACKOFF_MS = 5 * 60_000; // breaker-open duration
export const LIVE_QUOTES_MAX_SYMBOLS = 40; // per-cycle fetch cap (rate-limit safety)
export const LIVE_QUOTES_CONCURRENCY = 4; // parallel quote fetches per cycle

// Intraday entry-zone watcher (JOB 13 — entryWatcher.js). Alerts when an active BUY
// signal's live price trades inside its entry zone; timing aid only, never an order.
export const ENTRY_WATCH_INTERVAL_MINUTES = 5; // poll cadence during market hours
export const ENTRY_WATCH_MAX_SIGNALS = 25; // cap on signals quoted per cycle

// Intraday ORB scanner (Phase 1 intraday module — orbScanner.js). Opening-range
// breakout on the EOD-prep shortlist only. Rules-only (no Claude per signal); alerts
// are tagged EXPERIMENTAL and paper-tracked in IntradaySignal from day one.
export const ORB_SCANNER_ENABLED = (process.env.ORB_SCANNER_ENABLED ?? 'true') === 'true';
export const ORB_WINDOW_MINUTES = 60; // opening range = 9:15–10:15 IST
export const ORB_SCAN_START_MINUTES = 10 * 60 + 15; // evaluate only after the OR completes
export const ORB_SCAN_END_MINUTES = 14 * 60; // no fresh ORB alerts after 14:00 IST
export const ORB_REL_VOLUME_MIN = 1.5; // time-adjusted relative volume gate
export const ORB_BREAKOUT_BUFFER_PCT = 0.1; // close must clear OR high by this % (noise filter)
export const ORB_MAX_SYMBOLS = 15; // shortlist cap per session
// Live-quote pre-screen: skip the heavy 5m-snapshot fetch for symbols whose live price
// sits below OR high by more than this % (they can't produce a surviving alert). The
// tolerance keeps symbols within quote-jitter range of a breakout on the full check.
export const ORB_PRESCREEN_TOLERANCE_PCT = 0.15;

// ORB paper-trade container (Phase 2). Completely separate from the swing risk budget:
// virtual capital, its own (smaller) risk %, and a hard 15:15 IST square-off. Exits are
// settled by 5m bar replay (SL / target / square-off — whichever the bars hit first).
export const ORB_PAPER_CAPITAL = 100_000; // virtual capital for paper position sizing
export const ORB_PAPER_RISK_PCT = 0.5; // % of paper capital risked per signal
export const ORB_SQUAREOFF_MINUTES = 15 * 60 + 10; // exit at the 15:10 IST bar's close (≤ 15:15)
export const ORB_SETTLE_LOOKBACK_DAYS = 5; // settle missed sessions while 5m bars still exist

// ── Intraday module v2 — 3 strategies × 2 directions, own universe (2026-07-09) ──────
// Universe (intradayUniverse.js): liquid large-cap / F&O-proxy stocks ONLY, ranked by
// INTRADAY suitability (volatility × liquidity) — not the swing composite score. A
// trend-quality stock can be intraday-dead, and vice versa; reusing the swing EOD-prep
// shortlist (the original v1 design) was the root cause of two straight losing ORB
// signals. Reuses the existing cheap /screen pass — atrPct/avgTurnoverInr are already
// computed there — so this costs nothing beyond the swing EOD-prep call already made daily.
export const INTRADAY_UNIVERSE_TIERS = Object.freeze(['NIFTY50', 'NEXT50']);
export const INTRADAY_MAX_SYMBOLS = 15; // shortlist cap per session, shared by all 3 strategies
export const INTRADAY_MIN_TURNOVER_INR = 50_000_000; // ₹5 crore/day — stricter than swing's ₹1cr floor
export const INTRADAY_MIN_ATR_PCT = 1.0; // below this, moves are too small to clear round-trip costs

// Per-signal target viability floor: INTRADAY_MIN_ATR_PCT screens the universe on a
// symbol's own historical ATR%, but VWAP_REVERSION's target rides that session's live
// vwapStdDev and MOMENTUM_CONTINUATION's target is a fixed % of price (see below) — either
// can land under the real round-trip cost (brokerage+STT+exchange+SEBI+stamp+GST+slippage,
// tradingCosts.js) on a quiet session, turning a strategy "win" into a net loss after
// costs (observed live: BAJFINANCE/M&M/INDIGO all hit TARGET on 2026-07-14, all net
// negative). Enforced in orbScanner.js: if the strategy's own target doesn't clear
// estimated round-trip cost% by this multiple, the target is widened (stop is untouched)
// before the signal is saved.
export const INTRADAY_TARGET_COST_SAFETY_MULT = 2.5;

// Risk-side twin of the target floor above: REJECT any setup whose stop distance can't
// carry the friction. Round-trip cost scales with DEPLOYED value while gross R scales
// with the stop distance, so a tight stop → big position → cost can exceed 1R itself
// (observed 2026-07-15: seven ~0.15%-stop setups — every −1R loser netted ≈ −2.6R, and
// full-target wins netted only ≈ +0.5R; breakeven win rate ≈ 85–90%, unplayable).
// Requiring stop distance ≥ this multiple of round-trip cost% caps the cost drag at
// ~1/3 R. Reject, never adjust: widening a stop changes the setup's thesis, and
// shrinking size doesn't help (cost and gross R shrink together — the ratio is fixed).
export const INTRADAY_MIN_RISK_TO_COST_RATIO = 3;

// Direction + strategy identifiers, shared across all three setups below.
export const TRADE_DIRECTIONS = Object.freeze({ LONG: 'LONG', SHORT: 'SHORT' });
export const INTRADAY_SETUP_TYPES = Object.freeze([
  'ORB',
  'VWAP_REVERSION',
  'MOMENTUM_CONTINUATION',
  'MANUAL',
]);

// VWAP mean-reversion: fades an overextension back toward the session VWAP — the
// opposite thesis to ORB (which rides a breakout AWAY from a reference level). Needs
// vwapStdDev from the Python intraday snapshot (python-service/app/services/intraday.py).
export const VWAP_REVERSION_ENTRY_BAND_MULT = 2.0; // trigger when price clears vwap ± this × vwapStdDev
export const VWAP_REVERSION_STOP_BAND_MULT = 3.0; // stop beyond the entry band (further extension)
export const VWAP_REVERSION_TARGET_BUFFER_PCT = 0.1; // target sits just short of vwap itself

// Momentum continuation: buys/sells a shallow pullback to EMA(9) within an established
// intraday trend, triggering on the first bar that resumes the trend direction. No
// natural "measured move" like ORB's opening-range height, so the target is R-based.
export const MOMENTUM_EMA_PERIOD = 9; // must match EMA_PERIOD in python-service/intraday.py
export const MOMENTUM_MIN_TREND_PCT = 0.3; // min |price − ema9| / ema9 to call it "trending", not chop
export const MOMENTUM_PULLBACK_MAX_PCT = 0.5; // pullback bar must stay within this % of ema9
export const MOMENTUM_STOP_BUFFER_PCT = 0.15; // floor only now — see MOMENTUM_STOP_VOL_MULT
// Stop scales with the session's own realized volatility (day range so far ÷ bars
// elapsed, as % of price) instead of the flat MOMENTUM_STOP_BUFFER_PCT alone — a flat
// 0.15% stopped out ~77% of trades regardless of entry quality (backtest, 22 trades,
// 2026-07-09→07-15: win rate 22.7%, net -₹6,799). ×3 recovered win rate to ~36% and
// net to -₹2,775 in the same sample (still net-negative, but a real improvement — see
// MOMENTUM_STOP_BUFFER_PCT's new role as a floor so the stop never gets tighter than
// before, only wider when volatility warrants it). Idea adapted from Bhandari &
// Chakravorty (2019) "An Intraday Trend-Following Trading Strategy on Equity
// Derivatives in India" — historical-volatility-based stop vs. a flat distance.
export const MOMENTUM_STOP_VOL_MULT = 3;
export const MOMENTUM_TARGET_R_MULT = 1.8; // target = entry ± this × (entry − stop)

// Discipline ledger (disciplineLedger.js) — records every trade the system blocked and
// marks it to market later, so the value of the NOs is a measured number, both ways.
export const LEDGER_EVAL_AFTER_DAYS = 7; // mark-to-market horizon (≈ 5 trading days)
export const LEDGER_FLAT_BAND_PCT = 0.25; // |fwd return| below this → FLAT, not PROTECTED/COST

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
// Raised 45→90 (2026-07-13): the analyze cap ranks screened survivors by 20-day ROC
// and only sends the top N deeper — with ~133 typically surviving screening, 45 let
// ~88 through-screen candidates never reach a gate check at all purely on cap size,
// not quality (ROUTE — real setup, gates 6/7, score 53 — missed the ROC-rank cut this
// way). 90 covers ~2/3 of a typical screen instead of ~1/3; each extra 6 candidates
// costs one more DISCOVERY_CONCURRENCY round in the analyze stage, so scan duration
// should roughly track the candidate-count ratio (est. ~8-10min vs the prior ~4-5.5min),
// still comfortably under the 15min SCAN_INTERVAL_MINUTES cadence. Revisit the ranking
// key itself (pure 20-day ROC favors sustained trends over fresh breakouts) if this
// alone doesn't catch enough of them.
export const MAX_CANDIDATES_TO_ANALYZE = 90; // cap survivors sent to the heavy pipeline

// EOD prep scan (post-close next-session watchlist build — no Claude, no signals)
export const EOD_PREP_MAX_CANDIDATES = 12; // top gate-qualified candidates kept for the watchlist

// Stock discovery (Flow 2 — stockDiscovery.js)
// Raised 15→100 (2026-07-13): this ranks gate-passed candidates by composite score and
// only forwards the top N to the verdict engine — it existed to cap expensive Claude
// Sonnet calls, but verdictEngine.js (since the same date) is a free, deterministic JS
// function, so that cost no longer exists. 100 is a safety ceiling, not a working limit —
// it sits above MAX_CANDIDATES_TO_ANALYZE (90), so under the current analyze cap this
// never actually binds; keep it above that value if the analyze cap is raised further.
export const MAX_CLAUDE_CALLS_PER_SCAN = 100; // stage-8 cap: candidates sent to the verdict engine
export const DISCOVERY_CONCURRENCY = 6; // parallel per-candidate enrich+gate workers
// Parallel verdict+save workers in the scan pipeline. Raised 2→8 (2026-07-13): this used
// to throttle for Anthropic per-minute token limits (429s on a 4,000 tok/min tier) — moot
// now that this stage is a pure JS function + one Signal save per candidate, no external
// API call at all. 8 matches roughly what MongoDB comfortably takes for concurrent simple
// writes; raise further if scan duration is still dominated by this stage. Env-tunable.
export const SCAN_CLAUDE_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.SCAN_CLAUDE_CONCURRENCY ?? '8', 10)
);
export const SCAN_RESULT_TTL_SECONDS = 14 * 24 * 60 * 60; // keep scan snapshots 14 days

// Backtesting (Flow — backtestEngine.js)
export const BACKTEST_CONCURRENCY = 6; // parallel per-symbol workers — mirrors DISCOVERY_CONCURRENCY
export const BACKTEST_PERIOD = '2y'; // history window pulled per symbol
export const BACKTEST_WARMUP_BARS = 200; // skip until EMA200 + RS lookbacks are valid
export const BACKTEST_HOLD_DAYS = 10; // fixed-mode: max bars held before a time-based exit
export const BACKTEST_SL_ATR_MULT = 1.5; // fallback stop = entry − ATR×mult — mirrors python-service SL_ATR_MULTIPLIER
export const BACKTEST_ENTRY_EMA20_BAND = 0.05; // use EMA20 as entry if within 5% of price — mirrors ENTRY_EMA20_BAND_PCT
export const BACKTEST_FALLBACK_SL_PCT = 0.03; // last-resort stop when no support/ATR — mirrors FALLBACK_SL_PCT
export const BACKTEST_TARGET1_RR = 2; // mirrors python-service TARGET1_RR
export const BACKTEST_TARGET2_RR = 3; // mirrors python-service TARGET2_RR

// Swing-low support detection for the backtest's stop-loss choice — a JS port of
// python-service find_support_resistance()'s support side (scipy argrelextrema local
// minima + proximity clustering), so the backtest picks stops the same way live
// signals do instead of a naive "lowest low in N bars". Mirrors SWING_ORDER,
// CLUSTER_PCT, MAX_SR_LEVELS, and OHLCV_PERIOD_DAILY='6mo' (~126 trading days) in
// python-service/app/config.py exactly — keep these two files in sync if either changes.
export const BACKTEST_SR_SWING_ORDER = 5; // bars required strictly-lower on each side to count as a swing low
export const BACKTEST_SR_CLUSTER_PCT = 0.015; // merge swing lows within 1.5% of each other
export const BACKTEST_SR_MAX_LEVELS = 3; // keep only the top-3 by strength/proximity, like live
export const BACKTEST_SR_LOOKBACK_BARS = 126; // ~6 months of trading days — mirrors live's rolling OHLCV window

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
// Go-live readiness thresholds live in goLiveGate.js's GATE_THRESHOLDS (sample size,
// span, profit factor, drawdown) — the real evidence-based gate, not these.

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
  TIME_EXIT: 'TIME_EXIT', // MAX_PAPER_HOLD_DAYS backstop closed it, not the user
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

export const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:3001';
export const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? 'http://localhost:8001';
export const SERVER_VERSION = '1.0.0';
