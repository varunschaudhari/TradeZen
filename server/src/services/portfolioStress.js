/**
 * @file portfolioStress.js
 * @description Portfolio stress testing and capital adequacy analysis
 * Tests if portfolio can afford simultaneous SL hits and market stress scenarios
 */

import Trade from '../models/Trade.js';
import Config from '../models/Config.js';
import { logger } from '../config/logger.js';

/**
 * Analyze portfolio stress for a new potential trade
 * Shows if portfolio can afford this trade + stress scenarios
 * @param {number} newTradeEntry - Entry price of new trade
 * @param {number} newTradeSL - Stop loss of new trade
 * @param {number} newTradeShares - Share count of new trade
 * @param {string} newTradeSymbol - Symbol of new trade
 * @returns {Promise<Object>} stress test results
 */
export async function analyzePortfolioStress(newTradeEntry, newTradeSL, newTradeShares, newTradeSymbol) {
  try {
    // Fetch config and open trades
    const [config, openTrades] = await Promise.all([
      Config.findOne().lean(),
      Trade.find({ status: 'OPEN' }).lean(),
    ]);

    if (!config) {
      logger.warn('No config found for stress test');
      return null;
    }

    const capital = config.capital ?? 1_000_000;

    // Calculate current portfolio metrics
    const capitalDeployedInOpenTrades = openTrades.reduce((sum, t) => sum + (t.capitalDeployed ?? 0), 0);
    const currentMaxLossIfAllStop = openTrades.reduce((sum, t) => sum + (t.maxLoss ?? 0), 0);
    const availableCapital = capital - capitalDeployedInOpenTrades;

    // New trade metrics
    const newTradeRisk = newTradeEntry - newTradeSL;
    const newTradeMaxLoss = newTradeRisk * newTradeShares;
    const newTradeCapitalRequired = newTradeEntry * newTradeShares;

    // Check if can add new trade
    const canAddNewTrade = availableCapital >= newTradeCapitalRequired;

    // Prepare detailed open trades info
    const openTradesDetail = openTrades.map((t) => ({
      symbol: t.symbol,
      entry: t.entryPrice,
      current: t.currentPrice ?? t.entryPrice,
      sl: t.stopLoss,
      shares: t.shares,
      capitalDeployed: t.capitalDeployed,
      maxLoss: t.maxLoss,
      unrealizedPnl: t.unrealizedPnl ?? 0,
      distanceToSLPct: ((t.currentPrice ?? t.entryPrice) - t.stopLoss) / t.stopLoss * 100,
    }));

    // Stress test scenarios
    const stressScenarios = [
      { name: 'Normal (No stress)', marketDropPct: 0 },
      { name: 'Market -2%', marketDropPct: -2 },
      { name: 'Market -5%', marketDropPct: -5 },
      { name: 'Market -10%', marketDropPct: -10 },
      { name: 'Market -15%', marketDropPct: -15 },
    ];

    const stressResults = stressScenarios.map((scenario) =>
      simulateStressScenario(
        capital,
        capitalDeployedInOpenTrades,
        openTradesDetail,
        newTradeEntry,
        newTradeSL,
        newTradeShares,
        newTradeMaxLoss,
        scenario
      )
    );

    // Assessment
    const assessment = calculatePortfolioAssessment(
      capital,
      capitalDeployedInOpenTrades,
      currentMaxLossIfAllStop,
      newTradeMaxLoss,
      openTrades.length,
      stressResults,
      canAddNewTrade
    );

    return {
      symbol: newTradeSymbol,
      timestamp: new Date(),
      capital: {
        total: capital,
        deployedInOpenTrades: capitalDeployedInOpenTrades,
        availableForNew: availableCapital,
        percentDeployed: ((capitalDeployedInOpenTrades / capital) * 100).toFixed(1),
      },
      openTrades: {
        count: openTrades.length,
        totalMaxLoss: currentMaxLossIfAllStop,
        detail: openTradesDetail,
      },
      newTrade: {
        entry: newTradeEntry,
        stopLoss: newTradeSL,
        shares: newTradeShares,
        risk: newTradeRisk,
        maxLoss: newTradeMaxLoss,
        capitalRequired: newTradeCapitalRequired,
        canAdd: canAddNewTrade,
      },
      stressTests: stressResults,
      assessment,
    };
  } catch (err) {
    logger.error('Portfolio stress analysis failed', { error: err.message });
    return null;
  }
}

/**
 * Simulate a stress scenario
 */
