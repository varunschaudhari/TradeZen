"""
File: analyze.py
Description: FastAPI router — POST /analyze (full stock analysis pipeline) and
             GET /market (Nifty, VIX, A/D ratio). Entry point for the Node.js
             pythonBridge.js service.
Author: SwingTrader AI Team
Created: 2026-06-13
Last Modified: 2026-06-13
"""

import logging
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException

from app.config import (
    ENTRY_EMA20_BAND_PCT,
    FALLBACK_SL_PCT,
    NIFTY_TICKER,
    SL_ATR_MULTIPLIER,
    TARGET1_RR,
    TARGET2_RR,
    WEEKLY_BEARISH,
    WEEKLY_BULLISH,
    WEEKLY_SIDEWAYS,
)
from app.models.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    MarketResponse,
    StockAnalysis,
)
from app.services.data_fetcher import fetch_ohlcv, fetch_ticker_info, fetch_weekly_ohlcv
from app.services.indicators import compute_indicator_series, compute_indicators
from app.services.market_data import fetch_index_series, fetch_market_overview
from app.services.universe import list_symbols
from app.services.support_resistance import (
    compute_fibonacci,
    find_support_resistance,
    find_swing_high_low,
)

logger = logging.getLogger(__name__)
router = APIRouter()

WEEKLY_EMA50_PERIOD: int = 50


def _determine_weekly_trend(df_weekly: Optional[pd.DataFrame]) -> str:
    """
    Classify weekly trend as BULLISH, BEARISH, or SIDEWAYS using
    weekly close vs. weekly EMA 50 and recent price direction.

    Args:
        df_weekly: Weekly OHLCV DataFrame or None

    Returns:
        One of WEEKLY_BULLISH, WEEKLY_BEARISH, WEEKLY_SIDEWAYS
    """
    if df_weekly is None or df_weekly.empty or len(df_weekly) < WEEKLY_EMA50_PERIOD:
        return WEEKLY_SIDEWAYS

    try:
        close = df_weekly["close"].astype(float)
        ema50 = close.ewm(span=WEEKLY_EMA50_PERIOD, adjust=False).mean()
        if ema50 is None or ema50.dropna().empty:
            return WEEKLY_SIDEWAYS

        last_close = float(close.iloc[-1])
        last_ema50 = float(ema50.dropna().iloc[-1])

        # Check momentum: compare last 4 weekly closes
        recent_closes = close.tail(4).values
        trending_up = all(recent_closes[i] <= recent_closes[i + 1] for i in range(len(recent_closes) - 1))
        trending_down = all(recent_closes[i] >= recent_closes[i + 1] for i in range(len(recent_closes) - 1))

        if last_close > last_ema50 and trending_up:
            return WEEKLY_BULLISH
        if last_close < last_ema50 and trending_down:
            return WEEKLY_BEARISH
        return WEEKLY_SIDEWAYS

    except Exception as exc:
        logger.debug("_determine_weekly_trend error: %s", exc)
        return WEEKLY_SIDEWAYS


def _select_stop_loss(
    entry: float,
    atr: Optional[float],
    supports: list,
) -> float:
    """
    Choose a stop loss that sits strictly BELOW the entry price.

    Priority:
        1. Nearest swing support below entry (highest support price under entry).
        2. ATR-based stop: entry - ATR * SL_ATR_MULTIPLIER.
        3. Percentage fallback: entry * (1 - FALLBACK_SL_PCT).

    Note: `supports` are filtered to levels below the *current price*, which can
    still be above the entry when entry is anchored to EMA20 on a pullback — hence
    we re-filter against `entry` here rather than trusting supports[0].

    Args:
        entry: Suggested entry price
        atr: ATR 14 value or None
        supports: List of SupportResistanceLevel (below current price)

    Returns:
        Stop loss price strictly below entry (caller still clamps as a safety net)
    """
    supports_below_entry = [float(level.price) for level in supports if float(level.price) < entry]
    if supports_below_entry:
        return max(supports_below_entry)
    if atr and atr > 0:
        return entry - atr * SL_ATR_MULTIPLIER
    return entry * (1 - FALLBACK_SL_PCT)


