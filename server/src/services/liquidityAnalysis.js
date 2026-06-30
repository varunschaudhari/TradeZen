/**
 * @file liquidityAnalysis.js
 * @description Liquidity and slippage analysis for entry/exit feasibility
 * Evaluates bid-ask spread, volume profile, and price impact
 */

import { fetchOhlcv } from './pythonBridge.js';
import { logger } from '../config/logger.js';

/**
 * Analyze liquidity for a stock and specific trade levels
 * @param {string} symbol - NSE stock symbol
 * @param {number} currentPrice - Current market price
 * @param {number} entry - Entry price
 * @param {number} stopLoss - Stop loss price
 * @param {number} target1 - First target
 * @param {number} target2 - Second target
 * @returns {Promise<Object>} liquidity analysis report
 */
export async function analyzeLiquidity(symbol, currentPrice, entry, stopLoss, target1, target2) {
  try {
    // Fetch ~3 months of daily OHLCV to analyze volume patterns.
    // ('3mo' is the valid yfinance period — '3m' is rejected and the fetch fails.)
    const ohlcvResponse = await fetchOhlcv(symbol, '3mo', '1d');
    // fetchOhlcv returns { symbol, interval, data: [...] } — extract the bars array.
    // (The old code checked Array.isArray on the response object itself, so this guard
    // always failed and the liquidity section silently returned null.)
    const bars = Array.isArray(ohlcvResponse?.data)
      ? ohlcvResponse.data
      : Array.isArray(ohlcvResponse)
        ? ohlcvResponse
        : [];

    if (bars.length < 20) {
      logger.warn(`Insufficient data for liquidity analysis: ${symbol}`);
      return null;
    }

    // Calculate volume metrics
    const volumes = bars.map((d) => d.volume).filter((v) => v != null && v > 0);
    const avgVolume20d = calculateMean(volumes.slice(-20));
    const todayVolume = volumes[volumes.length - 1];
    const volumeRatio = todayVolume / avgVolume20d;

    // Calculate volatility (ATR as % of price)
    const closes = bars.map((d) => d.close).filter((c) => c != null);
    const highs = bars.map((d) => d.high).filter((h) => h != null);
    const lows = bars.map((d) => d.low).filter((l) => l != null);

    const atr = calculateATR(highs, lows, closes, 14);
    const atrPct = (atr / currentPrice) * 100;

    // Estimate bid-ask spread based on market cap proxy (volume × price)
    const marketCapProxy = avgVolume20d * currentPrice; // rough volume-based liquidity metric
    const estimatedSpreadBps = estimateSpreadBps(marketCapProxy);
    const estimatedSpreadPct = estimatedSpreadBps / 100;

    // Analyze liquidity at each price level
    const entryLiquidity = analyzeLevelLiquidity(entry, currentPrice, avgVolume20d, atrPct);
    const slLiquidity = analyzeLevelLiquidity(stopLoss, currentPrice, avgVolume20d, atrPct);
    const t1Liquidity = analyzeLevelLiquidity(target1, currentPrice, avgVolume20d, atrPct);
    const t2Liquidity = analyzeLevelLiquidity(target2, currentPrice, avgVolume20d, atrPct);

    // Calculate slippage cost in rupees and R units
    const riskPerTrade = entry - stopLoss;
    const slippageCostEntry = currentPrice * estimatedSpreadPct;
    const slippageCostEntryR = slippageCostEntry / riskPerTrade;

    // Overall assessment
    const overallAssessment = calculateLiquidityAssessment({
      volumeRatio,
      estimatedSpreadPct,
      atrPct,
      entryLiquidity,
      slLiquidity,
      t1Liquidity,
      t2Liquidity,
    });

    // Safe to enter assessment
    const safeToEnter = overallAssessment.rating !== 'POOR' && volumeRatio > 0.8 && estimatedSpreadPct < 0.5;

    return {
      symbol,
      timestamp: new Date(),
      volume: {
        todayVolume: Math.round(todayVolume),
        avg20d: Math.round(avgVolume20d),
        ratio: parseFloat(volumeRatio.toFixed(2)),
        assessment: getVolumeAssessment(volumeRatio),
      },
      spread: {
        estimatedPct: parseFloat((estimatedSpreadPct * 100).toFixed(3)),
        estimatedBps: parseFloat(estimatedSpreadBps.toFixed(1)),
        assessment: getSpreadAssessment(estimatedSpreadPct),
      },
      volatility: {
        atrPct: parseFloat(atrPct.toFixed(2)),
        assessment: getVolatilityAssessment(atrPct),
      },
      levelAnalysis: {
        entry: entryLiquidity,
        stopLoss: slLiquidity,
        target1: t1Liquidity,
        target2: t2Liquidity,
      },
      slippage: {
        estimatedCostAtEntry: parseFloat(slippageCostEntry.toFixed(2)),
        estimatedCostInR: parseFloat(slippageCostEntryR.toFixed(2)),
        warningIfGreaterThan: '0.25R',
      },
      overall: {
        rating: overallAssessment.rating,
        score: overallAssessment.score,
        safeToEnter,
        recommendation: overallAssessment.recommendation,
        risk: overallAssessment.riskFactors,
      },
    };
  } catch (err) {
    logger.error('Liquidity analysis failed', { symbol, error: err.message });
    return null;
  }
}