function simulateStressScenario(
  capital,
  deployedOpen,
  openTrades,
  newEntry,
  newSL,
  newShares,
  newMaxLoss,
  scenario
) {
  const marketDropPct = scenario.marketDropPct;

  // Estimate which trades would be stopped out
  // Simplification: trades stop if current price drops more than distance to SL
  const tradesStoppedOut = openTrades.filter((t) => {
    const distancePctToSL = t.distanceToSLPct;
    // If market drops X% and trade has Y% to SL, it stops if X > Y
    return marketDropPct < -distancePctToSL;
  });

  // Calculate total loss in scenario
  const lossFromStoppedTrades = tradesStoppedOut.reduce((sum, t) => sum + t.maxLoss, 0);
  const totalMaxLossInScenario = lossFromStoppedTrades + newMaxLoss;

  // Estimate unrealized loss in remaining trades
  // Simplified: each trade loses (market drop % × capitalDeployed)
  const remainingTrades = openTrades.filter((t) => !tradesStoppedOut.includes(t));
  const unrealizedLossRemaining = remainingTrades.reduce((sum, t) => {
    const loss = t.capitalDeployed * (Math.abs(marketDropPct) / 100);
    return sum - loss; // negative = loss
  }, 0);

  const totalLoss = -totalMaxLossInScenario + unrealizedLossRemaining;
  const remainingCapital = capital + totalLoss;
  const canAfford = remainingCapital > 0;
  const drawdownPct = ((Math.abs(totalLoss) / capital) * 100).toFixed(1);

  return {
    scenario: scenario.name,
    marketDropPct,
    openTradesAtRisk: openTrades.length,
    tradesStoppedOut: tradesStoppedOut.length,
    totalLossInScenario: Math.round(totalLoss),
    remainingCapital: Math.round(remainingCapital),
    drawdownPct,
    canAfford,
    warning: tradesStoppedOut.length > 1 ? `${tradesStoppedOut.length} trades would stop out` : '',
  };
}

/**
 * Calculate portfolio assessment and recommendations
 */
function calculatePortfolioAssessment(
  capital,
  deployedOpen,
  openMaxLoss,
  newMaxLoss,
  openCount,
  stressResults,
  canAddTrade
) {
  const deploymentRatio = deployedOpen / capital;
  const totalMaxLossIfAllStop = openMaxLoss + newMaxLoss;
  const maxLossRatio = totalMaxLossIfAllStop / capital;

  // Can afford 2 SLs simultaneously?
  const twoSLsMaxLoss = openMaxLoss * 2 + newMaxLoss; // worst case: 2 open trades stop + new trade stops
  const canAfford2SLs = capital > twoSLsMaxLoss;

  // Stress test assessment
  const worstStress = stressResults[stressResults.length - 1]; // -15% scenario
  const worstStressCanAfford = worstStress.canAfford;

  let riskLevel = 'LOW';
  let recommendation = '';

  if (!canAddTrade) {
    riskLevel = 'CRITICAL';
    recommendation = 'No capital available. Close positions before entering new trade.';
  } else if (maxLossRatio > 0.3) {
    riskLevel = 'CRITICAL';
    recommendation = 'Excessive max loss exposure (>30% of capital). Reduce position sizes or close trades.';
  } else if (!canAfford2SLs) {
    riskLevel = 'HIGH';
    recommendation = 'Cannot afford 2 simultaneous SL hits. Reduce new position size or close existing trade.';
  } else if (!worstStressCanAfford) {
    riskLevel = 'HIGH';
    recommendation = 'Portfolio at risk in extreme stress (-15% market drop). Monitor closely, tighten SLs.';
  } else if (maxLossRatio > 0.2) {
    riskLevel = 'MEDIUM';
    recommendation = 'Moderate risk exposure. Portfolio can afford this trade, but watch drawdown.';
  } else if (deploymentRatio > 0.7) {
    riskLevel = 'MEDIUM';
    recommendation = 'High capital deployment (>70%). Room to add this trade, but monitor concentration.';
  } else {
    riskLevel = 'LOW';
    recommendation = 'Healthy portfolio balance. Safe to add this trade with standard risk.';
  }

  return {
    canAfford2SLs,
    riskLevel,
    deploymentRatio: (deploymentRatio * 100).toFixed(1),
    maxLossRatio: (maxLossRatio * 100).toFixed(1),
    maxDrawdownInWorstStress: worstStress.drawdownPct,
    canHandleWorstStress: worstStressCanAfford,
    openTradesSafetyScore: calculateSafetyScore(deploymentRatio, maxLossRatio, canAfford2SLs, worstStressCanAfford),
    recommendation,
  };
}

/**
 * Calculate overall safety score (0-100)
 */
function calculateSafetyScore(deploymentRatio, maxLossRatio, canAfford2SLs, canHandleStress) {
  let score = 50; // base

  // Deployment ratio: 0-25 points
  if (deploymentRatio < 0.3) score += 25;
  else if (deploymentRatio < 0.5) score += 20;
  else if (deploymentRatio < 0.7) score += 12;
  else if (deploymentRatio < 0.9) score += 5;

  // Max loss ratio: 0-25 points
  if (maxLossRatio < 0.1) score += 25;
  else if (maxLossRatio < 0.15) score += 20;
  else if (maxLossRatio < 0.2) score += 12;
  else if (maxLossRatio < 0.3) score += 5;

  // Can afford 2 SLs: 0-25 points
  if (canAfford2SLs) score += 25;
  else score += 0;

  // Stress handling: 0-25 points
  if (canHandleStress) score += 25;
  else if (maxLossRatio < 0.25) score += 12;
  else score += 0;

  return Math.min(100, Math.max(0, Math.round(score)));
}
