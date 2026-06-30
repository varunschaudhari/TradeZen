/**
 * @file monteCarloSimulation.js
 * @description Monte Carlo path simulation for trade outcome probabilities
 * 1000 price path simulations, probability distributions, confidence intervals
 */

import { logger } from '../config/logger.js';

/**
 * Run Monte Carlo simulation for a trade setup
 * @param {number} entry - Entry price
 * @param {number} stopLoss - Stop loss price
 * @param {number} target1 - First target
 * @param {number} target2 - Second target
 * @param {number} currentPrice - Current market price
 * @param {number} volatility - Daily volatility (ATR % or realized vol)
 * @param {number} drift - Expected daily return (default 0.1% for positive drift)
 * @param {number} maxDays - Maximum holding period (15 days default)
 * @param {number} simulations - Number of paths to simulate (1000 default)
 * @returns {Object} simulation results
 */
export function runMonteCarloSimulation(
  entry,
  stopLoss,
  target1,
  target2,
  currentPrice,
  volatility,
  drift = 0.001,
  maxDays = 15,
  simulations = 50
) {
  try {
    const risk = entry - stopLoss;
    const t1Distance = target1 - entry;
    const t2Distance = target2 - entry;

    // Normalize volatility to daily (if provided as %)
    const dailyVolatility = Math.abs(volatility) / 100;

    // Store all paths and outcomes
    const paths = [];
    const outcomes = {
      t1Hits: 0,
      t2Hits: 0,
      slHits: 0,
      manualExits: 0,
      holdDays: [],
      realizedRs: [],
      exitPrices: [],
    };

    // Run simulations
    for (let sim = 0; sim < simulations; sim++) {
      const path = [];
      let price = entry;
      let hitTarget = null;
      let exitDay = null;

      // Simulate daily price movements
      for (let day = 0; day < maxDays; day++) {
        // Geometric Brownian Motion: dS = μ*S*dt + σ*S*dz
        const randomWalk = generateRandomWalk();
        const dailyReturn = drift + dailyVolatility * randomWalk;
        price = price * (1 + dailyReturn);

        path.push(price);

        // Check exit conditions (in order of priority)
        // 1. Stop Loss (worst case first)
        if (price <= stopLoss) {
          hitTarget = 'SL';
          exitDay = day + 1;
          outcomes.slHits++;
          outcomes.realizedRs.push(-1);
          outcomes.exitPrices.push(stopLoss);
          break;
        }

        // 2. Target 2 (full profit)
        if (price >= target2) {
          hitTarget = 'T2';
          exitDay = day + 1;
          outcomes.t2Hits++;
          const realizedR = (target2 - entry) / risk;
          outcomes.realizedRs.push(realizedR);
          outcomes.exitPrices.push(target2);
          break;
        }

        // 3. Target 1 (partial profit, then trail SL to entry)
        if (price >= target1 && hitTarget === null) {
          // After T1, assume trailing SL to entry for second half
          hitTarget = 'T1';
          // Don't exit yet, continue to look for T2 or SL at entry
          if (price <= entry) {
            // Second half hit entry as SL
            exitDay = day + 1;
            const realizedR = ((entry - entry) / 2 + (target1 - entry)) / (2 * risk); // avg of 50/50
            outcomes.t1Hits++;
            outcomes.realizedRs.push(realizedR);
            outcomes.exitPrices.push(entry);
            break;
          }
        }
      }

      // If no exit condition met after maxDays, exit at current price (timeout)
      if (exitDay === null) {
        exitDay = maxDays;
        outcomes.manualExits++;
        const realizedR = (price - entry) / risk;
        outcomes.realizedRs.push(realizedR);
        outcomes.exitPrices.push(price);
      }

      outcomes.holdDays.push(exitDay);
      paths.push({
        path,
        exitDay,
        exitPrice: outcomes.exitPrices[outcomes.exitPrices.length - 1],
        outcome: hitTarget || 'TIMEOUT',
      });
    }

    // Calculate statistics
    const stats = calculateStatistics(outcomes, simulations);

    // Calculate confidence intervals
    const confidenceIntervals = calculateConfidenceIntervals(outcomes.realizedRs);

    // Calculate probability distribution of hold durations
    const holdDistribution = calculateHoldDistribution(outcomes.holdDays);

    return {
      simulation: {
        paths: simulations,
        maxDays,
        entryPrice: entry,
        stopLoss,
        target1,
        target2,
        dailyVolatility: (dailyVolatility * 100).toFixed(2),
      },
      probabilities: {
        t1: ((outcomes.t1Hits / simulations) * 100).toFixed(2),
        t2: ((outcomes.t2Hits / simulations) * 100).toFixed(2),
        sl: ((outcomes.slHits / simulations) * 100).toFixed(2),
        manual: ((outcomes.manualExits / simulations) * 100).toFixed(2),
      },
      outcomes: {
        t1Hits: outcomes.t1Hits,
        t2Hits: outcomes.t2Hits,
        slHits: outcomes.slHits,
        manualExits: outcomes.manualExits,
      },
      statistics: stats,
      confidenceIntervals,
      holdDistribution,
      recommendation: generateMonteCarloRecommendation(stats),
    };
  } catch (err) {
    logger.error('Monte Carlo simulation failed', { error: err.message });
    return null;
  }
}

