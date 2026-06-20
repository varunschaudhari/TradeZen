"""
File: indicators.py
Description: Computes all 8 technical indicators using pure pandas — no pandas-ta dependency.
             EMA 20/50/200, RSI 14, MACD 12/26/9, ATR 14, Bollinger %B 20/2,
             Volume ratio vs 20-day avg, candlestick pattern recognition.
Author: SwingTrader AI Team
Created: 2026-06-13
Last Modified: 2026-06-13
"""

import logging
from typing import Optional

import pandas as pd

from app.config import (
    ATR_PERIOD,
    BB_PERIOD,
    BB_STD,
    EMA_LONG,
    EMA_MID,
    EMA_SHORT,
    MACD_FAST,
    MACD_SIGNAL_PERIOD,
    MACD_SLOW,
    RSI_PERIOD,
    VOLUME_AVG_PERIOD,
)
from app.models.schemas import IndicatorData

logger = logging.getLogger(__name__)


def _safe_last(series: Optional[pd.Series], decimals: int = 4) -> Optional[float]:
    """
    Safely extract and round the most recent non-NaN value from a pandas Series.

    Args:
        series: Pandas Series or None
        decimals: Number of decimal places to round to

    Returns:
        Rounded float or None if series is None/empty/all-NaN
    """
    if series is None:
        return None
    try:
        val = series.dropna().iloc[-1]
        return round(float(val), decimals)
    except (IndexError, ValueError, TypeError):
        return None


def _ema(series: pd.Series, period: int) -> pd.Series:
    """
    Exponential Moving Average using pandas ewm (standard finance convention).

    Args:
        series: Price Series
        period: Lookback period

    Returns:
        EMA Series of same length
    """
    return series.ewm(span=period, adjust=False).mean()


def _rsi(series: pd.Series, period: int = RSI_PERIOD) -> pd.Series:
    """
    Relative Strength Index using Wilder's smoothing (EMA-based).

    Args:
        series: Close price Series
        period: RSI period (default 14)

    Returns:
        RSI Series, values in [0, 100]
    """
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, float("nan"))
    return 100 - (100 / (1 + rs))


def _macd(
    series: pd.Series,
    fast: int = MACD_FAST,
    slow: int = MACD_SLOW,
    signal: int = MACD_SIGNAL_PERIOD,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """
    MACD = EMA(fast) - EMA(slow), Signal = EMA(MACD, signal), Hist = MACD - Signal.

    Args:
        series: Close price Series
        fast: Fast EMA period
        slow: Slow EMA period
        signal: Signal line EMA period

    Returns:
        (macd_line, signal_line, histogram) tuple of Series
    """
    ema_fast = _ema(series, fast)
    ema_slow = _ema(series, slow)
    macd_line = ema_fast - ema_slow
    signal_line = _ema(macd_line, signal)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def _atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = ATR_PERIOD) -> pd.Series:
    """
    Average True Range using Wilder's smoothing.

    True Range = max(high-low, |high-prev_close|, |low-prev_close|)

    Args:
        high: High price Series
        low: Low price Series
        close: Close price Series
        period: ATR period (default 14)

    Returns:
        ATR Series
    """
    prev_close = close.shift(1)
    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False).mean()


