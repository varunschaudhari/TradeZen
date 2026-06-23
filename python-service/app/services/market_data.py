"""
File: market_data.py
Description: Fetches live Nifty 50, Bank Nifty, India VIX, and advance/decline ratio
             via yfinance. Market data powers Gate 1 and the Claude prompt header.
             Uses pure-pandas EMA — no pandas-ta dependency.
Author: SwingTrader AI Team
Created: 2026-06-13
Last Modified: 2026-06-13
"""

import logging
from typing import Optional

import pandas as pd
import yfinance as yf

from app.config import (
    BANK_NIFTY_TICKER,
    NIFTY_EMA_PERIOD,
    NIFTY_TICKER,
    NSE_SUFFIX,
    VIX_TICKER,
    YFINANCE_TIMEOUT,
)
from app.models.schemas import MarketIndex, MarketResponse
from app.services.universe import list_symbols

logger = logging.getLogger(__name__)

INDEX_FETCH_PERIOD: str = "3mo"
INDEX_FETCH_INTERVAL: str = "1d"

# Advance/decline breadth: sample the Nifty 100 (Nifty 50 + Next 50), the standard
# breadth gauge. Far more representative than a 20-stock large-cap sample.
AD_SAMPLE_TIERS: tuple[str, ...] = ("NIFTY50", "NEXT50")
AD_CHUNK_SIZE: int = 50


def _ema_series(series: pd.Series, period: int) -> pd.Series:
    """
    Compute Exponential Moving Average using pandas ewm (finance convention).

    Args:
        series: Price Series
        period: EMA period

    Returns:
        EMA Series of same length
    """
    return series.ewm(span=period, adjust=False).mean()


def _fetch_index_df(ticker: str) -> Optional[pd.DataFrame]:
    """
    Download recent daily OHLCV for a market index or VIX.

    Args:
        ticker: yfinance ticker string (e.g. '^NSEI')

    Returns:
        Normalized DataFrame or None on any failure
    """
    try:
        df = yf.download(
            ticker,
            period=INDEX_FETCH_PERIOD,
            interval=INDEX_FETCH_INTERVAL,
            progress=False,
            auto_adjust=True,
            threads=False,
            timeout=YFINANCE_TIMEOUT,
        )
        if df is None or df.empty or len(df) < 5:
            return None
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df.columns = [str(c).lower() for c in df.columns]
        return df
    except Exception as exc:
        logger.error("_fetch_index_df failed for %s: %s", ticker, exc)
        return None


def _build_market_index(df: pd.DataFrame) -> MarketIndex:
    """
    Derive price, day change, EMA 20, and aboveEma20 flag from index OHLCV.

    Args:
        df: Normalized daily OHLCV DataFrame for one index

    Returns:
        Populated MarketIndex model
    """
    close = df["close"].astype(float)
    price = round(float(close.iloc[-1]), 2)
    prev = float(close.iloc[-2]) if len(close) > 1 else price
    change = round(price - prev, 2)
    change_pct = round((change / prev) * 100, 2) if prev else 0.0

    ema_series = _ema_series(close, NIFTY_EMA_PERIOD)
    ema20: Optional[float] = None
    above_ema20: Optional[bool] = None

    clean = ema_series.dropna()
    if not clean.empty:
        ema20 = round(float(clean.iloc[-1]), 2)
        above_ema20 = price > ema20

    return MarketIndex(
        price=price,
        change=change,
        changePct=change_pct,
        ema20=ema20,
        aboveEma20=above_ema20,
    )


def fetch_index_series(ticker: str = NIFTY_TICKER, period: str = "1y") -> dict:
    """
    Download an index's daily closes with dates (oldest→newest). Dates let the backtest
    align the index to each stock's bars for Gate 1 and relative strength.

    Args:
        ticker: yfinance index ticker (default Nifty 50 ^NSEI)
        period: yfinance period string

    Returns:
        { dates: [YYYY-MM-DD], closes: [float] } — empty arrays on failure
    """
    try:
        df = yf.download(
            ticker,
            period=period,
            interval=INDEX_FETCH_INTERVAL,
            progress=False,
            auto_adjust=True,
            threads=False,
            timeout=YFINANCE_TIMEOUT,
        )
        if df is None or df.empty:
            return {"dates": [], "closes": []}
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df.columns = [str(c).lower() for c in df.columns]
        clean = df["close"].dropna()
        return {
            "dates": [d.strftime("%Y-%m-%d") for d in clean.index],
            "closes": [round(float(x), 2) for x in clean.tolist()],
        }
    except Exception as exc:
        logger.error("fetch_index_series failed for %s: %s", ticker, exc)
        return {"dates": [], "closes": []}


