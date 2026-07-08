"""
File: schemas.py
Description: Pydantic request/response schemas for the Python microservice API
Author: SwingTrader AI Team
Created: 2026-06-13
Last Modified: 2026-06-13
"""

from typing import Optional
from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    """Request body for POST /analyze."""

    symbols: list[str] = Field(..., min_length=1, description="NSE stock symbols to analyze")
    capital: float = Field(default=1_000_000, gt=0, description="Current trading capital in INR")
    riskPct: float = Field(default=1.0, gt=0, le=5, description="Risk percentage per trade")


class IndicatorData(BaseModel):
    """Technical indicator values for a single stock."""

    ema20: Optional[float] = None
    ema50: Optional[float] = None
    ema200: Optional[float] = None
    rsi14: Optional[float] = None
    macd: Optional[float] = None
    macdSignal: Optional[float] = None
    macdHist: Optional[float] = None
    bbUpper: Optional[float] = None
    bbLower: Optional[float] = None
    bbPctB: Optional[float] = None
    atr14: Optional[float] = None
    volRatio: Optional[float] = None
    candlePattern: Optional[str] = None


class SupportResistanceLevel(BaseModel):
    """A single support or resistance price level."""

    price: float
    strength: str = Field(description="strong | moderate | weak")
    method: str = Field(description="swing_high | swing_low | fibonacci | volume_profile")


class FibonacciLevels(BaseModel):
    """Fibonacci retracement levels between swing high and low."""

    fib236: Optional[float] = None
    fib382: Optional[float] = None
    fib50: Optional[float] = None
    fib618: Optional[float] = None
    fib786: Optional[float] = None


class StockAnalysis(BaseModel):
    """Full analysis result for a single stock symbol."""

    symbol: str
    currentPrice: Optional[float] = None
    prevClose: Optional[float] = None
    dayChangePct: Optional[float] = None
    high52w: Optional[float] = None
    low52w: Optional[float] = None
    indicators: Optional[IndicatorData] = None
    supportLevels: list[SupportResistanceLevel] = []
    resistanceLevels: list[SupportResistanceLevel] = []
    fibonacci: Optional[FibonacciLevels] = None
    weeklyTrend: Optional[str] = None  # BULLISH | BEARISH | SIDEWAYS
    earningsTimestamp: Optional[int] = None  # Unix seconds; None = no known upcoming earnings
    suggestedEntry: Optional[float] = None
    suggestedStopLoss: Optional[float] = None
    suggestedTarget1: Optional[float] = None
    suggestedTarget2: Optional[float] = None
    error: Optional[str] = None


class AnalyzeResponse(BaseModel):
    """Response body for POST /analyze."""

    results: list[StockAnalysis]
    analyzedCount: int
    errorCount: int


class StockDetail(StockAnalysis):
    """Full analysis for a single stock plus fundamental metadata — GET /stock/{symbol}."""

    companyName: Optional[str] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    peRatio: Optional[float] = None
    forwardPe: Optional[float] = None
    marketCap: Optional[float] = None
    beta: Optional[float] = None
    dividendYield: Optional[float] = None


class Quote(BaseModel):
    """A lightweight live price snapshot for one symbol."""

    price: Optional[float] = None
    prevClose: Optional[float] = None
    change: Optional[float] = None
    changePct: Optional[float] = None


class QuotesResponse(BaseModel):
    """Response body for GET /quotes — batch price snapshots keyed by symbol."""

    quotes: dict[str, Quote]


class IntradaySnapshot(BaseModel):
    """Latest-session 5m snapshot for one symbol (ORB scanner input)."""

    sessionDate: Optional[str] = None  # YYYY-MM-DD of the session the snapshot covers
    lastPrice: Optional[float] = None
    lastBarTime: Optional[str] = None  # ISO timestamp of the last 5m bar (IST)
    barsCount: Optional[int] = None
    orHigh: Optional[float] = None
    orLow: Optional[float] = None
    orComplete: Optional[bool] = None
    vwap: Optional[float] = None
    cumVolume: Optional[float] = None
    relVolume: Optional[float] = None  # time-of-day-adjusted vs prior sessions
    dayHigh: Optional[float] = None
    dayLow: Optional[float] = None
    error: Optional[str] = None


class IntradayResponse(BaseModel):
    """Response body for GET /intraday — batch session snapshots keyed by symbol."""

    results: dict[str, IntradaySnapshot]
    orMinutes: int


class IntradayBar(BaseModel):
    """One 5m OHLCV bar (time = bar OPEN, ISO, IST)."""

    time: str
    open: float
    high: float
    low: float
    close: float
    volume: float


class IntradayBarsEntry(BaseModel):
    """Per-symbol bar list for GET /intraday/bars."""

    bars: list[IntradayBar] = []
    error: Optional[str] = None


class IntradayBarsResponse(BaseModel):
    """Response body for GET /intraday/bars — raw 5m bars keyed by symbol."""

    results: dict[str, IntradayBarsEntry]


class ScreenRequest(BaseModel):
    """Request body for POST /screen — universe pre-filtering (Step 2)."""

    tiers: Optional[list[str]] = Field(
        default=None,
        description="Index tiers to include; null = all (NIFTY50/NEXT50/MIDCAP150/SMALLCAP100)",
    )
    checkEarnings: bool = Field(
        default=True, description="Apply pre-filter 6 (drop survivors with imminent earnings)"
    )
    extraSymbols: list[str] = Field(
        default_factory=list,
        description="Watchlist overlay — always screened in addition to the universe",
    )


class ScreenCandidate(BaseModel):
    """A single stock that survived all pre-filters."""

    symbol: str
    tier: str
    currentPrice: float
    avgTurnoverInr: float
    rsi14: Optional[float] = None
    atrPct: Optional[float] = None
    rocPct: Optional[float] = None


class ScreenReject(BaseModel):
    """A symbol that was screened out, with its price and the filter that cut it."""

    symbol: str
    tier: str
    currentPrice: Optional[float] = None
    stage: str  # no_data | liquidity | market_cap | trend | momentum | atr | earnings


class ScreenResponse(BaseModel):
    """Response body for POST /screen."""

    candidates: list[ScreenCandidate]
    rejected: list[ScreenReject] = Field(
        default_factory=list, description="Per-symbol screened-out stocks with reason"
    )
    universeCount: int
    screenedCount: int
    candidateCount: int
    rejectionCounts: dict[str, int] = Field(
        default_factory=dict, description="Count of symbols rejected per pre-filter"
    )


class MarketIndex(BaseModel):
    """Data for a single market index (Nifty, Bank Nifty)."""

    price: Optional[float] = None
    change: Optional[float] = None
    changePct: Optional[float] = None
    ema20: Optional[float] = None
    aboveEma20: Optional[bool] = None


class MarketResponse(BaseModel):
    """Response body for GET /market."""

    nifty50: Optional[MarketIndex] = None
    bankNifty: Optional[MarketIndex] = None
    vix: Optional[float] = None
    adRatio: Optional[float] = None
    error: Optional[str] = None
