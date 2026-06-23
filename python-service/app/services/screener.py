"""
File: screener.py
Description: Step 2 universe screener — batch-downloads daily OHLCV for the static
             NSE universe and applies 6 cheap pre-filters (liquidity, market-cap tier,
             trend, momentum, ATR, earnings) to narrow ~350 stocks to ~45 candidates
             before the expensive per-stock /analyze + 8-gate + Claude pipeline.
Author: SwingTrader AI Team
Created: 2026-06-19
Last Modified: 2026-06-19
"""

import logging
from datetime import datetime
from typing import Optional

import pandas as pd
import yfinance as yf

from app.config import (
    ATR_PCT_MAX,
    ATR_PCT_MIN,
    EMA_LONG,
    EMA_MID,
    LIQUIDITY_LOOKBACK_DAYS,
    MARKET_CAP_TIERS,
    MIN_AVG_TURNOVER_INR,
    MIN_ROC_PCT,
    NSE_SUFFIX,
    ROC_LOOKBACK_DAYS,
    SCREEN_BATCH_SIZE,
    SCREEN_EARNINGS_BUFFER_DAYS,
    SCREEN_MIN_BARS,
    SCREEN_PERIOD,
    SCREEN_RSI_MAX,
    SCREEN_RSI_MIN,
    YFINANCE_TIMEOUT,
)
from app.models.schemas import ScreenCandidate, ScreenReject, ScreenResponse
from app.services.data_fetcher import fetch_ticker_info
from app.services.indicators import _atr, _ema, _rsi
from app.services.universe import get_universe

logger = logging.getLogger(__name__)

WATCHLIST_TIER: str = "WATCHLIST"  # tier tag for caller-supplied overlay symbols


def _extract_symbol_df(raw: pd.DataFrame, ticker: str, single: bool) -> Optional[pd.DataFrame]:
    """
    Pull one symbol's OHLCV frame out of a yfinance batch download and normalize it.

    Args:
        raw: Result of yf.download(group_by='ticker') for a chunk of tickers
        ticker: The suffixed ticker (e.g. 'RELIANCE.NS') to extract
        single: True when the chunk had exactly one ticker (flat columns)

    Returns:
        DataFrame with lowercase [open, high, low, close, volume] and NaN rows
        dropped, or None if absent/empty
    """
    try:
        df = raw if single else raw[ticker]
    except (KeyError, TypeError):
        return None
    if df is None or df.empty:
        return None
    df = df.copy()
    df.columns = [str(c).lower().strip() for c in df.columns]
    required = {"open", "high", "low", "close", "volume"}
    if not required.issubset(set(df.columns)):
        return None
    return df.dropna(subset=["close", "volume"])


def _download_universe_ohlcv(symbols: list[str]) -> dict[str, pd.DataFrame]:
    """
    Batch-download daily OHLCV for every symbol in chunks of SCREEN_BATCH_SIZE.

    Per-chunk failures are logged and skipped so one bad chunk never aborts the scan.

    Args:
        symbols: Bare NSE symbols (no suffix)

    Returns:
        Map of bare symbol -> normalized daily OHLCV DataFrame (only symbols with data)
    """
    frames: dict[str, pd.DataFrame] = {}
    for start in range(0, len(symbols), SCREEN_BATCH_SIZE):
        chunk = symbols[start : start + SCREEN_BATCH_SIZE]
        tickers = [f"{sym}{NSE_SUFFIX}" for sym in chunk]
        try:
            raw = yf.download(
                tickers,
                period=SCREEN_PERIOD,
                interval="1d",
                progress=False,
                auto_adjust=True,
                group_by="ticker",
                threads=True,
                timeout=YFINANCE_TIMEOUT,
            )
        except Exception as exc:
            logger.error("Screen chunk download failed (%d symbols): %s", len(chunk), exc)
            continue
        if raw is None or raw.empty:
            continue
        for sym, ticker in zip(chunk, tickers):
            df = _extract_symbol_df(raw, ticker, single=len(tickers) == 1)
            if df is not None and len(df) >= SCREEN_MIN_BARS:
                frames[sym] = df
    logger.info(
        "Universe OHLCV fetched: %d/%d symbols returned usable data", len(frames), len(symbols)
    )
    return frames


def _compute_metrics(df: pd.DataFrame) -> Optional[dict]:
    """
    Compute the lightweight screening metrics from a symbol's daily OHLCV.

    Args:
        df: Normalized daily OHLCV DataFrame (>= SCREEN_MIN_BARS rows)

    Returns:
        Dict of metrics, or None if essential values are missing
    """
    try:
        close = df["close"].astype(float)
        high = df["high"].astype(float)
        low = df["low"].astype(float)
        volume = df["volume"].astype(float)

        last_close = float(close.iloc[-1])
        if last_close <= 0:
            return None

        avg_turnover = float((close * volume).tail(LIQUIDITY_LOOKBACK_DAYS).mean())
        ema50 = float(_ema(close, EMA_MID).iloc[-1])
        ema200 = float(_ema(close, EMA_LONG).iloc[-1])
        rsi = float(_rsi(close).dropna().iloc[-1])
        atr = float(_atr(high, low, close).dropna().iloc[-1])
        atr_pct = (atr / last_close) * 100.0

        roc_ref_idx = -1 - ROC_LOOKBACK_DAYS
        roc_pct = (
            (last_close / float(close.iloc[roc_ref_idx]) - 1.0) * 100.0
            if len(close) > ROC_LOOKBACK_DAYS
            else 0.0
        )

        return {
            "currentPrice": round(last_close, 2),
            "avgTurnover": round(avg_turnover, 2),
            "ema50": ema50,
            "ema200": ema200,
            "rsi14": round(rsi, 2),
            "atrPct": round(atr_pct, 2),
            "rocPct": round(roc_pct, 2),
        }
    except (IndexError, ValueError, TypeError) as exc:
        logger.debug("Metric computation skipped: %s", exc)
        return None