def fetch_index_closes(ticker: str = NIFTY_TICKER, period: str = "1y") -> list[float]:
    """Closes-only convenience wrapper over fetch_index_series (for the RS feed)."""
    return fetch_index_series(ticker, period)["closes"]


def _fetch_vix() -> Optional[float]:
    """
    Fetch the current India VIX value.

    Returns:
        VIX as float rounded to 2dp, or None on failure
    """
    df = _fetch_index_df(VIX_TICKER)
    if df is None or "close" not in df.columns:
        return None
    return round(float(df["close"].iloc[-1]), 2)


def _extract_close(raw: pd.DataFrame, ticker: str, single: bool) -> Optional[pd.Series]:
    """
    Pull one ticker's adjusted close series from a group_by='ticker' batch download.

    Args:
        raw: yf.download result (group_by='ticker')
        ticker: Suffixed ticker (e.g. 'RELIANCE.NS')
        single: True when the chunk had exactly one ticker (flat columns)

    Returns:
        Non-NaN close Series, or None if absent
    """
    try:
        frame = raw if single else raw[ticker]
        if "Close" not in frame.columns:
            return None
        return frame["Close"].dropna()
    except (KeyError, TypeError):
        return None


def _compute_ad_ratio() -> Optional[float]:
    """
    Compute the NSE Advance/Decline breadth from a Nifty 100 sample (Nifty 50 +
    Next 50), downloaded in chunks for reliability.

    A stock advances when today's close > yesterday's close. The result is a breadth
    FRACTION in [0, 1] (advances / (advances + declines)): above ~0.6 is broad
    participation, below ~0.4 is narrow/weak breadth. (This is intentionally NOT the
    unbounded advances÷declines convention — downstream mode thresholds expect [0,1].)

    Returns:
        Breadth ratio in [0.0, 1.0], or None when no usable data is returned
    """
    symbols = list_symbols(AD_SAMPLE_TIERS)
    tickers = [f"{s}{NSE_SUFFIX}" for s in symbols]
    advances = declines = unchanged = 0

    for start in range(0, len(tickers), AD_CHUNK_SIZE):
        chunk = tickers[start : start + AD_CHUNK_SIZE]
        try:
            raw = yf.download(
                chunk,
                period="5d",
                interval="1d",
                progress=False,
                auto_adjust=True,
                group_by="ticker",
                threads=True,
                timeout=YFINANCE_TIMEOUT,
            )
        except Exception as exc:
            logger.error("A/D chunk download failed (%d tickers): %s", len(chunk), exc)
            continue
        if raw is None or raw.empty:
            continue

        single = len(chunk) == 1
        for ticker in chunk:
            series = _extract_close(raw, ticker, single)
            if series is None or len(series) < 2:
                continue
            last, prev = float(series.iloc[-1]), float(series.iloc[-2])
            if last > prev:
                advances += 1
            elif last < prev:
                declines += 1
            else:
                unchanged += 1

    total = advances + declines
    if total == 0:
        logger.warning("A/D ratio: no usable data from %d sampled symbols", len(symbols))
        return None

    ratio = round(advances / total, 3)
    logger.info(
        "A/D ratio %.3f (adv=%d decl=%d unch=%d of %d sampled)",
        ratio, advances, declines, unchanged, len(symbols),
    )
    return ratio


async def fetch_market_overview() -> MarketResponse:
    """
    Fetch real-time market overview: Nifty 50, Bank Nifty, VIX, and A/D ratio.

    Returns partial results when individual fetches fail — Gate 1 logic in the
    Node.js server uses nifty50.aboveEma20 to block all BUY signals in bear mode.

    Returns:
        Populated MarketResponse Pydantic model
    """
    nifty_df = _fetch_index_df(NIFTY_TICKER)
    bank_df = _fetch_index_df(BANK_NIFTY_TICKER)
    vix = _fetch_vix()
    ad_ratio = _compute_ad_ratio()

    nifty50 = _build_market_index(nifty_df) if nifty_df is not None else None
    bank_nifty = _build_market_index(bank_df) if bank_df is not None else None

    if nifty50 is None:
        logger.error("Nifty 50 data unavailable — Gate 1 cannot function correctly")

    return MarketResponse(
        nifty50=nifty50,
        bankNifty=bank_nifty,
        vix=vix,
        adRatio=ad_ratio,
    )
