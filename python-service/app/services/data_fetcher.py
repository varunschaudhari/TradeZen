"""
File: data_fetcher.py
Description: yfinance OHLCV downloader with staleness validation, column normalization,
             ticker metadata fetcher, and batch close-price downloader for A/D ratio
Author: SwingTrader AI Team
Created: 2026-06-13
Last Modified: 2026-06-13
"""

import logging
from datetime import datetime, timedelta
from typing import Optional

import pandas as pd
import yfinance as yf

from app.config import (
    MIN_REQUIRED_BARS,
    NSE_SUFFIX,
    OHLCV_PERIOD_DAILY,
    OHLCV_PERIOD_WEEKLY,
    STALE_THRESHOLD_DAYS,
    YFINANCE_TIMEOUT,
)

logger = logging.getLogger(__name__)


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """
    Flatten MultiIndex columns produced by yfinance batch downloads and lowercase all names.

    Args:
        df: Raw DataFrame from yf.download()

    Returns:
        DataFrame with simple lowercase string column names
    """
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df.columns = [str(c).lower().strip() for c in df.columns]
    return df


def _is_stale(df: pd.DataFrame) -> bool:
    """
    Return True when the most recent bar is older than STALE_THRESHOLD_DAYS.
    Only meaningful for daily data; intraday staleness is not checked here.

    Args:
        df: Normalized OHLCV DataFrame with DatetimeIndex

    Returns:
        True if data is considered stale
    """
    if df.empty:
        return True
    last_ts = df.index[-1]
    last_date = last_ts.date() if hasattr(last_ts, "date") else last_ts
    cutoff = (datetime.utcnow() - timedelta(days=STALE_THRESHOLD_DAYS)).date()
    return last_date < cutoff


def fetch_ohlcv(
    symbol: str,
    period: str = OHLCV_PERIOD_DAILY,
    interval: str = "1d",
) -> Optional[pd.DataFrame]:
    """
    Download OHLCV data for a single NSE symbol via yfinance.

    Uses auto_adjust=True for split/dividend-adjusted closes.
    Validates minimum bar count and staleness on daily data.

    Args:
        symbol: NSE symbol without suffix (e.g. 'RELIANCE')
        period: yfinance period string (e.g. '6mo', '2y', '5d')
        interval: yfinance interval string (e.g. '1d', '1wk', '15m')

    Returns:
        Normalized DataFrame with columns [open, high, low, close, volume],
        or None if data is unavailable, insufficient, or stale
    """
    ticker = f"{symbol}{NSE_SUFFIX}"
    logger.debug("Fetching %s | period=%s interval=%s", ticker, period, interval)

    try:
        df = yf.download(
            ticker,
            period=period,
            interval=interval,
            progress=False,
            auto_adjust=True,
            threads=False,
            timeout=YFINANCE_TIMEOUT,
        )
    except Exception as exc:
        logger.error("yfinance download failed for %s: %s", ticker, exc)
        return None

    if df is None or df.empty:
        logger.warning("Empty data returned for %s", ticker)
        return None

    df = _normalize_columns(df)

    required_cols = {"open", "high", "low", "close", "volume"}
    if not required_cols.issubset(set(df.columns)):
        logger.warning("Missing OHLCV columns for %s. Got: %s", ticker, list(df.columns))
        return None

    if len(df) < MIN_REQUIRED_BARS:
        logger.warning(
            "Insufficient bars for %s: got %d, need %d", ticker, len(df), MIN_REQUIRED_BARS
        )
        return None

    if interval == "1d" and _is_stale(df):
        logger.warning(
            "Stale daily data for %s (last bar > %d days ago)", ticker, STALE_THRESHOLD_DAYS
        )
        return None

    return df


def fetch_weekly_ohlcv(symbol: str) -> Optional[pd.DataFrame]:
    """
    Fetch weekly OHLCV data for Gate 2 weekly trend check (price vs. weekly EMA 50).

    Args:
        symbol: NSE symbol without suffix

    Returns:
        Weekly OHLCV DataFrame or None
    """
    return fetch_ohlcv(symbol, period=OHLCV_PERIOD_WEEKLY, interval="1wk")


def fetch_ticker_info(symbol: str) -> dict:
    """
    Fetch fundamental metadata: market cap, beta, 52-week range, earnings date,
    and current price using yfinance Ticker.info.

    Args:
        symbol: NSE symbol without suffix

    Returns:
        Dict with keys: market_cap, beta, high_52w, low_52w,
        earnings_timestamp, prev_close, current_price.
        Returns empty dict on any failure.
    """
    ticker = f"{symbol}{NSE_SUFFIX}"
    try:
        info = yf.Ticker(ticker).info
        return {
            "market_cap": info.get("marketCap"),
            "beta": info.get("beta"),
            "high_52w": info.get("fiftyTwoWeekHigh"),
            "low_52w": info.get("fiftyTwoWeekLow"),
            "earnings_timestamp": info.get("earningsTimestamp"),
            "prev_close": info.get("previousClose"),
            "current_price": info.get("currentPrice") or info.get("regularMarketPrice"),
            # Fundamentals — surfaced on the stock detail page
            "trailing_pe": info.get("trailingPE"),
            "forward_pe": info.get("forwardPE"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "company_name": info.get("longName") or info.get("shortName"),
            "dividend_yield": info.get("dividendYield"),
        }
    except Exception as exc:
        logger.error("fetch_ticker_info failed for %s: %s", ticker, exc)
        return {}


def batch_fetch_latest_close(symbols: list[str]) -> dict[str, Optional[tuple[float, float]]]:
    """
    Fetch the latest and previous closing prices for multiple symbols in one call.
    Used by market_data.py to compute the NSE advance/decline ratio.

    Args:
        symbols: List of NSE symbols without suffix

    Returns:
        Dict mapping symbol -> (latest_close, prev_close) tuple, or None per symbol on failure
    """
    tickers = [f"{s}{NSE_SUFFIX}" for s in symbols]
    try:
        raw = yf.download(
            tickers,
            period="5d",
            interval="1d",
            progress=False,
            auto_adjust=True,
            threads=True,
            timeout=YFINANCE_TIMEOUT,
        )
        if raw is None or raw.empty:
            return {}

        close_df = raw["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw

        result: dict[str, Optional[tuple[float, float]]] = {}
        for sym, ticker in zip(symbols, tickers):
            try:
                col = ticker if ticker in close_df.columns else sym
                series = close_df[col].dropna()
                if len(series) >= 2:
                    result[sym] = (float(series.iloc[-1]), float(series.iloc[-2]))
                else:
                    result[sym] = None
            except Exception:
                result[sym] = None

        return result

    except Exception as exc:
        logger.error("batch_fetch_latest_close failed: %s", exc)
        return {}