def _compute_trade_levels(
    current_price: float,
    ema20: Optional[float],
    atr: Optional[float],
    supports: list,
) -> tuple[float, float, float, float]:
    """
    Suggest entry, stop loss, target 1, and target 2 based on indicators.

    Entry: EMA20 pullback zone when within ENTRY_EMA20_BAND_PCT of current price,
           otherwise the current price.
    Stop loss: see _select_stop_loss — always strictly below entry.
    Target 1: entry + (entry - sl) * TARGET1_RR
    Target 2: entry + (entry - sl) * TARGET2_RR

    Args:
        current_price: Latest close price
        ema20: EMA 20 value or None
        atr: ATR 14 value or None
        supports: List of SupportResistanceLevel below current price

    Returns:
        (entry, stop_loss, target1, target2) all rounded to 2dp
    """
    within_band = (
        ema20 is not None
        and current_price > 0
        and abs(ema20 - current_price) / current_price < ENTRY_EMA20_BAND_PCT
    )
    entry = ema20 if within_band else current_price

    stop_loss = _select_stop_loss(entry, atr, supports)
    # Safety net: guarantee a positive risk so downstream R:R (Gate 6) is valid.
    if stop_loss >= entry:
        stop_loss = entry * (1 - FALLBACK_SL_PCT)

    risk = entry - stop_loss
    target1 = entry + risk * TARGET1_RR
    target2 = entry + risk * TARGET2_RR

    return (
        round(entry, 2),
        round(stop_loss, 2),
        round(target1, 2),
        round(target2, 2),
    )


async def _analyze_single_stock(
    symbol: str, capital: float, risk_pct: float
) -> StockAnalysis:
    """
    Run the full analysis pipeline for one NSE stock symbol.

    Pipeline:
        1. Fetch daily OHLCV (6 months)
        2. Fetch ticker metadata (market cap, 52w range, earnings)
        3. Compute 8 technical indicators
        4. Find support/resistance levels via swing detection
        5. Compute Fibonacci retracement from 60-bar swing high/low
        6. Fetch weekly OHLCV and determine weekly trend
        7. Suggest entry, stop loss, and targets
        8. Return StockAnalysis (error field set if pipeline fails)

    Args:
        symbol: NSE symbol without suffix (e.g. 'RELIANCE')
        capital: Trading capital in INR (used for position sizing upstream)
        risk_pct: Risk percentage per trade (used for position sizing upstream)

    Returns:
        Populated StockAnalysis Pydantic model; error field is set on failure
    """
    # Step 1: Daily OHLCV
    df_daily = fetch_ohlcv(symbol)
    if df_daily is None:
        return StockAnalysis(symbol=symbol, error="No daily OHLCV data available")

    # Step 2: Metadata
    info = fetch_ticker_info(symbol)

    # Current and previous price
    current_price = float(df_daily["close"].iloc[-1])
    prev_close_raw = info.get("prev_close") or (
        float(df_daily["close"].iloc[-2]) if len(df_daily) > 1 else None
    )
    prev_close = float(prev_close_raw) if prev_close_raw else None
    day_change_pct = (
        round(((current_price - prev_close) / prev_close) * 100, 2)
        if prev_close and prev_close > 0
        else None
    )

    # Step 3: Indicators
    indicators = compute_indicators(df_daily)

    # Step 4: Support / Resistance
    supports, resistances = find_support_resistance(df_daily)

    # Step 5: Fibonacci
    swing_high, swing_low = find_swing_high_low(df_daily)
    fibonacci = compute_fibonacci(swing_high, swing_low)

    # Step 6: Weekly trend
    df_weekly = fetch_weekly_ohlcv(symbol)
    weekly_trend = _determine_weekly_trend(df_weekly)

    # Step 7: Trade levels
    ema20 = indicators.ema20 if indicators else None
    atr = indicators.atr14 if indicators else None
    entry, stop_loss, target1, target2 = _compute_trade_levels(
        current_price, ema20, atr, supports
    )

    return StockAnalysis(
        symbol=symbol,
        currentPrice=round(current_price, 2),
        prevClose=round(prev_close, 2) if prev_close else None,
        dayChangePct=day_change_pct,
        high52w=info.get("high_52w"),
        low52w=info.get("low_52w"),
        earningsTimestamp=info.get("earnings_timestamp"),
        indicators=indicators,
        supportLevels=supports,
        resistanceLevels=resistances,
        fibonacci=fibonacci,
        weeklyTrend=weekly_trend,
        suggestedEntry=entry,
        suggestedStopLoss=stop_loss,
        suggestedTarget1=target1,
        suggestedTarget2=target2,
        error=None,
    )


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_stocks(request: AnalyzeRequest) -> AnalyzeResponse:
    """
    Analyze a list of NSE stock symbols in sequence.

    For each symbol: fetches OHLCV, computes indicators, finds S/R levels,
    calculates Fibonacci, determines weekly trend, and suggests trade levels.
    Per-symbol errors are captured in the result's error field rather than
    failing the entire request.

    Args:
        request: { symbols, capital, riskPct }

    Returns:
        AnalyzeResponse with per-symbol results, total count, and error count
    """
    results: list[StockAnalysis] = []
    error_count: int = 0

    for symbol in request.symbols:
        symbol = symbol.strip().upper()
        try:
            analysis = await _analyze_single_stock(symbol, request.capital, request.riskPct)
            results.append(analysis)
            if analysis.error:
                error_count += 1
                logger.warning("Analysis error for %s: %s", symbol, analysis.error)
            else:
                logger.info("Analysis complete for %s | price=%.2f", symbol, analysis.currentPrice or 0)
        except Exception as exc:
            logger.error("Unhandled exception analyzing %s: %s", symbol, exc, exc_info=True)
            results.append(StockAnalysis(symbol=symbol, error=str(exc)))
            error_count += 1

    return AnalyzeResponse(
        results=results,
        analyzedCount=len(results),
        errorCount=error_count,
    )