def _bollinger_bands(
    series: pd.Series, period: int = BB_PERIOD, std_dev: float = BB_STD
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """
    Bollinger Bands: Upper, Lower, and %B (position within bands).

    %B = (price - lower) / (upper - lower), 0 = at lower band, 1 = at upper band.

    Args:
        series: Close price Series
        period: Rolling window period (default 20)
        std_dev: Standard deviation multiplier (default 2.0)

    Returns:
        (upper_band, lower_band, pct_b) tuple of Series
    """
    mid = series.rolling(period).mean()
    std = series.rolling(period).std(ddof=0)
    upper = mid + std_dev * std
    lower = mid - std_dev * std
    band_width = (upper - lower).replace(0, float("nan"))
    pct_b = (series - lower) / band_width
    return upper, lower, pct_b


def _detect_candle_pattern(df: pd.DataFrame) -> str:
    """
    Identify the dominant candlestick pattern on the most recent two bars.

    Patterns checked (priority order):
        DOJI → HAMMER → SHOOTING_STAR →
        BULLISH_ENGULFING → BEARISH_ENGULFING →
        STRONG_BULL → STRONG_BEAR → NONE

    Args:
        df: OHLCV DataFrame with lowercase column names, at least 2 rows

    Returns:
        Pattern name string
    """
    try:
        if len(df) < 2:
            return "NONE"

        cur = df.iloc[-1]
        prev = df.iloc[-2]

        total_range = float(cur["high"]) - float(cur["low"])
        if total_range < 1e-6:
            return "NONE"

        body = abs(float(cur["close"]) - float(cur["open"]))
        body_ratio = body / total_range
        upper_wick = float(cur["high"]) - max(float(cur["open"]), float(cur["close"]))
        lower_wick = min(float(cur["open"]), float(cur["close"])) - float(cur["low"])
        is_bull = float(cur["close"]) > float(cur["open"])

        if body_ratio < 0.10:
            return "DOJI"
        if lower_wick > 2.0 * body and upper_wick < body * 0.5:
            return "HAMMER"
        if upper_wick > 2.0 * body and lower_wick < body * 0.5:
            return "SHOOTING_STAR"

        prev_body = abs(float(prev["close"]) - float(prev["open"]))
        if body > prev_body and prev_body > 0:
            prev_is_bull = float(prev["close"]) > float(prev["open"])
            if is_bull and not prev_is_bull:
                return "BULLISH_ENGULFING"
            if not is_bull and prev_is_bull:
                return "BEARISH_ENGULFING"

        if body_ratio > 0.70:
            return "STRONG_BULL" if is_bull else "STRONG_BEAR"

        return "NONE"

    except Exception as exc:
        logger.debug("Candle pattern detection skipped: %s", exc)
        return "NONE"


def compute_indicators(df: pd.DataFrame) -> Optional[IndicatorData]:
    """
    Compute all 8 technical indicators for a stock's daily OHLCV DataFrame.

    EMA 200 requires at least 200 bars for full accuracy; earlier rows carry NaN.
    The last bar's values are returned. NaN → None in the output model.

    Indicators:
        - EMA 20 / 50 / 200 (trend)
        - RSI 14 (momentum)
        - MACD 12/26/9 (trend momentum)
        - ATR 14 (volatility / stop sizing)
        - Bollinger %B 20/2 (mean reversion signal)
        - Volume ratio vs 20-day average (volume confirmation)
        - Candlestick pattern (bar quality signal)

    Args:
        df: DataFrame with lowercase columns [open, high, low, close, volume]
            and DatetimeIndex, at least MIN_REQUIRED_BARS rows

    Returns:
        Populated IndicatorData Pydantic model, or None if computation fails
    """
    try:
        close = df["close"].astype(float)
        high = df["high"].astype(float)
        low = df["low"].astype(float)
        volume = df["volume"].astype(float)

        # ── EMAs ─────────────────────────────────────────────────────────────
        ema20 = _ema(close, EMA_SHORT)
        ema50 = _ema(close, EMA_MID)
        ema200 = _ema(close, EMA_LONG)

        # ── RSI ──────────────────────────────────────────────────────────────
        rsi = _rsi(close, RSI_PERIOD)

        # ── MACD ─────────────────────────────────────────────────────────────
        macd_line, signal_line, macd_hist = _macd(close, MACD_FAST, MACD_SLOW, MACD_SIGNAL_PERIOD)

        # ── ATR ──────────────────────────────────────────────────────────────
        atr = _atr(high, low, close, ATR_PERIOD)

        # ── Bollinger Bands ───────────────────────────────────────────────────
        bb_upper, bb_lower, bb_pct_b = _bollinger_bands(close, BB_PERIOD, BB_STD)

        # ── Volume ratio ──────────────────────────────────────────────────────
        vol_avg = volume.rolling(VOLUME_AVG_PERIOD).mean()
        vol_ratio = volume / vol_avg

        # ── Candle pattern ────────────────────────────────────────────────────
        candle_pattern = _detect_candle_pattern(df)

        return IndicatorData(
            ema20=_safe_last(ema20),
            ema50=_safe_last(ema50),
            ema200=_safe_last(ema200),
            rsi14=_safe_last(rsi),
            macd=_safe_last(macd_line),
            macdSignal=_safe_last(signal_line),
            macdHist=_safe_last(macd_hist),
            bbUpper=_safe_last(bb_upper),
            bbLower=_safe_last(bb_lower),
            bbPctB=_safe_last(bb_pct_b),
            atr14=_safe_last(atr),
            volRatio=_safe_last(vol_ratio, decimals=2),
            candlePattern=candle_pattern,
        )

    except Exception as exc:
        logger.error("compute_indicators failed: %s", exc, exc_info=True)
        return None
