/**
 * @file riskHeatMap.js
 * @description Risk heat map - visual assessment of all risk factors
 */

import { logger } from '../config/logger.js';

/**
 * Generate risk heat map showing all risk factors
 * @param {Object} analysis - Full analysis report
 * @returns {Object} risk heat map with scores
 */
export function generateRiskHeatMap(analysis) {
  try {
    if (!analysis) return null;

    // Extract data from analysis sections
    const earnings = analysis.section14_earnings;
    const liquidity = analysis.section12_liquidity;
    const portfolio = analysis.section13_portfolioStress;
    const backtest = analysis.section11_backtest;

    // Calculate risk scores (0-100, where 100 = highest risk)
    const riskFactors = {
      earnings: calculateEarningsRisk(earnings),
      liquidity: calculateLiquidityRisk(liquidity),
      portfolio: calculatePortfolioRisk(portfolio),
      volatility: calculateVolatilityRisk(analysis),
      correlation: calculateCorrelationRisk(portfolio),
      backtest: calculateBacktestRisk(backtest),
      gap: calculateGapRisk(earnings),
      concentration: calculateConcentrationRisk(portfolio),
    };

    // Calculate overall risk score
    const overallScore = Math.round(
      Object.values(riskFactors).reduce((a, b) => a + b.score, 0) / Object.keys(riskFactors).length
    );

    // Determine heat level
    let heatLevel = 'LOW';
    let heatColor = '#22c55e';
    if (overallScore >= 70) {
      heatLevel = 'CRITICAL';
      heatColor = '#8b0000';
    } else if (overallScore >= 55) {
      heatLevel = 'HIGH';
      heatColor = '#ef4444';
    } else if (overallScore >= 40) {
      heatLevel = 'MEDIUM';
      heatColor = '#eab308';
    } else if (overallScore >= 25) {
      heatLevel = 'MODERATE';
      heatColor = '#84cc16';
    }

    return {
      timestamp: new Date(),
      overallScore,
      heatLevel,
      heatColor,
      factors: riskFactors,
      recommendation: generateRiskRecommendation(overallScore, riskFactors),
      criticalRisks: identifyCriticalRisks(riskFactors),
    };
  } catch (err) {
    logger.error('Risk heat map generation failed', { error: err.message });
    return null;
  }
}

function calculateEarningsRisk(earnings) {
  if (!earnings || !earnings.available) {
    return { score: 0, label: 'NO DATA', description: 'No earnings within 30 days' };
  }

  let score = 0;
  let label = 'SAFE';

  if (earnings.riskLevel === 'CRITICAL') {
    score = 95;
    label = 'CRITICAL';
  } else if (earnings.riskLevel === 'HIGH') {
    score = 75;
    label = 'HIGH';
  } else if (earnings.riskLevel === 'MEDIUM') {
    score = 50;
    label = 'MEDIUM';
  } else if (earnings.riskLevel === 'LOW') {
    score = 25;
    label = 'LOW';
  }

  return {
    score,
    label,
    description: `Earnings ${earnings.earnings.daysAway} days away. Gap risk: ±${earnings.gapRisk.worstCaseDown.toFixed(1)}%`,
  };
}

function calculateLiquidityRisk(liquidity) {
  if (!liquidity || !liquidity.available) {
    return { score: 50, label: 'UNKNOWN', description: 'Unable to assess liquidity' };
  }

  let score = 0;
  let label = 'GOOD';

  if (liquidity.overall.rating === 'EXCELLENT') {
    score = 5;
    label = 'MINIMAL';
  } else if (liquidity.overall.rating === 'GOOD') {
    score = 15;
    label = 'LOW';
  } else if (liquidity.overall.rating === 'DECENT') {
    score = 40;
    label = 'MODERATE';
  } else if (liquidity.overall.rating === 'POOR') {
    score = 80;
    label = 'HIGH';
  }

  const spread = liquidity.spread.estimatedPct;
  const volume = liquidity.volume.ratio;

  return {
    score,
    label,
    description: `Spread: ${spread}% | Volume ratio: ${volume.toFixed(2)}x | Safe entry: ${liquidity.overall.safeToEnter ? 'YES' : 'NO'}`,
  };
}

function calculatePortfolioRisk(portfolio) {
  if (!portfolio || !portfolio.available) {
    return { score: 50, label: 'UNKNOWN', description: 'Unable to assess portfolio risk' };
  }

  const deployment = parseFloat(portfolio.capital.percentDeployed);
  const canAfford2SLs = portfolio.assessment.canAfford2SLs;
  const riskLevel = portfolio.assessment.riskLevel;

  let score = 0;
  let label = 'LOW';

  if (riskLevel === 'CRITICAL') {
    score = 90;
    label = 'CRITICAL';
  } else if (riskLevel === 'HIGH') {
    score = 70;
    label = 'HIGH';
  } else if (riskLevel === 'MEDIUM') {
    score = 45;
    label = 'MEDIUM';
  } else if (riskLevel === 'LOW') {
    score = 15;
    label = 'LOW';
  }

  return {
    score,
    label,
    description: `Deployment: ${deployment}% | Can afford 2 SLs: ${canAfford2SLs ? 'YES' : 'NO'} | Safety: ${portfolio.assessment.safetyScore}/100`,
  };
}

