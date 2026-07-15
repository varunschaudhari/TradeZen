/**
 * @file tradeJournalSearch.js
 * @description Trade journal search and historical comparison
 * Find similar past trades, compare planned vs realized outcomes, extract lessons
 */

import Signal from '../models/Signal.js';
import Trade from '../models/Trade.js';
import { logger } from '../config/logger.js';

/**
 * Search trade journal for similar setups
 * @param {string} symbol - Current stock symbol
 * @param {number} simonScore - Current Simons score
 * @param {string} setupType - Type of setup (MOMENTUM, PULLBACK, etc)
 * @param {number} riskReward - Current R:R ratio
 * @param {string} userId - Whose closed trades to compare against
 * @returns {Promise<Object>} historical similar trades
 */
export async function searchTradeJournal(symbol, simonScore, setupType, riskReward, userId) {
  try {
    // Query for similar trades (past trades on same symbol or similar setup) — shared
    // signal history, not tied to any one user.
    const similarSignals = await Signal.find({
      symbol,
      verdict: { $in: ['BUY', 'WAIT'] },
      createdAt: { $lt: new Date() },
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    // Get this user's own closed trades for realized R:R comparison
    const closedTrades = await Trade.find({
      userId,
      symbol,
      status: 'CLOSED',
    })
      .sort({ exitDate: -1 })
      .limit(10)
      .lean();

    // Score similarity of past trades
    const scoredTrades = similarSignals.map((signal) => ({
      ...signal,
      similarity: calculateSimilarity(simonScore, signal.gatesPassed ?? 0, setupType, riskReward, signal.riskReward),
    }));

    // Get top similar trades
    const topSimilar = scoredTrades
      .filter((t) => t.similarity > 40) // >40% similar
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);

    // Compare planned vs realized for closed trades
    const comparison = compareOutcomes(closedTrades, riskReward);

    // Extract lessons from similar trades
    const lessons = extractLessons(topSimilar, closedTrades);

    return {
      timestamp: new Date(),
      searchCriteria: {
        symbol,
        simonScore,
        setupType,
        riskReward: riskReward.toFixed(2),
      },
      similarTrades: topSimilar.map((t) => ({
        date: t.createdAt,
        symbol: t.symbol,
        verdict: t.verdict,
        simonScore: t.gatesPassed ?? 0,
        plannedRR: (t.riskReward ?? 0).toFixed(2),
        similarity: t.similarity.toFixed(0),
        confidence: t.confidence,
      })),
      outcomeComparison: comparison,
      lessons,
      summary: generateJournalSummary(topSimilar, closedTrades),
    };
  } catch (err) {
    logger.error('Trade journal search failed', { symbol, error: err.message });
    return null;
  }
}

/**
 * Calculate similarity score between current and past trade
 */
function calculateSimilarity(currentScore, pastScore, setupType, currentRR, pastRR) {
  let score = 50; // base

  // Simons score similarity (±10 is 100%)
  const scoreDiff = Math.abs(currentScore - pastScore);
  const scoreMatch = Math.max(0, 100 - scoreDiff * 5);
  score = score * 0.3 + scoreMatch * 0.3;

  // Risk-reward similarity (±0.5 is 100%)
  const rrDiff = Math.abs(currentRR - (pastRR || 0));
  const rrMatch = Math.max(0, 100 - rrDiff * 20);
  score = score + rrMatch * 0.4;

  return Math.min(100, Math.max(0, score));
}

/**
 * Compare planned vs realized outcomes
 */
function compareOutcomes(closedTrades, plannedRR) {
  if (closedTrades.length === 0) {
    return {
      samplSize: 0,
      message: 'No closed trades available for comparison',
    };
  }

  const outcomes = closedTrades.map((trade) => {
    const risk = trade.entryPrice - trade.stopLoss;
    const realizedR = (trade.exitPrice - trade.entryPrice) / risk;

    return {
      symbol: trade.symbol,
      entryDate: trade.entryDate,
      exitDate: trade.exitDate,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      stopLoss: trade.stopLoss,
      realizedPnl: trade.realizedPnl,
      realizedR: realizedR.toFixed(2),
      exitReason: trade.exitReason,
    };
  });

  const realizedRs = outcomes.map((o) => parseFloat(o.realizedR));
  const avgRealized = realizedRs.reduce((a, b) => a + b, 0) / realizedRs.length;
  const winRate = (outcomes.filter((o) => parseFloat(o.realizedR) > 0).length / outcomes.length * 100).toFixed(1);

  return {
    sampleSize: outcomes.length,
    plannedAvgRR: plannedRR.toFixed(2),
    realizedAvgRR: avgRealized.toFixed(2),
    winRate,
    recentTrades: outcomes.slice(0, 3),
    insight: generateOutcomeInsight(plannedRR, avgRealized, winRate),
  };
}

/**
 * Extract lessons from similar trades
 */
function extractLessons(similarTrades, closedTrades) {
  const lessons = [];

  // Lesson 1: Entry timing
  if (similarTrades.length > 0) {
    const avgConfidence = similarTrades.reduce((sum, t) => sum + (t.confidence === 'HIGH' ? 1 : 0), 0) / similarTrades.length;
    if (avgConfidence > 0.8) {
      lessons.push({
        category: 'Entry Timing',
        lesson: 'Similar high-conviction setups tend to work well. Enter when confidence is HIGH.',
        confidence: 'HIGH',
      });
    }
  }

  // Lesson 2: Hold duration
  const avgHoldDays = closedTrades.reduce((sum, t) => {
    const days = (new Date(t.exitDate) - new Date(t.entryDate)) / (1000 * 60 * 60 * 24);
    return sum + days;
  }, 0) / Math.max(closedTrades.length, 1);

  if (avgHoldDays < 7) {
    lessons.push({
      category: 'Hold Duration',
      lesson: `Average holding period is ${avgHoldDays.toFixed(1)} days. Quick exits are typical - don't hold too long.`,
      confidence: 'MEDIUM',
    });
  } else if (avgHoldDays < 15) {
    lessons.push({
      category: 'Hold Duration',
      lesson: `Average holding period is ${avgHoldDays.toFixed(1)} days. Swing trades, not day trades.`,
      confidence: 'MEDIUM',
    });
  }

  // Lesson 3: Exit reasons
  const exitReasons = {};
  closedTrades.forEach((t) => {
    exitReasons[t.exitReason] = (exitReasons[t.exitReason] || 0) + 1;
  });

  const mostCommonExit = Object.entries(exitReasons).sort((a, b) => b[1] - a[1])[0];
  if (mostCommonExit) {
    lessons.push({
      category: 'Exit Strategy',
      lesson: `Most common exit reason: ${mostCommonExit[0]} (${mostCommonExit[1]}/${closedTrades.length} trades). Plan accordingly.`,
      confidence: 'HIGH',
    });
  }

  // Lesson 4: Risk management
  const avgRisk = closedTrades.reduce((sum, t) => sum + Math.abs(t.stopLoss - t.entryPrice), 0) / closedTrades.length;
  if (avgRisk > 0) {
    lessons.push({
      category: 'Risk Management',
      lesson: `Average risk per trade is ₹${avgRisk.toFixed(0)}. Size positions accordingly to keep risk constant.`,
      confidence: 'HIGH',
    });
  }

  // Lesson 5: Win rate
  const winRate = closedTrades.filter((t) => t.realizedPnl > 0).length / closedTrades.length;
  if (winRate < 0.5) {
    lessons.push({
      category: 'Trade Selection',
      lesson: `Historical win rate is ${(winRate * 100).toFixed(0)}%. Be more selective - raise signal quality threshold.`,
      confidence: 'MEDIUM',
    });
  }

  return lessons;
}

/**
 * Generate insight from outcome comparison
 */
function generateOutcomeInsight(planned, realized, winRate) {
  const diff = realized - planned;

  if (diff > 0.5) {
    return `⭐ Excellent: Realized R:R (${realized.toFixed(2)}) exceeds plan (${planned.toFixed(2)}) by ${diff.toFixed(2)}R`;
  } else if (diff > 0) {
    return `✓ Good: Realized R:R (${realized.toFixed(2)}) slightly exceeds plan (${planned.toFixed(2)})`;
  } else if (diff > -0.5) {
    return `→ Inline: Realized R:R (${realized.toFixed(2)}) close to plan (${planned.toFixed(2)})`;
  } else {
    return `⚠️ Below Plan: Realized R:R (${realized.toFixed(2)}) below plan (${planned.toFixed(2)}) by ${Math.abs(diff).toFixed(2)}R`;
  }
}

/**
 * Generate summary from journal search
 */
function generateJournalSummary(similarTrades, closedTrades) {
  const verdict = similarTrades.length > 0 && similarTrades[0].similarity > 80 ? 'STRONG HISTORICAL PRECEDENT' : 'NOVEL SETUP';

  return {
    verdict,
    similarTradesFound: similarTrades.length,
    closedTradesAnalyzed: closedTrades.length,
    recommendation: similarTrades.length > 3 ? 'Sufficient historical data - setup well-tested' : 'Limited historical data - treat as new setup',
  };
}
