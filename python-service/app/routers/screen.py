"""
File: screen.py
Description: FastAPI router — POST /screen. Pre-filters the static NSE universe
             (Step 2) down to a candidate shortlist for the Node.js scanner, which
             then runs the heavy /analyze + 8-gate + Claude pipeline only on survivors.
Author: SwingTrader AI Team
Created: 2026-06-19
Last Modified: 2026-06-19
"""

import asyncio
import logging

from fastapi import APIRouter, HTTPException

from app.models.schemas import ScreenRequest, ScreenResponse
from app.services.screener import screen_universe

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/screen", response_model=ScreenResponse)
async def screen_stocks(request: ScreenRequest) -> ScreenResponse:
    """
    Screen the NSE universe with 6 cheap pre-filters and return surviving candidates.

    Pre-filters: liquidity, market-cap tier, trend, momentum, ATR, earnings.
    Per-symbol data failures are absorbed inside the screener (counted, not raised);
    a 503 is returned only if the whole screen crashes.

    Args:
        request: { tiers?, checkEarnings, extraSymbols }

    Returns:
        ScreenResponse with ranked candidates and per-filter rejection counts
    """
    try:
        tiers = tuple(request.tiers) if request.tiers else None
        # screen_universe is synchronous and does thousands of sequential blocking
        # yfinance calls at the EXTENDED tier's scale (~700s) — calling it directly
        # from this async handler would freeze this entire uvicorn worker's event
        # loop for the whole duration (diagnosed 2026-08-04: ~1 in 4 requests hung
        # for ~12min during a scan). to_thread runs it in FastAPI's thread pool
        # instead, so this worker keeps serving other requests concurrently.
        return await asyncio.to_thread(
            screen_universe,
            tiers=tiers,
            check_earnings=request.checkEarnings,
            extra_symbols=request.extraSymbols,
        )
    except Exception as exc:
        logger.error("POST /screen failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail=f"Screen failed: {exc}") from exc