/**
 * Estimate bid-ask spread in basis points based on volume/liquidity
 * @param {number} marketCapProxy - Volume × Price metric
 * @returns {number} spread in basis points
 */
function estimateSpreadBps(marketCapProxy) {
  // Large-cap (high volume): 1-2 bps
  // Mid-cap: 2-5 bps
  // Small-cap: 5-15 bps
  // Illiquid: 15+ bps
  if (marketCapProxy > 500_000_000) return 2; // Large-cap
  if (marketCapProxy > 200_000_000) return 4; // Mid-cap
  if (marketCapProxy > 50_000_000) return 8; // Small-cap
  return 15; // Illiquid
}

/**
 * Get volume assessment based on today vs 20-day average
 */
function getVolumeAssessment(ratio) {
  if (ratio > 1.5) return 'EXCELLENT';
  if (ratio > 1.0) return 'GOOD';
  if (ratio > 0.75) return 'DECENT';
  return 'POOR';
}

/**
 * Get spread assessment
 */
function getSpreadAssessment(spreadPct) {
  if (spreadPct < 0.001) return 'EXCELLENT'; // < 1 bps
  if (spreadPct < 0.003) return 'GOOD'; // < 3 bps
  if (spreadPct < 0.005) return 'DECENT'; // < 5 bps
  return 'POOR';
}

/**
 * Get volatility assessment
 */
function getVolatilityAssessment(atrPct) {
  if (atrPct < 1) return 'LOW';
  if (atrPct < 2) return 'NORMAL';
  if (atrPct < 3.5) return 'ELEVATED';
  return 'HIGH';
}

/**
 * Analyze liquidity at a specific price level
 * Factors: distance from current price, volume at that level, spread impact
 */
function analyzeLevelLiquidity(level, currentPrice, avgVolume, atrPct) {
  const distance = Math.abs(level - currentPrice);
  const distancePct = (distance / currentPrice) * 100;

  // Levels within 1 day's move are easy to hit; beyond 3 days are harder
  let liquidity = 'GOOD';
  if (distancePct < atrPct) {
    liquidity = 'EXCELLENT'; // Within today's expected move
  } else if (distancePct < atrPct * 2) {
    liquidity = 'GOOD'; // Within 2 days
  } else if (distancePct < atrPct * 3) {
    liquidity = 'DECENT'; // Takes 2-3 days
  } else {
    liquidity = 'POOR'; // Far away
  }

  return {
    level: parseFloat(level.toFixed(2)),
    distancePct: parseFloat(distancePct.toFixed(2)),
    liquidity,
  };
}