@router.get("/ohlcv/{symbol}")
async def get_ohlcv(
    symbol: str,
    period: str = "60d",
    interval: str = "15m",
) -> dict:
    """
    Return OHLCV candlestick data for the TradingView lightweight-charts widget.
    Each record has { time (unix seconds), open, high, low, close, volume }.

    Args:
        symbol: NSE symbol without suffix (e.g. 'RELIANCE')
        period: yfinance period string (e.g. '60d', '30d', '6mo')
        interval: yfinance interval (e.g. '15m', '1h', '1d')
    """
    df = fetch_ohlcv(symbol, period=period, interval=interval)
    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No OHLCV data for {symbol}")

    records = []
    for ts, row in df.iterrows():
        try:
            records.append(
                {
                    "time": int(ts.timestamp()),
                    "open": round(float(row["open"]), 2),
                    "high": round(float(row["high"]), 2),
                    "low": round(float(row["low"]), 2),
                    "close": round(float(row["close"]), 2),
                    "volume": int(row["volume"]) if pd.notna(row["volume"]) else 0,
                }
            )
        except (ValueError, KeyError):
            continue

    logger.info("OHLCV served for %s | %d bars | period=%s interval=%s", symbol, len(records), period, interval)
    return {"symbol": symbol, "interval": interval, "data": records}


@router.get("/market", response_model=MarketResponse)
async def get_market_data() -> MarketResponse:
    """
    Fetch live Nifty 50, Bank Nifty, India VIX, and advance/decline ratio.

    Used by the Node.js server at startup and before every scan cycle.
    Gate 1 (Nifty above EMA 20) depends on nifty50.aboveEma20 from this response.

    Returns:
        MarketResponse with current market snapshot
    """
    try:
        return await fetch_market_overview()
    except Exception as exc:
        logger.error("GET /market failed: %s", exc)
        raise HTTPException(status_code=503, detail=f"Market data unavailable: {exc}") from exc


@router.get("/universe")
async def get_universe_symbols() -> dict:
    """Return the full static NSE universe symbol list (for full-universe backtests)."""
    symbols = list_symbols()
    return {"symbols": symbols, "count": len(symbols)}


@router.get("/indicator-series/{symbol}")
async def get_indicator_series(symbol: str, period: str = "2y") -> dict:
    """
    Return per-bar OHLCV + indicator arrays for backtesting (daily interval).

    Args:
        symbol: NSE symbol without suffix (e.g. 'RELIANCE')
        period: yfinance period string (default '2y' for backtest history)
    """
    df = fetch_ohlcv(symbol, period=period, interval="1d")
    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No daily OHLCV for {symbol}")
    series = compute_indicator_series(df)
    logger.info("Indicator series served for %s | %d bars | period=%s", symbol, len(series["date"]), period)
    return {"symbol": symbol, "bars": len(series["date"]), "series": series}


@router.get("/nifty-history")
async def get_nifty_history(period: str = "1y") -> dict:
    """
    Return Nifty 50 daily closes (+ dates) for relative-strength scoring and backtest
    alignment.

    Args:
        period: yfinance period string (default '1y'; backtest uses '2y')
    """
    data = fetch_index_series(NIFTY_TICKER, period)
    logger.info("Nifty history served | %d closes | period=%s", len(data["closes"]), period)
    return {"ticker": NIFTY_TICKER, "dates": data["dates"], "closes": data["closes"], "count": len(data["closes"])}
