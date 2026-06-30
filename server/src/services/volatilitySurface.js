/**
 * @file volatilitySurface.js
 * @description Volatility surface analysis - realized vs implied vol, option pricing
 */

import { logger } from '../config/logger.js';

/**
 * Analyze volatility surface and option pricing
 * @param {string} symbol - Stock symbol
 * @param {number} currentPrice - Current market price
 * @param {number} entry - Entry price
 * @param {number} stopLoss - Stop loss price
 * @param {number} target1 - First target
 * @param {number} target2 - Second target
 * @param {number} realizedVolatility - Historical 20-day realized volatility
 * @param {Object} analysis - Full analysis data
 * @returns {Object} volatility surface analysis
 */
export function analyzeVolatilitySurface(
  symbol,
  currentPrice,
  entry,
  stopLoss,
  target1,
  target2,
  realizedVolatility,
  analysis
) {
  try {
    // Estimate implied volatility based on market conditions
    const impliedVol = estimateImpliedVolatility(realizedVolatility, analysis);

    // Calculate IV crush impact
    const ivCrush = calculateIVCrush(impliedVol, analysis);

    // Calculate option prices at key strikes
    const optionPrices = calculateOptionPrices(currentPrice, entry, stopLoss, target1, target2, impliedVol);

    // Generate volatility recommendations
    const recommendations = generateVolatilityRecommendations(realizedVolatility, impliedVol, ivCrush);

    return {
      timestamp: new Date(),
      symbol,
      volatilityAnalysis: {
        realizedVol: (realizedVolatility * 100).toFixed(2),
        impliedVol: (impliedVol * 100).toFixed(2),
        ivPercentile: calculateIVPercentile(impliedVol).toFixed(0),
        volatilityRank: calculateVolatilityRank(impliedVol),
      },
      ivCrush,
      optionPrices,
      keyLevelPricing: calculateKeyLevelPricing(currentPrice, entry, stopLoss, target1, target2, impliedVol),
      recommendations,
      summary: generateVolatilitySummary(realizedVolatility, impliedVol, ivCrush),
    };
  } catch (err) {
    logger.error('Volatility surface analysis failed', { symbol, error: err.message });
    return null;
  }
}

/**
 * Estimate implied volatility from market conditions
 */
function estimateImpliedVolatility(realizedVol, analysis) {
  let impliedVol = realizedVol;

  // Earnings impact - IV rises before earnings
  if (analysis.section14_earnings?.available) {
    const daysToEarnings = analysis.section14_earnings.earnings.daysAway;
    if (daysToEarnings <= 15) {
      // IV premiums 20-40% above realized before earnings
      const premiumMultiplier = 1 + 0.3 * (1 - daysToEarnings / 15);
      impliedVol = realizedVol * premiumMultiplier;
    }
  }

  // (No random jitter — implied vol is derived deterministically from realized vol +
  // the earnings premium so the same inputs always produce the same output.)
  return impliedVol;
}

/**
 * Calculate IV crush impact post-earnings
 */
function calculateIVCrush(impliedVol, analysis) {
  let crushFactor = 0.65; // Standard 35% crush
  let crushExpectation = 'MODERATE';

  if (analysis.section14_earnings?.available) {
    const daysToEarnings = analysis.section14_earnings.earnings.daysAway;

    if (daysToEarnings <= 1) {
      crushFactor = 0.50; // Heavy crush imminent
      crushExpectation = 'SEVERE';
    } else if (daysToEarnings <= 7) {
      crushFactor = 0.55;
      crushExpectation = 'SIGNIFICANT';
    } else if (daysToEarnings <= 15) {
      crushFactor = 0.65;
      crushExpectation = 'MODERATE';
    }
  }

  const postEarningsIV = impliedVol * crushFactor;
  const crushPercentage = ((1 - crushFactor) * 100).toFixed(1);

  return {
    currentIV: (impliedVol * 100).toFixed(2),
    postEarningsIV: (postEarningsIV * 100).toFixed(2),
    crushPercentage,
    crushExpectation,
    crushFactor: crushFactor.toFixed(2),
    warning: `IV expected to fall ${crushPercentage}% post-earnings. Plan for wider spreads and lower premium on exits.`,
  };
}

/**
 * Calculate option prices at key strikes using Black-Scholes
 */
function calculateOptionPrices(currentPrice, entry, stopLoss, target1, target2, impliedVol) {
  const strikeDistance = (x) => {
    const moneyness = x / currentPrice;
    return moneyness > 1 ? 'OTM' : moneyness < 1 ? 'ITM' : 'ATM';
  };

  const priceOption = (strikePrice, isCall = true) => {
    // Simplified Black-Scholes (no time decay for simplicity)
    const intrinsic = isCall ? Math.max(0, currentPrice - strikePrice) : Math.max(0, strikePrice - currentPrice);
    const timeValue = strikePrice * impliedVol * 0.4; // Simplified
    return (intrinsic + timeValue).toFixed(2);
  };

  return {
    callOptions: [
      { strike: entry, price: priceOption(entry, true), status: strikeDistance(entry), description: 'Entry call' },
      { strike: target1, price: priceOption(target1, true), status: strikeDistance(target1), description: 'T1 call' },
      { strike: target2, price: priceOption(target2, true), status: strikeDistance(target2), description: 'T2 call' },
    ],
    putOptions: [
      { strike: stopLoss, price: priceOption(stopLoss, false), status: strikeDistance(stopLoss), description: 'SL put' },
      { strike: entry, price: priceOption(entry, false), status: strikeDistance(entry), description: 'Entry put' },
      { strike: target1, price: priceOption(target1, false), status: strikeDistance(target1), description: 'T1 put' },
    ],
  };
}

