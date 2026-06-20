"""
File: support_resistance.py
Description: Swing-based support/resistance detection via scipy argrelextrema,
             level clustering by proximity, strength rating, and Fibonacci retracement
Author: SwingTrader AI Team
Created: 2026-06-13
Last Modified: 2026-06-13
"""

import logging

import numpy as np
import pandas as pd
from scipy.signal import argrelextrema

from app.config import CLUSTER_PCT, MAX_SR_LEVELS, SWING_ORDER
from app.models.schemas import FibonacciLevels, SupportResistanceLevel

logger = logging.getLogger(__name__)

FIB_RATIOS: dict[str, float] = {
    "fib236": 0.236,
    "fib382": 0.382,
    "fib50": 0.500,
    "fib618": 0.618,
    "fib786": 0.786,
}

LOOKBACK_BARS: int = 60   # swing high/low search window for Fibonacci anchor


def _cluster_levels(prices: np.ndarray) -> list[tuple[float, int]]:
    """
    Merge swing prices that fall within CLUSTER_PCT of each other into one level.
    Strength is the number of touches merged into a cluster.

    Args:
        prices: Array of raw swing high or swing low prices

    Returns:
        List of (representative_price, touch_count) tuples, sorted ascending by price
    """
    if len(prices) == 0:
        return []

    sorted_prices = np.sort(prices)
    clusters: list[list[float]] = []

    for price in sorted_prices:
        merged = False
        for cluster in clusters:
            rep = float(np.mean(cluster))
            if rep > 0 and abs(price - rep) / rep < CLUSTER_PCT:
                cluster.append(float(price))
                merged = True
                break
        if not merged:
            clusters.append([float(price)])

    return [(round(float(np.mean(c)), 2), len(c)) for c in clusters]


def _strength_label(touch_count: int) -> str:
    """
    Map touch count to a human-readable strength label.

    Args:
        touch_count: Number of times price revisited this level

    Returns:
        'strong' | 'moderate' | 'weak'
    """
    if touch_count >= 3:
        return "strong"
    if touch_count == 2:
        return "moderate"
    return "weak"


def find_support_resistance(
    df: pd.DataFrame,
) -> tuple[list[SupportResistanceLevel], list[SupportResistanceLevel]]:
    """
    Find significant support and resistance levels from daily OHLCV using
    local extrema detection followed by proximity clustering.

    Algorithm:
        1. argrelextrema on the Low series  → swing low candidates (support)
        2. argrelextrema on the High series → swing high candidates (resistance)
        3. Cluster nearby levels (within CLUSTER_PCT) to eliminate duplicates
        4. Filter: supports below current price, resistances above
        5. Sort by strength desc then proximity to current price
        6. Return top MAX_SR_LEVELS per side

    Args:
        df: Daily OHLCV DataFrame with normalized lowercase column names

    Returns:
        (support_levels, resistance_levels) — each a list of SupportResistanceLevel,
        or ([], []) on any failure
    """
    try:
        current_price = float(df["close"].iloc[-1])
        lows = df["low"].values.astype(float)
        highs = df["high"].values.astype(float)

        support_idx = argrelextrema(lows, np.less, order=SWING_ORDER)[0]
        resistance_idx = argrelextrema(highs, np.greater, order=SWING_ORDER)[0]

        support_clusters = _cluster_levels(lows[support_idx])
        resistance_clusters = _cluster_levels(highs[resistance_idx])

        # Only keep levels on the correct side of current price
        support_clusters = [(p, c) for p, c in support_clusters if p < current_price]
        resistance_clusters = [(p, c) for p, c in resistance_clusters if p > current_price]

        # Sort: strongest first, then closest to current price
        support_clusters.sort(key=lambda x: (-x[1], abs(x[0] - current_price)))
        resistance_clusters.sort(key=lambda x: (-x[1], abs(x[0] - current_price)))

        supports = [
            SupportResistanceLevel(price=p, strength=_strength_label(c), method="swing_low")
            for p, c in support_clusters[:MAX_SR_LEVELS]
        ]
        resistances = [
            SupportResistanceLevel(price=p, strength=_strength_label(c), method="swing_high")
            for p, c in resistance_clusters[:MAX_SR_LEVELS]
        ]

        return supports, resistances

    except Exception as exc:
        logger.error("find_support_resistance failed: %s", exc, exc_info=True)
        return [], []


def find_swing_high_low(df: pd.DataFrame) -> tuple[float, float]:
    """
    Return the highest High and lowest Low within the last LOOKBACK_BARS.
    These are used as anchor points for Fibonacci retracement.

    Args:
        df: OHLCV DataFrame with normalized column names

    Returns:
        (swing_high, swing_low) tuple of floats
    """
    recent = df.tail(LOOKBACK_BARS)
    return float(recent["high"].max()), float(recent["low"].min())


def compute_fibonacci(swing_high: float, swing_low: float) -> FibonacciLevels:
    """
    Compute standard Fibonacci retracement levels between a swing high and low.

    Levels are calculated as: high - (ratio × range), representing how far
    price has pulled back from the high toward the low.

    Args:
        swing_high: Most recent significant swing high price
        swing_low: Most recent significant swing low price

    Returns:
        FibonacciLevels with 23.6%, 38.2%, 50%, 61.8%, 78.6% levels.
        Returns empty FibonacciLevels if inputs are invalid (high ≤ low).
    """
    if swing_high <= swing_low or swing_high <= 0:
        logger.warning("Invalid Fibonacci inputs: high=%.2f low=%.2f", swing_high, swing_low)
        return FibonacciLevels()

    diff = swing_high - swing_low
    return FibonacciLevels(
        fib236=round(swing_high - FIB_RATIOS["fib236"] * diff, 2),
        fib382=round(swing_high - FIB_RATIOS["fib382"] * diff, 2),
        fib50=round(swing_high - FIB_RATIOS["fib50"] * diff, 2),
        fib618=round(swing_high - FIB_RATIOS["fib618"] * diff, 2),
        fib786=round(swing_high - FIB_RATIOS["fib786"] * diff, 2),
    )
