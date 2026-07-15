"""
File: intraday.py
Description: Intraday 5-minute session snapshot for the Node intraday engine (ORB,
    VWAP-reversion, and momentum-continuation strategies all read this). From a
    multi-session 5m OHLCV frame, computes for the LATEST session: opening range
    (first N minutes), session VWAP + its deviation band width, a warmed-up EMA(9),
    and time-of-day-adjusted relative volume (today's cumulative volume vs the
    average cumulative volume of prior sessions at the same bar count). The caller
    (Node) is responsible for checking sessionDate == today — before the open, the
    latest session is yesterday.

    yfinance intraday caveat: bars lag real time by up to ~15 minutes for NSE. Fine
    for opening-range-breakout confirmation on 5m closes; not fine for scalping.
Author: TradeZen Team
Created: 2026-07-07
"""

import logging
from typing import Optional

import pandas as pd

from app.services.indicators import _ema

logger = logging.getLogger(__name__)

MIN_PRIOR_SESSIONS_FOR_RELVOL = 2
EMA_PERIOD = 9
MIN_BARS_FOR_VWAP_STDDEV = 6  # ~30 min into the session before the band means anything


def frame_to_bars(df: pd.DataFrame) -> list[dict]:
    """
    Serialize a 5m OHLCV frame to plain bar dicts for the Node paper-trade replay.
    All sessions in the frame are returned; Node filters by session date itself
    (it also needs PRIOR sessions to settle alerts missed while the server was down).

    Args:
        df: Normalized OHLCV frame (lowercase columns, tz-aware DatetimeIndex)

    Returns:
        List of {time, open, high, low, close, volume} dicts in chronological order
    """
    if df is None or df.empty:
        return []
    df = df.dropna(subset=["close"])
    return [
        {
            "time": ts.isoformat(),
            "open": round(float(row["open"]), 2),
            "high": round(float(row["high"]), 2),
            "low": round(float(row["low"]), 2),
            "close": round(float(row["close"]), 2),
            "volume": float(row["volume"]),
        }
        for ts, row in df.iterrows()
    ]


def compute_session_snapshot(df: pd.DataFrame, or_minutes: int = 60) -> Optional[dict]:
    """
    Build the latest-session intraday snapshot from a multi-session 5m OHLCV frame.

    Args:
        df: Normalized OHLCV frame (lowercase columns, DatetimeIndex — tz-aware IST
            for NSE tickers) spanning one or more sessions of 5m bars
        or_minutes: Opening-range window length in minutes from the session open

    Returns:
        Snapshot dict (see keys below), or None when the frame is empty/unusable.
        Keys: sessionDate, lastPrice, lastBarTime, barsCount, orHigh, orLow,
        orComplete, vwap, vwapStdDev, ema9, cumVolume, relVolume, dayHigh, dayLow
    """
    if df is None or df.empty:
        return None

    df = df.dropna(subset=["close"])
    if df.empty:
        return None

    # EMA(9) warmed up across the FULL multi-session frame (not reset per session) —
    # far more stable in the first few bars of a new day than a session-only EMA would be.
    ema_series = _ema(df["close"].astype(float), EMA_PERIOD)

    dates = pd.Series(df.index.date, index=df.index)
    session_date = dates.iloc[-1]
    today = df[dates == session_date]
    if today.empty:
        return None

    session_open = today.index[0]
    or_end = session_open + pd.Timedelta(minutes=or_minutes)
    or_bars = today[today.index < or_end]
    # Complete once a bar at/after the OR end exists (bar timestamps are bar OPEN times)
    or_complete = bool((today.index >= or_end).any())

    typical = (today["high"] + today["low"] + today["close"]) / 3
    cum_vol = float(today["volume"].sum())
    vwap = float((typical * today["volume"]).sum() / cum_vol) if cum_vol > 0 else None

    # VWAP band width: stdev of (typical price − RUNNING vwap) through today's session so
    # far — a running (not final) VWAP, since a reversion band must reflect what the band
    # looked like at each point in time, not use the full day's hindsight vwap.
    vwap_std = None
    if len(today) >= MIN_BARS_FOR_VWAP_STDDEV:
        running_cum_pv = (typical * today["volume"]).cumsum()
        running_cum_vol = today["volume"].cumsum()
        running_vwap = running_cum_pv / running_cum_vol.replace(0, pd.NA)
        deviations = (typical - running_vwap).dropna()
        if len(deviations) >= MIN_BARS_FOR_VWAP_STDDEV:
            vwap_std = float(deviations.std())

    # Relative volume, time-of-day adjusted: today's cumulative volume vs the average
    # cumulative volume of prior sessions truncated to the same number of bars.
    rel_volume = None
    prior = df[dates < session_date]
    if not prior.empty:
        bars_so_far = len(today)
        prior_cums = [
            float(g["volume"].iloc[:bars_so_far].sum())
            for _, g in prior.groupby(prior.index.date)
        ]
        prior_cums = [c for c in prior_cums if c > 0]
        if len(prior_cums) >= MIN_PRIOR_SESSIONS_FOR_RELVOL:
            avg_prior = sum(prior_cums) / len(prior_cums)
            if avg_prior > 0:
                rel_volume = round(cum_vol / avg_prior, 2)

    return {
        "sessionDate": str(session_date),
        "lastPrice": round(float(today["close"].iloc[-1]), 2),
        "lastBarTime": today.index[-1].isoformat(),
        "barsCount": int(len(today)),
        "orHigh": round(float(or_bars["high"].max()), 2) if not or_bars.empty else None,
        "orLow": round(float(or_bars["low"].min()), 2) if not or_bars.empty else None,
        "orComplete": or_complete,
        "vwap": round(vwap, 2) if vwap is not None else None,
        "vwapStdDev": round(vwap_std, 4) if vwap_std is not None else None,
        "ema9": round(float(ema_series.iloc[-1]), 2) if not ema_series.empty else None,
        "cumVolume": cum_vol,
        "relVolume": rel_volume,
        "dayHigh": round(float(today["high"].max()), 2),
        "dayLow": round(float(today["low"].min()), 2),
    }