/**
 * Generate random walk (Box-Muller transform for normal distribution)
 */
function generateRandomWalk() {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Calculate statistics from outcomes
 */
function calculateStatistics(outcomes, simulations) {
  const realizedRs = outcomes.realizedRs;
  const holdDays = outcomes.holdDays;

  // Realized R statistics
  const avgRealizedR = realizedRs.reduce((a, b) => a + b, 0) / realizedRs.length;
  const wins = realizedRs.filter((r) => r > 0).length;
  const losses = realizedRs.filter((r) => r < 0).length;
  const breakevens = realizedRs.filter((r) => r === 0).length;

  const winRate = (wins / realizedRs.length) * 100;
  const avgWinR = realizedRs.filter((r) => r > 0).reduce((a, b) => a + b, 0) / Math.max(wins, 1);
  const avgLossR = realizedRs.filter((r) => r < 0).reduce((a, b) => a + b, 0) / Math.max(losses, 1);

  const profitFactor = wins > 0 && losses > 0 ? avgWinR / Math.abs(avgLossR) : wins > 0 ? 999 : 0;

  // Hold duration statistics
  const avgHoldDays = holdDays.reduce((a, b) => a + b, 0) / holdDays.length;
  const medianHoldDays = holdDays.sort((a, b) => a - b)[Math.floor(holdDays.length / 2)];
  const maxHoldDays = Math.max(...holdDays);
  const minHoldDays = Math.min(...holdDays);

  return {
    realizedR: {
      avg: avgRealizedR.toFixed(2),
      median: median(realizedRs).toFixed(2),
      stdDev: standardDeviation(realizedRs).toFixed(2),
      min: Math.min(...realizedRs).toFixed(2),
      max: Math.max(...realizedRs).toFixed(2),
    },
    winLoss: {
      winRate: winRate.toFixed(1),
      wins,
      losses,
      breakevens,
      avgWinR: avgWinR.toFixed(2),
      avgLossR: avgLossR.toFixed(2),
      profitFactor: profitFactor.toFixed(2),
    },
    holdDuration: {
      avg: avgHoldDays.toFixed(1),
      median: medianHoldDays,
      max: maxHoldDays,
      min: minHoldDays,
    },
  };
}

/**
 * Calculate confidence intervals
 */
function calculateConfidenceIntervals(data) {
  const sorted = [...data].sort((a, b) => a - b);
  const n = sorted.length;

  return {
    ci95_low: sorted[Math.floor(n * 0.025)].toFixed(2),
    ci95_high: sorted[Math.floor(n * 0.975)].toFixed(2),
    ci90_low: sorted[Math.floor(n * 0.05)].toFixed(2),
    ci90_high: sorted[Math.floor(n * 0.95)].toFixed(2),
    percentile_10: sorted[Math.floor(n * 0.1)].toFixed(2),
    percentile_25: sorted[Math.floor(n * 0.25)].toFixed(2),
    percentile_50: sorted[Math.floor(n * 0.5)].toFixed(2),
    percentile_75: sorted[Math.floor(n * 0.75)].toFixed(2),
    percentile_90: sorted[Math.floor(n * 0.9)].toFixed(2),
  };
}

/**
 * Calculate probability distribution of hold durations
 */
function calculateHoldDistribution(holdDays) {
  const distribution = {
    day1_3: holdDays.filter((d) => d >= 1 && d <= 3).length,
    day4_7: holdDays.filter((d) => d >= 4 && d <= 7).length,
    day8_10: holdDays.filter((d) => d >= 8 && d <= 10).length,
    day11_15: holdDays.filter((d) => d >= 11 && d <= 15).length,
  };

  const total = holdDays.length;

  return {
    '1-3 days': {
      count: distribution.day1_3,
      percent: ((distribution.day1_3 / total) * 100).toFixed(1),
    },
    '4-7 days': {
      count: distribution.day4_7,
      percent: ((distribution.day4_7 / total) * 100).toFixed(1),
    },
    '8-10 days': {
      count: distribution.day8_10,
      percent: ((distribution.day8_10 / total) * 100).toFixed(1),
    },
    '11-15 days': {
      count: distribution.day11_15,
      percent: ((distribution.day11_15 / total) * 100).toFixed(1),
    },
  };
}

/**
 * Generate recommendation based on Monte Carlo results
 */
function generateMonteCarloRecommendation(stats) {
  const winRate = parseFloat(stats.winLoss.winRate);
  const profitFactor = parseFloat(stats.winLoss.profitFactor);
  const avgR = parseFloat(stats.realizedR.avg);

  let recommendation = '';
  let confidence = 'LOW';

  if (winRate >= 65 && profitFactor >= 2.0 && avgR > 1.0) {
    recommendation = 'EXCELLENT: High win rate, strong profit factor, and positive expectancy. Proceed with confidence.';
    confidence = 'VERY_HIGH';
  } else if (winRate >= 55 && profitFactor >= 1.5 && avgR > 0.5) {
    recommendation = 'GOOD: Solid win rate and acceptable profit factor. Setup has statistical edge.';
    confidence = 'HIGH';
  } else if (winRate >= 50 && profitFactor >= 1.0 && avgR > 0) {
    recommendation = 'ACCEPTABLE: Marginal edge. Win rate near 50% but positive expectancy. Requires strict discipline.';
    confidence = 'MEDIUM';
  } else if (winRate >= 45 && avgR >= 0) {
    recommendation = 'MARGINAL: Close to breakeven. High variance. Only trade if you have strong conviction from other factors.';
    confidence = 'LOW';
  } else {
    recommendation = 'POOR: Negative expectancy. Avoid this setup or require major confluence factors.';
    confidence = 'VERY_LOW';
  }

  return {
    recommendation,
    confidence,
    reasoning: `Win rate ${winRate.toFixed(1)}%, Profit Factor ${profitFactor.toFixed(2)}, Avg R ${avgR.toFixed(2)}`,
  };
}

/**
 * Helper: calculate median
 */
function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Helper: calculate standard deviation
 */
function standardDeviation(arr) {
  const mean = arr.reduce((a, b) => a + b) / arr.length;
  const squareDiffs = arr.map((val) => Math.pow(val - mean, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b) / arr.length;
  return Math.sqrt(avgSquareDiff);
}