def _failing_filter(metrics: dict, tier: str, tiers: tuple[str, ...]) -> Optional[str]:
    """
    Apply pre-filters 1–5 (liquidity, market-cap tier, trend, momentum, ATR) and return
    the name of the first filter that fails, or None if the symbol passes all five.

    Args:
        metrics: Output of _compute_metrics
        tier: Market-cap tier tag for the symbol (or WATCHLIST_TIER)
        tiers: Allowed tiers from the request

    Returns:
        'liquidity' | 'market_cap' | 'trend' | 'momentum' | 'atr', or None
    """
    if metrics["avgTurnover"] < MIN_AVG_TURNOVER_INR:
        return "liquidity"
    if tier != WATCHLIST_TIER and tier not in tiers:
        return "market_cap"
    if not (metrics["currentPrice"] > metrics["ema50"] > metrics["ema200"]):
        return "trend"
    rsi_ok = SCREEN_RSI_MIN <= metrics["rsi14"] <= SCREEN_RSI_MAX
    if not (rsi_ok and metrics["rocPct"] >= MIN_ROC_PCT):
        return "momentum"
    if not (ATR_PCT_MIN <= metrics["atrPct"] <= ATR_PCT_MAX):
        return "atr"
    return None


def _has_imminent_earnings(symbol: str) -> bool:
    """
    Pre-filter 6 — best-effort earnings proximity check via ticker metadata.

    Unknown earnings dates pass (matching Gate 3 semantics in Node). Gate 3
    remains the authoritative earnings block on the survivors.

    Args:
        symbol: Bare NSE symbol

    Returns:
        True if earnings fall within SCREEN_EARNINGS_BUFFER_DAYS (→ reject)
    """
    ts = fetch_ticker_info(symbol).get("earnings_timestamp")
    if not ts:
        return False
    days_to_earnings = (datetime.utcfromtimestamp(ts) - datetime.utcnow()).days
    return 0 <= days_to_earnings <= SCREEN_EARNINGS_BUFFER_DAYS


def screen_universe(
    tiers: Optional[tuple[str, ...]] = None,
    check_earnings: bool = True,
    extra_symbols: Optional[list[str]] = None,
) -> ScreenResponse:
    """
    Run the full Step 2 screen: build universe → batch OHLCV → filters 1–5 → filter 6.

    Args:
        tiers: Index tiers to include (defaults to all MARKET_CAP_TIERS)
        check_earnings: Whether to apply the earnings pre-filter to survivors
        extra_symbols: Watchlist overlay always screened (tagged WATCHLIST_TIER)

    Returns:
        ScreenResponse with surviving candidates and per-filter rejection counts
    """
    allowed = tuple(tiers) if tiers else MARKET_CAP_TIERS
    universe = get_universe(allowed)
    for sym in extra_symbols or []:
        universe.setdefault(sym.strip().upper(), WATCHLIST_TIER)

    rejection_keys = ("no_data", "liquidity", "market_cap", "trend", "momentum", "atr", "earnings")
    rej = {key: 0 for key in rejection_keys}
    symbols = list(universe.keys())
    frames = _download_universe_ohlcv(symbols)

    survivors: list[ScreenCandidate] = []
    rejected: list[ScreenReject] = []

    def _reject(symbol: str, tier: str, price: Optional[float], stage: str) -> None:
        rej[stage] += 1
        rejected.append(ScreenReject(symbol=symbol, tier=tier, currentPrice=price, stage=stage))

    for symbol, tier in universe.items():
        df = frames.get(symbol)
        metrics = _compute_metrics(df) if df is not None else None
        if metrics is None:
            _reject(symbol, tier, None, "no_data")
            continue
        reason = _failing_filter(metrics, tier, allowed)
        if reason:
            _reject(symbol, tier, metrics["currentPrice"], reason)
            continue
        if check_earnings and _has_imminent_earnings(symbol):
            _reject(symbol, tier, metrics["currentPrice"], "earnings")
            continue
        survivors.append(
            ScreenCandidate(
                symbol=symbol,
                tier=tier,
                currentPrice=metrics["currentPrice"],
                avgTurnoverInr=metrics["avgTurnover"],
                rsi14=metrics["rsi14"],
                atrPct=metrics["atrPct"],
                rocPct=metrics["rocPct"],
            )
        )

    # Rank strongest momentum first so the downstream cap (top-N) keeps the best setups
    survivors.sort(key=lambda candidate: candidate.rocPct or 0.0, reverse=True)
    logger.info(
        "Screen complete: %d/%d candidates | rejections=%s", len(survivors), len(symbols), rej
    )
    return ScreenResponse(
        candidates=survivors,
        rejected=rejected,
        universeCount=len(symbols),
        screenedCount=len(frames),
        candidateCount=len(survivors),
        rejectionCounts=rej,
    )
