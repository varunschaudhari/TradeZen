/**
 * @file earningsAnalysis.js
 * @description Earnings impact analysis and IV crush modeling
 * Analyzes historical earnings moves and adjusts targets for volatility crush
 */

import Signal from '../models/Signal.js';
import { logger } from '../config/logger.js';
import { EARNINGS_BUFFER_DAYS, EARNINGS_WARNING_DAYS } from '../config/constants.js';

/**
 * Analyze earnings impact and adjust trade levels
 * @param {string} symbol - NSE stock symbol
 * @param {number|null} earningsTimestamp - Earnings date as timestamp
 * @param {number} entry - Entry price
 * @param {number} target1 - First target
 * @param {number} target2 - Second target
 * @param {number} currentPrice - Current market price
 * @param {number} atr - Average True Range for volatility
 * @returns {Promise<Object>} earnings analysis report
 */
export async function analyzeEarningsImpact(
  symbol,
  earningsTimestamp,
  entry,
  target1,
  target2,
  currentPrice,
  atr
) {
  try {
    if (!earningsTimestamp) {
      return {
        status: 'NO_EARNINGS',
        message: 'No earnings date found within 30 days',
        available: false,
      };
    }

    const now = new Date();
    // earningsTimestamp is a Unix timestamp in SECONDS (×1000 → ms). Treating it as ms
    // put the date in 1970 and produced daysToEarnings ≈ -20611 → a false CRITICAL.
    const earningsDate = new Date(earningsTimestamp * 1000);
    const daysToEarnings = Math.ceil((earningsDate - now) / (1000 * 60 * 60 * 24));

    // Risk level based on days to earnings (only UPCOMING earnings are a forward risk —
    // a date already in the past carries no gap risk for this trade).
    let riskLevel = 'SAFE';
    let tradingAdvice = 'OK';

    if (daysToEarnings < 0) {
      riskLevel = 'SAFE';
      tradingAdvice = 'OK';
    } else if (daysToEarnings <= 1) {
      riskLevel = 'CRITICAL';
      tradingAdvice = 'AVOID';
    } else if (daysToEarnings <= EARNINGS_BUFFER_DAYS) {
      riskLevel = 'HIGH';
      tradingAdvice = 'CAUTION';
    } else if (daysToEarnings <= EARNINGS_WARNING_DAYS) {
      riskLevel = 'MEDIUM';
      tradingAdvice = 'CAUTION';
    }

    // Fetch historical earnings moves
    const historicalMoves = await fetchHistoricalEarningsMoves(symbol);

    // Estimate IV crush
    const atrPct = (atr / currentPrice) * 100;
    const ivCrushEstimate = estimateIVCrush(atrPct, historicalMoves);

    // Adjust targets for IV crush
    const adjustedTargets = adjustTargetsForIVCrush(entry, target1, target2, ivCrushEstimate.crushPct);

    // Calculate gap risk (worst-case gap on earnings)
    const gapRisk = calculateGapRisk(historicalMoves);

    // Trading recommendations
    const recommendation = generateEarningsRecommendation(
      daysToEarnings,
      riskLevel,
      historicalMoves,
      gapRisk,
      adjustedTargets
    );

    return {
      status: 'SUCCESS',
      available: true,
      earnings: {
        date: earningsDate.toISOString().split('T')[0],
        daysAway: daysToEarnings,
        timeOfDay: estimateEarningsTime(earningsDate),
      },
      riskAssessment: {
        level: riskLevel,
        tradingAdvice,
        daysBuffer: EARNINGS_BUFFER_DAYS,
        daysWarning: EARNINGS_WARNING_DAYS,
      },
      historicalMoveRange: {
        avgUpMove: historicalMoves.avgUpMove,
        avgDownMove: historicalMoves.avgDownMove,
        maxMove: historicalMoves.maxMove,
        minMove: historicalMoves.minMove,
        sampleSize: historicalMoves.sampleSize,
        moveFrequency: {
          up: historicalMoves.upCount,
          down: historicalMoves.downCount,
        },
      },
      volatility: {
        currentAtrPct: parseFloat(atrPct.toFixed(2)),
        preEarningsEstimate: parseFloat((atrPct * (1 + ivCrushEstimate.preEarningsMultiplier / 100)).toFixed(2)),
        postEarningsEstimate: parseFloat((atrPct * ivCrushEstimate.crushPct).toFixed(2)),
        ivCrushPct: parseFloat(ivCrushEstimate.crushPct.toFixed(2)),
        crushReason: 'Implied volatility typically drops post-earnings as uncertainty resolves',
      },
      adjustedTargets: {
        original: {
          t1: target1,
          t2: target2,
        },
        adjusted: {
          t1: adjustedTargets.t1,
          t2: adjustedTargets.t2,
        },
        adjustment: {
          t1Reduction: parseFloat(((adjustedTargets.t1 - target1) / target1 * 100).toFixed(2)),
          t2Reduction: parseFloat(((adjustedTargets.t2 - target2) / target2 * 100).toFixed(2)),
        },
      },
      gapRisk: {
        estimatedWorstCaseDown: parseFloat(gapRisk.worstCaseDown.toFixed(2)),
        estimatedWorstCaseUp: parseFloat(gapRisk.worstCaseUp.toFixed(2)),
        safeSLBelow: parseFloat(gapRisk.safeSLBelow.toFixed(2)),
        gapWarning: gapRisk.canGap,
      },
      recommendation: {
        shouldTrade: recommendation.shouldTrade,
        strategy: recommendation.strategy,
        adjustedSL: recommendation.adjustedSL,
        notes: recommendation.notes,
        suggestedWaitUntil: recommendation.waitUntil,
      },
    };
  } catch (err) {
    logger.error('Earnings impact analysis failed', { symbol, error: err.message });
    return {
      status: 'ERROR',
      message: 'Unable to analyze earnings impact',
      available: false,
    };
  }
}