/**
 * Calculate overall liquidity assessment
 */
function calculateLiquidityAssessment(metrics) {
  const { volumeRatio, estimatedSpreadPct, atrPct, entryLiquidity, slLiquidity, t1Liquidity, t2Liquidity } = metrics;

  let score = 50; // base score

  // Volume contribution (0-25 points)
  if (volumeRatio > 1.5) score += 25;
  else if (volumeRatio > 1.0) score += 20;
  else if (volumeRatio > 0.75) score += 12;
  else if (volumeRatio > 0.5) score += 5;

  // Spread contribution (0-25 points)
  if (estimatedSpreadPct < 0.001) score += 25;
  else if (estimatedSpreadPct < 0.003) score += 20;
  else if (estimatedSpreadPct < 0.005) score += 12;
  else if (estimatedSpreadPct < 0.01) score += 5;

  // Volatility contribution (0-25 points)
  if (atrPct < 1) score += 25;
  else if (atrPct < 2) score += 20;
  else if (atrPct < 3.5) score += 12;
  else if (atrPct < 5) score += 5;

  // Level liquidity contribution (0-25 points)
  const levelScores = [entryLiquidity.liquidity, slLiquidity.liquidity, t1Liquidity.liquidity, t2Liquidity.liquidity];
  const levelPoints = levelScores.filter((l) => l === 'EXCELLENT').length * 6 + levelScores.filter((l) => l === 'GOOD').length * 4 + levelScores.filter((l) => l === 'DECENT').length * 2;
  score += Math.min(levelPoints, 25);

  score = Math.min(100, Math.max(0, score));

  let rating = 'POOR';
  if (score >= 80) rating = 'EXCELLENT';
  else if (score >= 65) rating = 'GOOD';
  else if (score >= 50) rating = 'DECENT';

  const riskFactors = [];
  if (volumeRatio < 0.8) riskFactors.push('Volume below average');
  if (estimatedSpreadPct > 0.005) riskFactors.push('Wide bid-ask spread');
  if (atrPct > 3.5) riskFactors.push('High volatility increases slippage');
  if (entryLiquidity.liquidity === 'POOR') riskFactors.push('Entry level far from current price');
  if (slLiquidity.liquidity === 'POOR') riskFactors.push('Stop loss far from current price');

  let recommendation = '';
  if (rating === 'EXCELLENT') {
    recommendation = 'Safe to enter. Tight spreads, strong volume. Expected slippage minimal.';
  } else if (rating === 'GOOD') {
    recommendation = 'Good liquidity. Can enter with confidence. Monitor volume on pullbacks.';
  } else if (rating === 'DECENT') {
    recommendation = 'Adequate liquidity. Enter cautiously. Use limit orders. Risk slippage at entry.';
  } else {
    recommendation = 'Poor liquidity. Avoid or wait for volume spike. High slippage risk. Use tight SL.';
  }

  return {
    score: Math.round(score),
    rating,
    recommendation,
    riskFactors: riskFactors.length > 0 ? riskFactors : ['No major liquidity concerns'],
  };
}

/**
 * Calculate mean of array
 */
function calculateMean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Calculate ATR (Average True Range)
 */
function calculateATR(highs, lows, closes, period = 14) {
  const tr = [];
  for (let i = 1; i < Math.min(highs.length, lows.length, closes.length); i++) {
    const h = highs[i];
    const l = lows[i];
    const cp = closes[i - 1]; // close from previous bar
    const tr1 = h - l;
    const tr2 = Math.abs(h - cp);
    const tr3 = Math.abs(l - cp);
    tr.push(Math.max(tr1, tr2, tr3));
  }

  if (tr.length < period) return 0;

  let atr = calculateMean(tr.slice(0, period));
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
  }
  return atr;
}