/**
 * Calculate key level pricing impact
 */
function calculateKeyLevelPricing(currentPrice, entry, stopLoss, target1, target2, impliedVol) {
  const levels = [
    { name: 'Stop Loss', price: stopLoss, type: 'Support' },
    { name: 'Entry', price: entry, type: 'Resistance' },
    { name: 'Target 1', price: target1, type: 'Resistance' },
    { name: 'Target 2', price: target2, type: 'Resistance' },
  ];

  return levels.map((level) => {
    const distance = Math.abs(level.price - currentPrice);
    const distancePct = (distance / currentPrice) * 100;
    const optionPrice = (distance * impliedVol).toFixed(2);

    return {
      level: level.name,
      price: level.price.toFixed(2),
      distance: distance.toFixed(2),
      distancePct: distancePct.toFixed(2),
      estimatedOptionValue: optionPrice,
      liquidityAssessment: distancePct < 5 ? 'HIGH' : distancePct < 10 ? 'MEDIUM' : 'LOW',
    };
  });
}

/**
 * Calculate IV percentile (0-100 where 100 is highest IV in past year)
 */
function calculateIVPercentile(impliedVol) {
  // Simulated: in production would compare to historical range
  const minVol = 0.12;
  const maxVol = 0.45;
  const percentile = ((impliedVol - minVol) / (maxVol - minVol)) * 100;
  return Math.max(0, Math.min(100, percentile));
}

/**
 * Calculate volatility rank (low/medium/high/extreme)
 */
function calculateVolatilityRank(impliedVol) {
  const asPercentage = impliedVol * 100;

  if (asPercentage > 40) return 'EXTREME';
  if (asPercentage > 30) return 'HIGH';
  if (asPercentage > 20) return 'MEDIUM';
  return 'LOW';
}

/**
 * Generate volatility recommendations
 */
function generateVolatilityRecommendations(realizedVol, impliedVol, ivCrush) {
  const recommendations = [];

  // IV rank recommendation
  const ivPercentile = calculateIVPercentile(impliedVol);
  if (ivPercentile > 70) {
    recommendations.push({
      type: 'HIGH_IV',
      advice: 'IV is historically high - consider selling options or wider SL',
      impact: 'POSITIVE for iron condors, spreads; NEGATIVE for long entries',
    });
  } else if (ivPercentile < 30) {
    recommendations.push({
      type: 'LOW_IV',
      advice: 'IV is historically low - buy options now before expansion',
      impact: 'POSITIVE for long entries; NEGATIVE for short premium',
    });
  }

  // Realized vs Implied
  const ivSpread = impliedVol - realizedVol;
  if (ivSpread > 0.05) {
    recommendations.push({
      type: 'IV_PREMIUM',
      advice: `Implied vol ${(ivSpread * 100).toFixed(1)}% above realized - premium pricing exists`,
      impact: 'CAUTION: Options overpriced; good time to sell',
    });
  }

  // IV crush warning
  if (ivCrush.crushExpectation !== 'MODERATE') {
    recommendations.push({
      type: 'IV_CRUSH_WARNING',
      advice: `${ivCrush.crushExpectation} IV crush expected (${ivCrush.crushPercentage}%)`,
      impact: 'Plan exits before earnings; targets may become harder to reach',
    });
  }

  return recommendations;
}

/**
 * Generate volatility summary
 */
function generateVolatilitySummary(realizedVol, impliedVol, ivCrush) {
  const ivPercentile = calculateIVPercentile(impliedVol);
  const volatilityRank = calculateVolatilityRank(impliedVol);

  return {
    currentEnvironment: `IV rank: ${ivPercentile.toFixed(0)}%ile (${volatilityRank}) - ${volatilityRank === 'HIGH' ? 'Options expensive' : volatilityRank === 'LOW' ? 'Options cheap' : 'Fair pricing'}`,
    postEarningsOutlook: `Post-earnings IV expected to drop to ${ivCrush.postEarningsIV}% (${ivCrush.crushPercentage}% crush)`,
    entryRecommendation:
      ivPercentile > 70
        ? 'CAUTION: Wait for IV compression before entering'
        : ivPercentile < 30
          ? 'FAVORABLE: IV low, good entry point for long positions'
          : 'NEUTRAL: Fair pricing, proceed with standard setup',
  };
}