function calculateVolatilityRisk(analysis) {
  const atr = analysis.section1_timeframe?.atr_pct ?? 1.5;
  const liquidity = analysis.section12_liquidity;
  const volatility = liquidity?.volatility;

  let score = 0;
  let label = 'NORMAL';

  if (volatility?.assessment === 'HIGH') {
    score = 70;
    label = 'HIGH';
  } else if (volatility?.assessment === 'ELEVATED') {
    score = 45;
    label = 'ELEVATED';
  } else if (volatility?.assessment === 'NORMAL') {
    score = 20;
    label = 'NORMAL';
  } else if (volatility?.assessment === 'LOW') {
    score = 10;
    label = 'LOW';
  }

  return {
    score,
    label,
    description: `ATR: ${volatility?.atrPct ?? atr}%. High volatility increases slippage and stop hunt risk.`,
  };
}

function calculateCorrelationRisk(portfolio) {
  if (!portfolio || !portfolio.openTrades?.trades) {
    return { score: 10, label: 'LOW', description: 'No open trades. Correlation risk minimal.' };
  }

  const openTrades = portfolio.openTrades.trades;
  if (openTrades.length === 0) {
    return { score: 10, label: 'LOW', description: 'No open trades. Correlation risk minimal.' };
  }

  // Risk increases with more open trades in portfolio
  // If all correlated (tech sector), risk is higher
  let score = Math.min(openTrades.length * 15, 75);
  let label = 'LOW';

  if (openTrades.length >= 3) {
    score = 60;
    label = 'MEDIUM';
  }

  return {
    score,
    label,
    description: `${openTrades.length} open trades. Risk of correlation between positions.`,
  };
}

function calculateBacktestRisk(backtest) {
  if (!backtest || !backtest.available) {
    return { score: 50, label: 'UNKNOWN', description: 'Insufficient backtest data' };
  }

  let score = 0;
  let label = 'GOOD';

  if (backtest.assessment.rating === 'EXCELLENT') {
    score = 5;
    label = 'MINIMAL';
  } else if (backtest.assessment.rating === 'GOOD') {
    score = 15;
    label = 'LOW';
  } else if (backtest.assessment.rating === 'DECENT') {
    score = 40;
    label = 'MODERATE';
  } else if (backtest.assessment.rating === 'POOR') {
    score = 75;
    label = 'HIGH';
  }

  return {
    score,
    label,
    description: `Historical win rate: ${backtest.stats.winRate}%. Setup has ${backtest.stats.totalTrades} past trades.`,
  };
}

function calculateGapRisk(earnings) {
  if (!earnings || !earnings.available) {
    return { score: 10, label: 'LOW', description: 'No immediate gap risk' };
  }

  // Earnings gap risk only applies when an earnings event falls WITHIN the trade window.
  // If earnings already passed (daysAway < 0) or is beyond a typical swing hold, the
  // historical move size carries no forward gap risk for this trade.
  const daysAway = earnings.earnings?.daysAway;
  if (daysAway == null || daysAway < 0 || daysAway > 20) {
    return {
      score: 10,
      label: 'LOW',
      description: `No earnings within the trade window (earnings ${daysAway ?? 'n/a'} days away).`,
    };
  }

  const gapSize = Math.abs(earnings.gapRisk.worstCaseDown);
  let score = 0;
  let label = 'LOW';

  if (earnings.riskLevel === 'CRITICAL') {
    score = 85;
    label = 'CRITICAL';
  } else if (gapSize > 5) {
    score = 60;
    label = 'HIGH';
  } else if (gapSize > 3) {
    score = 40;
    label = 'MODERATE';
  }

  return {
    score,
    label,
    description: `Potential gap: ±${gapSize.toFixed(1)}%. Earnings in ${earnings.earnings.daysAway} days.`,
  };
}

function calculateConcentrationRisk(portfolio) {
  if (!portfolio || !portfolio.openTrades?.trades) {
    return { score: 10, label: 'LOW', description: 'Single position. No concentration risk.' };
  }

  const totalCapital = portfolio.capital.total;
  const deployed = portfolio.capital.deployed;
  const concentrationRatio = (deployed / totalCapital) * 100;

  let score = 0;
  let label = 'LOW';

  if (concentrationRatio > 80) {
    score = 75;
    label = 'CRITICAL';
  } else if (concentrationRatio > 70) {
    score = 60;
    label = 'HIGH';
  } else if (concentrationRatio > 50) {
    score = 40;
    label = 'MODERATE';
  }

  return {
    score,
    label,
    description: `${concentrationRatio.toFixed(0)}% of capital deployed. High concentration in single/few trades.`,
  };
}

function generateRiskRecommendation(overallScore, riskFactors) {
  if (overallScore >= 70) {
    return 'CRITICAL: Do not trade. Reduce exposure immediately. Address multiple risk factors.';
  } else if (overallScore >= 55) {
    return 'HIGH: Trade with caution. Reduce position size. Tighten stops. Monitor closely.';
  } else if (overallScore >= 40) {
    return 'MEDIUM: Acceptable risk. Standard position sizing. Normal stop management.';
  } else if (overallScore >= 25) {
    return 'LOW: Safe to trade. All risk factors under control. Normal execution.';
  }
  return 'MINIMAL: Excellent risk profile. Can proceed with confidence.';
}

function identifyCriticalRisks(riskFactors) {
  return Object.entries(riskFactors)
    .filter(([_, risk]) => risk.score >= 60)
    .map(([name, risk]) => ({
      factor: name.charAt(0).toUpperCase() + name.slice(1),
      score: risk.score,
      label: risk.label,
      description: risk.description,
    }));
}
