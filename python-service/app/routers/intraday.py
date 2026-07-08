"""
File: intraday.py (router)
Description: GET /intraday — batch latest-session 5m snapshots (opening range, VWAP,
    time-adjusted relative volume) for the Node ORB scanner. Per-symbol errors are
    returned inline so one bad ticker never fails the batch.
Author: TradeZen Team
Created: 2026-07-07
"""

import logging

from fastapi import APIRouter

from app.models.schemas import (
    IntradayBarsEntry,
    IntradayBarsResponse,
    IntradayResponse,
    IntradaySnapshot,
)
from app.services.data_fetcher import fetch_ohlcv
from app.services.intraday import compute_session_snapshot, frame_to_bars

logger = logging.getLogger(__name__)
router = APIRouter()

INTRADAY_PERIOD = "5d"  # ~5 sessions: today + enough history for relative volume
INTRADAY_INTERVAL = "5m"
MAX_SYMBOLS = 25
OR_MINUTES_MIN, OR_MINUTES_MAX = 15, 120


@router.get("/intraday", response_model=IntradayResponse)
def get_intraday(symbols: str, orMinutes: int = 60) -> IntradayResponse:
    """
    Batch intraday session snapshots for a comma-separated list of NSE symbols.

    Args:
        symbols: Comma-separated NSE symbols without suffix (e.g. 'RELIANCE,TCS')
        orMinutes: Opening-range window in minutes from the 9:15 open (15–120)
    """
    requested = [s.strip().upper() for s in symbols.split(",") if s.strip()][:MAX_SYMBOLS]
    or_minutes = min(max(orMinutes, OR_MINUTES_MIN), OR_MINUTES_MAX)

    results: dict[str, IntradaySnapshot] = {}
    for sym in requested:
        try:
            df = fetch_ohlcv(sym, period=INTRADAY_PERIOD, interval=INTRADAY_INTERVAL)
            snapshot = compute_session_snapshot(df, or_minutes)
            if snapshot is None:
                results[sym] = IntradaySnapshot(error="No intraday data")
                continue
            results[sym] = IntradaySnapshot(**snapshot)
        except Exception as exc:  # noqa: BLE001 — batch must survive any one symbol
            logger.error("Intraday snapshot failed for %s: %s", sym, exc)
            results[sym] = IntradaySnapshot(error=str(exc))

    served = sum(1 for r in results.values() if r.error is None)
    logger.info("Intraday snapshots served for %d/%d symbols", served, len(requested))
    return IntradayResponse(results=results, orMinutes=or_minutes)


@router.get("/intraday/bars", response_model=IntradayBarsResponse)
def get_intraday_bars(symbols: str) -> IntradayBarsResponse:
    """
    Raw 5m bars (~5 sessions incl. today) for the Node ORB paper-trade replay —
    used at settlement to determine which exit (SL / target / square-off) hit first.

    Args:
        symbols: Comma-separated NSE symbols without suffix
    """
    requested = [s.strip().upper() for s in symbols.split(",") if s.strip()][:MAX_SYMBOLS]

    results: dict[str, IntradayBarsEntry] = {}
    for sym in requested:
        try:
            df = fetch_ohlcv(sym, period=INTRADAY_PERIOD, interval=INTRADAY_INTERVAL)
            bars = frame_to_bars(df)
            results[sym] = (
                IntradayBarsEntry(bars=bars)
                if bars
                else IntradayBarsEntry(error="No intraday data")
            )
        except Exception as exc:  # noqa: BLE001 — batch must survive any one symbol
            logger.error("Intraday bars failed for %s: %s", sym, exc)
            results[sym] = IntradayBarsEntry(error=str(exc))

    served = sum(1 for r in results.values() if r.error is None)
    logger.info("Intraday bars served for %d/%d symbols", served, len(requested))
    return IntradayBarsResponse(results=results)