/**
 * Fetch historical earnings moves for a symbol
 */
async function fetchHistoricalEarningsMoves(symbol) {
  try {
    // Query signals near earnings dates to estimate historical moves
    // For now, use default estimates based on market data
    // In production, would analyze past earnings announcements

    // Typical earnings move ranges by sector
    // Tech/Finance: 3-5%
    // Pharma/FMCG: 2-3%
    // Auto/Metals: 2-4%
    // Default: 2.5-3.5%

    const defaultMoves = {
      avgUpMove: 3.2,
      avgDownMove: -2.8,
      maxMove: 7.5,
      minMove: 0.5,
      sampleSize: 4, // typical: 4 earnings per year
      upCount: 2,
      downCount: 2,
    };

    return defaultMoves;
  } catch (err) {
    logger.warn('Could not fetch historical earnings moves', { symbol, error: err.message });
    return {
      avgUpMove: 3.0,
      avgDownMove: -2.5,
      maxMove: 7.0,
      minMove: 0.5,
      sampleSize: 0,
      upCount: 0,
      downCount: 0,
    };
  }
}

/**
 * Estimate IV crush effect on volatility
 * IV typically drops 30-50% post-earnings as uncertainty resolves
 */
function estimateIVCrush(atrPct, historicalMoves) {
  // Pre-earnings IV typically elevated 20-40% above normal
  const preEarningsMultiplier = 25; // +25% above normal

  // Post-earnings IV crushes to ~60-70% of pre-earnings level
  const crushFactor = 0.65; // keep 65% of post-earnings move potential

  return {
    preEarningsMultiplier,
    crushPct: crushFactor,
    crushPercentage: ((1 - crushFactor) * 100).toFixed(1),
    explanation: `IV crush estimates targets will reach ~${(crushFactor * 100).toFixed(0)}% of pre-earnings potential`,
  };
}

/**
 * Adjust targets for IV crush
 */
function adjustTargetsForIVCrush(entry, t1, t2, crushFactor) {
  const t1Distance = t1 - entry;
  const t2Distance = t2 - entry;

  return {
    t1: entry + t1Distance * crushFactor,
    t2: entry + t2Distance * crushFactor,
  };
}

/**
 * Calculate gap risk for earnings
 */
function calculateGapRisk(historicalMoves) {
  const worstCaseUp = historicalMoves.maxMove;
  const worstCaseDown = -historicalMoves.maxMove;

  return {
    worstCaseUp: worstCaseUp,
    worstCaseDown: worstCaseDown,
    canGap: true,
    safeSLBelow: worstCaseDown * 1.2, // add 20% safety margin
  };
}

/**
 * Estimate what time earnings will be announced
 */
function estimateEarningsTime(earningsDate) {
  // NSE typically announces after market hours (15:30 onwards)
  // For BSE/NSE, earnings can be anytime during 09:15 - 15:30 or after
  // Default assumption: after hours

  const hour = earningsDate.getHours();
  if (hour >= 15 && hour <= 24) {
    return 'After market close (likely 15:30+)';
  } else if (hour >= 0 && hour <= 9) {
    return 'Before market open (likely 08:00-09:15)';
  } else {
    return 'During market hours (09:15-15:30)';
  }
}

/**
 * Generate trading recommendation based on earnings analysis
 */
function generateEarningsRecommendation(daysToEarnings, riskLevel, historicalMoves, gapRisk, adjustedTargets) {
  let shouldTrade = 'OK';
  let strategy = '';
  let adjustedSL = null;
  let notes = [];
  let waitUntil = null;

  if (daysToEarnings <= 1) {
    shouldTrade = 'AVOID';
    strategy = 'Do not trade. Gap risk too high (earnings announcement imminent).';
    notes.push('Gap can move stock 5-7% overnight. SL will likely be hit or gapped.');
    notes.push('Wait 1-2 days post-earnings for volatility to settle.');
    waitUntil = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  } else if (daysToEarnings <= 15) {
    shouldTrade = 'CAUTION';
    strategy = 'Trade with wider stop loss to account for earnings volatility.';
    notes.push(`Historical earnings move: +${historicalMoves.avgUpMove}% / ${historicalMoves.avgDownMove}%`);
    notes.push(
      `Worst-case gap: ${gapRisk.worstCaseDown.toFixed(1)}% down / +${gapRisk.worstCaseUp.toFixed(1)}% up`
    );
    notes.push('Consider IV crush: targets adjusted downward by ~35%');
    notes.push('Use tight trailing stops pre-earnings, wider SL if holding through');
    adjustedSL = gapRisk.safeSLBelow;
  } else if (daysToEarnings <= 20) {
    shouldTrade = 'CAUTION';
    strategy = 'Earnings in 15-20 days. Can trade but be aware of upcoming event.';
    notes.push('Days to earnings: ' + daysToEarnings);
    notes.push('Plan exit or wider SL before earnings announcement.');
    notes.push('Consider booking profits 1-2 days before earnings.');
  } else {
    shouldTrade = 'OK';
    strategy = 'Safe to trade. Earnings >20 days away, low immediate impact.';
    notes.push('No urgent earnings risk. Normal position sizing applies.');
  }

  return {
    shouldTrade,
    strategy,
    adjustedSL,
    notes,
    waitUntil,
  };
}
