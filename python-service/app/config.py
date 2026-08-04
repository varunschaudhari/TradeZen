"""
File: config.py
Description: Environment configuration and named constants for Python microservice.
             All magic numbers live here — nowhere else.
Author: SwingTrader AI Team
Created: 2026-06-13
Last Modified: 2026-06-13
"""

import os

from dotenv import load_dotenv

load_dotenv()

PORT: int = int(os.getenv("PORT", "8001"))
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")

# yfinance download settings
YFINANCE_TIMEOUT: int = 30
OHLCV_PERIOD_DAILY: str = "6mo"
OHLCV_PERIOD_WEEKLY: str = "2y"
OHLCV_INTERVAL_15M: str = "15m"
OHLCV_PERIOD_15M: str = "5d"

# NSE yfinance ticker suffix
NSE_SUFFIX: str = ".NS"

# Staleness guard — skip stock if most recent daily bar is older than N calendar days
STALE_THRESHOLD_DAYS: int = 4

# Minimum bars required before any indicator is computed
MIN_REQUIRED_BARS: int = 50

# Indicator periods
EMA_SHORT: int = 20
EMA_MID: int = 50
EMA_LONG: int = 200
RSI_PERIOD: int = 14
MACD_FAST: int = 12
MACD_SLOW: int = 26
MACD_SIGNAL_PERIOD: int = 9
ATR_PERIOD: int = 14
BB_PERIOD: int = 20
BB_STD: float = 2.0
VOLUME_AVG_PERIOD: int = 20

# Support / resistance detection
SWING_ORDER: int = 5          # argrelextrema half-window
CLUSTER_PCT: float = 0.015    # merge levels within 1.5% of each other
MAX_SR_LEVELS: int = 3        # max levels returned per side

# Market index tickers
NIFTY_TICKER: str = "^NSEI"
BANK_NIFTY_TICKER: str = "^NSEBANK"
VIX_TICKER: str = "^INDIAVIX"
NIFTY_EMA_PERIOD: int = 20

# Advance/Decline ratio — sample from Nifty 50 for proxy computation
AD_RATIO_SAMPLE: list[str] = [
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
    "HINDUNILVR", "ITC", "SBIN", "BHARTIARTL", "KOTAKBANK",
    "LT", "AXISBANK", "ASIANPAINT", "MARUTI", "TITAN",
    "ULTRACEMCO", "BAJFINANCE", "WIPRO", "NESTLEIND", "POWERGRID",
]

# Trade level suggestions
ENTRY_EMA20_BAND_PCT: float = 0.05  # use EMA20 as entry only if within 5% of current price
SL_ATR_MULTIPLIER: float = 1.5   # stop loss = entry - ATR * multiplier
TARGET1_RR: float = 2.0           # target 1 risk:reward ratio
TARGET2_RR: float = 3.0           # target 2 risk:reward ratio
FALLBACK_SL_PCT: float = 0.03     # fallback when ATR unavailable: entry * (1 - 3%)

# Weekly trend classification
WEEKLY_BULLISH: str = "BULLISH"
WEEKLY_BEARISH: str = "BEARISH"
WEEKLY_SIDEWAYS: str = "SIDEWAYS"

# ── Universe screening (Step 2: 350-stock universe → ~45 candidates) ───────────
# yfinance history window for screening — needs > 200 bars for EMA200 trend filter
SCREEN_PERIOD: str = "1y"
SCREEN_BATCH_SIZE: int = 50          # symbols per yfinance multi-download chunk
SCREEN_MIN_BARS: int = 40            # skip a symbol if fewer daily bars than this (relaxed)

# Pre-filter 1 — Liquidity: average daily turnover (close × volume) over lookback
LIQUIDITY_LOOKBACK_DAYS: int = 20
MIN_AVG_TURNOVER_INR: float = 10_000_000.0   # ₹1 crore avg daily turnover floor (relaxed)

# Pre-filter 2 — Market cap: index-tier proxy (constituents carry a tier tag).
# Default allows every tier; callers may restrict (e.g. exclude SMALLCAP).
# EXTENDED (added 2026-08-03): ~3,880 NSE-listed symbols outside the four curated
# index tiers above, scraped from Dhan's stock listing (ticker + sector; no verified
# market-cap/liquidity data). Included in the live scan by explicit choice, accepting
# that most will be filtered out by pre-filter 1 (liquidity) rather than reach a gate.
MARKET_CAP_TIERS: tuple[str, ...] = ("NIFTY50", "NEXT50", "MIDCAP150", "SMALLCAP100", "EXTENDED")

# Pre-filter 3 — Trend: price above EMA50 and EMA50 above EMA200 (stacked uptrend)
# (uses EMA_MID and EMA_LONG defined above)

# Pre-filter 4 — Momentum: RSI band (looser than Gate 4) + positive rate-of-change
SCREEN_RSI_MIN: float = 40.0
SCREEN_RSI_MAX: float = 80.0
ROC_LOOKBACK_DAYS: int = 20
MIN_ROC_PCT: float = 0.0             # close must be >= close N bars ago

# Pre-filter 5 — ATR: volatility as % of price must be tradeable (not dead, not wild)
ATR_PCT_MIN: float = 1.5
ATR_PCT_MAX: float = 8.0

# Pre-filter 6 — Earnings: drop survivors with earnings within buffer (best-effort,
# Gate 3 in Node is authoritative). Bounded to survivors of filters 1–5 to limit
# expensive per-ticker .info calls.
SCREEN_EARNINGS_BUFFER_DAYS: int = 15
