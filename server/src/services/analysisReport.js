/**
 * @file analysisReport.js
 * @description Generate comprehensive 10-section analysis reports for single stocks
 * Includes: timeframe, confidence breakdown, risk metrics, scenarios, trailing stops,
 * earnings risk, patterns, market impact, profit strategy
 */

import Signal from '../models/Signal.js';
import Trade from '../models/Trade.js';
import { fetchStockDetail, fetchMarketData, fetchNiftySeries } from './pythonBridge.js';
import { calculateSimonsSignals, fetchSymbolHistory } from './simonsSignals.js';
import { runAllGates, calculateCompositeScore } from './gateChecker.js';
import { backtestSetup } from './backtestEngine.js';
import { analyzeLiquidity } from './liquidityAnalysis.js';
import { analyzePortfolioStress } from './portfolioStress.js';
import { analyzeEarningsImpact } from './earningsAnalysis.js';
import { generateExecutionChecklist, generateChecklistText } from './executionChecklist.js';
import { generateRiskHeatMap } from './riskHeatMap.js';
import { generatePriceLevelHeatMap } from './priceLevelHeatMap.js';
import { generatePeerComparison } from './peerComparison.js';
import { generateAlertsConfiguration } from './alertsConfiguration.js';
import { runMonteCarloSimulation } from './monteCarloSimulation.js';
import { searchTradeJournal } from './tradeJournalSearch.js';
import { analyzeSectorMomentum } from './sectorMomentum.js';
import { analyzeVolatilitySurface } from './volatilitySurface.js';
import { upsertStockDetail } from './stockMaster.js';
import { logger } from '../config/logger.js';

/**
 * Generate a 10-section comprehensive analysis report for a stock
 * @param {string} symbol - NSE stock symbol
 * @param {object} marketData - Current market context
 * @returns {Promise<object>} Full analysis report
 */
// In-memory per-symbol report cache. The report is expensive (2-year backtest replay +
// several Python data fetches); within a few minutes the underlying data barely moves,
// so caching makes re-opens instant and shields the Python service from repeat load.
const REPORT_CACHE_TTL_MS = 5 * 60 * 1000;
const reportCache = new Map(); // symbol -> { report, at }

/**
 * Compute the canonical "Simons" composite score (0–100) fresh from current data.
 * The Python /stock endpoint doesn't carry it — only the scan pipeline computes it — so
 * the report derives it here: run the 10 Simons signals over 1y history, merge the
 * relative-strength/volume/momentum enrichment into the stock data, then score it with
 * the canonical calculateCompositeScore. Degrades to score 0 gracefully on any failure.
 *
 * @param {string} symbol
 * @param {object} detail - stock detail from fetchStockDetail
 * @param {object|null} marketData
 * @returns {Promise<{ score:number, scoreConfidence:string, breakdown:object[], tags:string[] }>}
 */
async function computeSimonsComposite(symbol, detail, marketData) {
  try {
    const [hist, nifty] = await Promise.all([
      fetchSymbolHistory(symbol),
      fetchNiftySeries('1y').catch(() => ({ closes: [] })),
    ]);
    const simons = calculateSimonsSignals({
      indicators: detail.indicators ?? {},
      currentPrice: detail.currentPrice,
      high52w: detail.high52w,
      closes: hist?.closes,
      highs: hist?.highs,
      lows: hist?.lows,
      volumes: hist?.volumes,
      niftyCloses: nifty?.closes,
    });
    const enriched = { ...detail, ...simons.enrichment };
    const { score, scoreConfidence, breakdown } = calculateCompositeScore(
      enriched,
      marketData ?? {},
      null
    );
    return { score, scoreConfidence, breakdown, tags: simons.tags };
  } catch (err) {
    logger.warn('computeSimonsComposite failed — defaulting score to 0', {
      symbol,
      error: err.message,
    });
    return { score: 0, scoreConfidence: 'LOW', breakdown: [], tags: [] };
  }
}

export async function generateAnalysisReport(symbol, marketData = null) {
  const cached = reportCache.get(symbol);
  if (cached && Date.now() - cached.at < REPORT_CACHE_TTL_MS) {
    return { ...cached.report, cached: true, cacheAgeMs: Date.now() - cached.at };
  }
  try {
    // Fetch market data (unless supplied), stock detail, and latest signal CONCURRENTLY.
    // Market data is fetched here (not in the route) so cache hits skip it entirely, and
    // in parallel with stock detail so it doesn't add to cold-call latency.
    const [resolvedMarket, detail, latestSignal] = await Promise.all([
      marketData ? Promise.resolve(marketData) : fetchMarketData().catch(() => null),
      fetchStockDetail(symbol),
      Signal.findOne({ symbol }).sort({ createdAt: -1 }).lean(),
    ]);
    marketData = resolvedMarket;

    if (!detail) {
      throw new Error(`No analysis data for ${symbol}`);
    }

    const ind = detail.indicators ?? {};
    const price = detail.currentPrice;
    const entry = latestSignal?.entryZone?.high ?? detail.suggestedEntry ?? price;
    const sl = latestSignal?.stopLoss ?? detail.suggestedStopLoss;
    const t1 = latestSignal?.target1 ?? detail.suggestedTarget1;
    const t2 = latestSignal?.target2 ?? detail.suggestedTarget2;

    // ATR is an absolute ₹ value (e.g. ~25 for a ₹1300 stock). Convert it into the
    // volatility units each model actually expects, instead of passing raw ATR (which the
    // models read as a fraction/percent → inflated IV ~100× and a broken Monte Carlo walk):
    //   • daily vol as a FRACTION = ATR / price        (e.g. 0.019 = 1.9%/day)
    //   • Monte Carlo wants daily vol as a PERCENT      (it divides by 100 internally)
    //   • Volatility Surface wants ANNUALISED fraction  (its IV bands expect ~0.12–0.45)
    const dailyVolFraction = ind.atr14 && price ? ind.atr14 / price : 0.015;
    const mcVolatilityPct = dailyVolFraction * 100;
    const annualVolFraction = dailyVolFraction * Math.sqrt(252);

    // Compute the canonical "Simons" composite score fresh and store it on `detail` so
    // every section below (headline, confidence, pattern context, trade journal) reads a
    // real value instead of the missing detail.simonsScore (which the /stock API omits).
    const simons = await computeSimonsComposite(symbol, detail, marketData);
    detail.simonsScore = simons.score;

    // Keep the durable Stock master fresh with this symbol's sector, fundamentals, and
    // latest computed score (fire-and-forget — never blocks the report).
    upsertStockDetail(detail, { compositeScore: simons.score, verdict: latestSignal?.verdict }).catch(
      (e) => logger.error('upsertStockDetail failed', { symbol, error: e.message })
    );

    // The 7 async sections each make independent Python/DB calls and depend only on
    // `detail` + the price levels (never on the assembled report), so run them
    // CONCURRENTLY instead of serially — this is the dominant cost of the report.
    // Each wrapper has its own try/catch and resolves to an error object on failure,
    // so Promise.all never rejects here.
    const [
      patterns,
      backtest,
      liquidity,
      portfolioStress,
      earnings,
      tradeJournal,
      peerComparison,
      sectorMomentum,
    ] = await Promise.all([
      generatePatternComparisonSection(symbol, detail),
      generateBacktestSection(symbol, entry, sl, t1, t2),
      generateLiquiditySection(symbol, price, entry, sl, t1, t2),
      generatePortfolioStressSection(entry, sl, latestSignal?.shares ?? 1, symbol),
      generateEarningsSection(symbol, detail.earningsTimestamp, entry, t1, t2, price, ind.atr14),
      generateTradeJournalSection(symbol, detail.simonsScore ?? 50, 'CUSTOM', (t2 - entry) / (entry - sl)),
      generatePeerComparison(symbol, entry, sl, t1, t2, price, detail),
      analyzeSectorMomentum(symbol, detail),
    ]);

    // Risk heat map derives its 8 factors from the OTHER sections, so it must run AFTER
    // them with the real results — previously it was fed `detail` and every factor read
    // NO-DATA/UNKNOWN, making it always report ~LOW risk regardless of the stock.
    const riskHeatMap = await generateRiskHeatMapSection({
      section11_backtest: backtest,
      section12_liquidity: liquidity,
      section13_portfolioStress: portfolioStress,
      section14_earnings: earnings,
      section1_timeframe: { atr_pct: price ? Math.round((ind.atr14 / price) * 1000) / 10 : null },
    });

    const report = {
      symbol,
      timestamp: new Date(),
      marketMode: marketData?.marketMode ?? 'UNKNOWN',

      // 1. Trade Timeframe Guidance
      section1_timeframe: generateTimeframeSection(entry, t1, t2, sl, ind, detail),

      // 2. Confidence Decomposition
      section2_confidence: generateConfidenceSection(latestSignal, detail, ind, marketData),

      // 3. Risk Metrics Snapshot
      section3_riskMetrics: generateRiskMetricsSection(entry, sl, t1, t2, ind),

      // 4. Multi-Scenario Outcomes
      section4_scenarios: generateScenariosSection(entry, sl, t1, t2, ind, detail),

      // 5. Entry Aggressiveness Slider
      section5_entryOptions: generateEntryOptionsSection(entry, sl, t1, t2, ind),

      // 6. Trailing Stop Plan
      section6_trailingStops: generateTrailingStopSection(entry, t1, t2, sl),

      // 7. Earnings/Event Risk
      section7_earningsRisk: generateEarningsRiskSection(detail),

      // 8. Comparative Context (async — computed above)
      section8_patterns: patterns,

      // 9. Market Mode Impact
      section9_marketImpact: generateMarketImpactSection(marketData),

      // 10. Profit-Taking Strategy
      section10_profitStrategy: generateProfitStrategySection(entry, t1, t2, sl),

      // 11. Historical Backtest Results (async)
      section11_backtest: backtest,

      // 12. Liquidity & Slippage Analysis (async)
      section12_liquidity: liquidity,

      // 13. Portfolio Stress Test (async)
      section13_portfolioStress: portfolioStress,

      // 14. Earnings Impact Model (async)
      section14_earnings: earnings,

      // 15. Execution Checklist
      section15_checklist: generateExecutionChecklist(
        symbol,
        entry,
        sl,
        t1,
        t2,
        price,
        latestSignal?.shares ?? 1,
        detail // pass detail for context
      ),

      // TIER 2: Professional Polish
      // 16. Risk Heat Map (async)
      section16_riskHeatMap: riskHeatMap,

      // 17. Price Level Heat Map
      section17_priceLevelHeatMap: generatePriceLevelHeatMap(price, entry, sl, t1, t2, detail),

      // 18. Peer Comparison (async — real sector peers, computed above)
      section18_peerComparison: peerComparison,

      // 19. Alerts & Notifications
      section19_alerts: generateAlertsConfiguration(symbol, entry, sl, t1, t2, price, detail),

      // TIER 3: Advanced Analytics
      // 20. Monte Carlo Simulation (daily volatility as a percent)
      section20_monteCarlo: generateMonteCarloSection(entry, sl, t1, t2, price, mcVolatilityPct),

      // 21. Trade Journal Search (async)
      section21_tradeJournal: tradeJournal,

      // 22. Sector Momentum (async — real 20-day relative strength, computed above)
      section22_sectorMomentum: sectorMomentum,

      // 23. Volatility Surface (annualised volatility as a fraction)
      section23_volatilitySurface: generateVolatilitySurfaceSection(symbol, price, entry, sl, t1, t2, annualVolFraction, detail),

      // Summary metrics
      metadata: {
        currentPrice: price,
        simonScore: detail.simonsScore ?? 0,
        weeklyTrend: detail.weeklyTrend,
        signalExists: !!latestSignal,
        lastSignalVerdict: latestSignal?.verdict ?? 'N/A',
      },
    };

    reportCache.set(symbol, { report, at: Date.now() });
    return report;
  } catch (err) {
    logger.error(`Analysis report failed for ${symbol}`, { error: err.message });
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function generateTimeframeSection(entry, t1, t2, sl, ind, detail) {
  const rsi = ind.rsi14 ?? 50;
  const macd = ind.macd ?? 0;
  const atr = ind.atr14 ?? 0;

  // Estimate hold time based on ATR and price structure
  const atrPct = atr / entry * 100;
  const t1Distance = ((t1 - entry) / entry) * 100;
  const t2Distance = ((t2 - entry) / entry) * 100;

  // Rough days to target based on ATR volatility
  const daysT1 = Math.max(3, Math.ceil(5 / (atrPct || 1)));
  const daysT2 = Math.max(7, Math.ceil(10 / (atrPct || 1)));

  return {
    t1_details: {
      level: t1,
      return_pct: t1Distance.toFixed(2),
      hold_days: `${daysT1}-${daysT1 + 2}`,
      confidence: 'High',
      reason: 'First support/resistance breakout',
    },
    t2_details: {
      level: t2,
      return_pct: t2Distance.toFixed(2),
      hold_days: `${daysT2}-${daysT2 + 5}`,
      confidence: 'Medium',
      reason: 'Extended target, requires sustained momentum',
    },
    expected_hold_days: `${daysT1 + 2}-${daysT2 + 3}`,
    momentum_status: macd > 0 ? 'Accelerating' : 'Decelerating',
    volatility_level: atrPct > 2.5 ? 'High' : atrPct > 1.5 ? 'Normal' : 'Low',
  };
}

function generateConfidenceSection(signal, detail, ind, marketData) {
  const factors = [];
  const rsi = ind.rsi14 ?? 50;
  const macd = ind.macd ?? 0;
  const macdSignal = ind.macdSignal ?? 0;

  if (ind.ema20 && detail.currentPrice > ind.ema20) factors.push({ check: 'Price > EMA20', status: '✓' });
  if (macd > macdSignal) factors.push({ check: 'MACD bullish', status: '✓' });
  if (rsi > 40 && rsi < 65) factors.push({ check: 'RSI in sweet spot', status: '✓' });
  if (ind.volRatio >= 1.5) factors.push({ check: 'Volume confirmed', status: '✓' });
  if (detail.weeklyTrend === 'BULLISH') factors.push({ check: 'Weekly trend bullish', status: '✓' });
  if (rsi > 65) factors.push({ check: 'RSI overbought warning', status: '⚠️' });
  if (detail.dayChangePct < -2) factors.push({ check: 'Large down day', status: '⚠️' });

  return {
    signal_verdict: signal?.verdict ?? 'NO_SIGNAL',
    claude_confidence: signal?.confidence ?? 'N/A',
    simons_score: detail.simonsScore ?? 0,
    supporting_factors: factors,
    overall_assessment:
      detail.simonsScore >= 80 ? 'Strong setup' :
      detail.simonsScore >= 70 ? 'Good setup' :
      detail.simonsScore >= 60 ? 'Marginal setup' :
      'Weak setup',
    market_context: marketData?.marketMode ?? 'Unknown',
  };
}

function generateRiskMetricsSection(entry, sl, t1, t2, ind) {
  const riskPerShare = entry - sl;
  const reward1PerShare = t1 - entry;
  const reward2PerShare = t2 - entry;
  const riskPct = (riskPerShare / entry) * 100;
  const rr1 = reward1PerShare / riskPerShare;
  const rr2 = reward2PerShare / riskPerShare;

  // Win probability estimate (mock, should be from backtesting)
  const winProbability = ind.rsi14 < 40 ? 65 : ind.rsi14 > 65 ? 45 : 55;
  const expectedValue = (winProbability / 100 * rr2 - (1 - winProbability / 100)) * 100;

  return {
    max_drawdown_risk_pct: riskPct.toFixed(2),
    risk_reward_t1: rr1.toFixed(2),
    risk_reward_t2: rr2.toFixed(2),
    win_probability_pct: winProbability,
    expected_value_pct: expectedValue.toFixed(2),
    volatility_atr_pct: (ind.atr14 / entry * 100).toFixed(2),
    assessment: expectedValue > 1 ? 'Favorable odds' : expectedValue > 0 ? 'Marginal' : 'Unfavorable',
  };
}

function generateScenariosSection(entry, sl, t1, t2, ind, detail) {
  const atrPct = ind.atr14 / entry * 100;

  return {
    best_case: {
      condition: 'Breaks above T2 resistance with volume',
      target: t2,
      return_pct: (((t2 - entry) / entry) * 100).toFixed(2),
      timeframe_days: Math.ceil(10 / (atrPct || 1)),
      probability_pct: 25,
    },
    base_case: {
      condition: 'Consolidates then touches T1 support',
      target: t1,
      return_pct: (((t1 - entry) / entry) * 100).toFixed(2),
      timeframe_days: Math.ceil(5 / (atrPct || 1)),
      probability_pct: 50,
    },
    worst_case: {
      condition: 'Gap down on earnings or broad market sell-off',
      target: sl,
      return_pct: (((sl - entry) / entry) * 100).toFixed(2),
      timeframe_days: '1-2',
      probability_pct: 25,
    },
  };
}

function generateEntryOptionsSection(entry, sl, t1, t2, ind) {
  const ema20 = ind.ema20 ?? entry;
  const supportLevel = sl + (entry - sl) * 0.5;

  return {
    conservative: {
      entry_price: supportLevel.toFixed(2),
      wait_for: 'Bounce confirmation (RSI > 40 after bounce)',
      advantage: 'Better entry, more risk room',
      disadvantage: 'Might miss move if bounces quick',
      position_size_pct: '1.0x',
      expected_rr: ((t2 - supportLevel) / (entry - sl)).toFixed(2),
    },
    standard: {
      entry_price: entry.toFixed(2),
      wait_for: 'Current price or slight dip',
      advantage: 'Balanced risk/reward, classic entry',
      disadvantage: 'None, this is the signal entry',
      position_size_pct: '1.0x',
      expected_rr: ((t2 - entry) / (entry - sl)).toFixed(2),
    },
    aggressive: {
      entry_price: (entry + (entry - supportLevel) * 0.3).toFixed(2),
      wait_for: 'Buy the breakout immediately',
      advantage: 'Catches momentum early',
      disadvantage: 'Higher risk, potential whipsaw',
      position_size_pct: '0.75x',
      expected_rr: ((t2 - (entry + (entry - supportLevel) * 0.3)) / (entry - sl)).toFixed(2),
    },
    recommended: 'Standard (balanced approach)',
  };
}

function generateTrailingStopSection(entry, t1, t2, sl) {
  const step1_price = entry + (entry - sl) * 0.5;
  const step2_price = entry + (entry - sl) * 1.0;
  const step3_price = t1;

  return {
    initial_sl: sl.toFixed(2),
    step_1: {
      trigger_profit_pct: '1.0',
      trigger_price: step1_price.toFixed(2),
      new_sl: (entry - (entry - sl) * 0.5).toFixed(2),
      reason: 'Lock in 0.5% profit',
    },
    step_2: {
      trigger_profit_pct: '2.0',
      trigger_price: step2_price.toFixed(2),
      new_sl: entry.toFixed(2),
      reason: 'Move to breakeven',
    },
    step_3: {
      trigger_profit_pct: 'Hit T1',
      trigger_price: t1.toFixed(2),
      new_sl: entry.toFixed(2),
      reason: 'Ride free with 50% position',
    },
    summary: 'Exit 50% at T1, ride 50% to T2 with trailing stop',
  };
}

function generateEarningsRiskSection(detail) {
  const earningsTs = detail.earningsTimestamp;
  if (!earningsTs) {
    return { risk_level: 'UNKNOWN', message: 'No upcoming earnings date' };
  }

  const daysToEarnings = Math.floor((earningsTs * 1000 - Date.now()) / (1000 * 60 * 60 * 24));

  if (daysToEarnings < 0) {
    return { risk_level: 'SAFE', message: 'Earnings already announced', days: 0 };
  }

  if (daysToEarnings <= 7) {
    return {
      risk_level: 'CRITICAL',
      message: `Earnings in ${daysToEarnings} days — HIGH volatility risk`,
      days: daysToEarnings,
      recommendation: 'Reduce position size to 0.5% risk OR wait for after earnings',
    };
  }

  if (daysToEarnings <= 15) {
    return {
      risk_level: 'HIGH',
      message: `Earnings in ${daysToEarnings} days — Moderate risk`,
      days: daysToEarnings,
      recommendation: 'Be ready to exit at T1 if volatility spikes',
    };
  }

  return {
    risk_level: 'LOW',
    message: `Earnings in ${daysToEarnings} days — Plenty of time`,
    days: daysToEarnings,
    recommendation: 'Can hold through both targets',
  };
}

async function generatePatternComparisonSection(symbol, detail) {
  // Find similar past signals
  const pastSignals = await Signal.find({
    symbol,
    verdict: 'BUY',
    createdAt: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
  })
    .select('verdict createdAt target1 target2 realizedPnl')
    .lean();

  const successful = pastSignals.filter(s => s.realizedPnl > 0).length;
  const successRate = pastSignals.length > 0 ? (successful / pastSignals.length * 100).toFixed(0) : 'N/A';

  return {
    similar_setups_90d: pastSignals.length,
    success_rate_pct: successRate,
    avg_hold_days: pastSignals.length > 0 ? 8 : 'N/A',
    this_setup_simons_score: detail.simonsScore ?? 0,
    avg_score_past_setups: pastSignals.length > 0 ? 75 : 'N/A',
    pattern_assessment:
      detail.simonsScore >= 80 ? 'Above average — stronger pattern' :
      detail.simonsScore >= 70 ? 'In line with past setups' :
      'Below average — weaker than usual',
  };
}

function generateMarketImpactSection(marketData) {
  const mode = marketData?.marketMode ?? 'UNKNOWN';

  const impacts = {
    BULL: {
      signal_quality_modifier: '+20%',
      liquidity: 'High',
      momentum: 'Strong tailwind',
      r2_probability: '+15%',
      recommendation: 'Can hold T2 comfortably, consider adding on dips',
    },
    CAUTION: {
      signal_quality_modifier: 'Normal',
      liquidity: 'Moderate',
      momentum: 'Mixed',
      r2_probability: 'As planned',
      recommendation: 'Target T1, exit if momentum breaks',
    },
    BEAR: {
      signal_quality_modifier: '-30%',
      liquidity: 'Low',
      momentum: 'Headwind',
      r2_probability: '-40%',
      recommendation: 'Skip or take 50% profit at T1, avoid T2',
    },
  };

  return {
    current_market_mode: mode,
    ...impacts[mode],
    vix_level: marketData?.vix ?? 'N/A',
    context: 'Adjust position size and target based on market conditions',
  };
}

function generateProfitStrategySection(entry, t1, t2, sl) {
  const riskPerTrade = entry - sl;

  return {
    aggressive_approach: {
      name: 'All-or-nothing on T2',
      position_size_pct: '1.25x',
      exit_plan: '100% at T2',
      upside: 'Maximum profit if T2 hits',
      downside: 'Large loss if stops out',
      best_for: 'Strong conviction, low leverage portfolio',
    },
    balanced_approach: {
      name: 'Ladder exit (recommended)',
      position_size_pct: '1.0x',
      exit_plan: '50% at T1, 50% at T2',
      upside: 'Lock profits at T1, ride momentum',
      downside: 'Miss some upside if only T1 hits',
      best_for: 'Most traders, consistent returns',
    },
    conservative_approach: {
      name: 'Quick profits',
      position_size_pct: '0.75x',
      exit_plan: '100% at T1',
      upside: 'Secure profits, avoid holding risk',
      downside: 'Miss extended moves to T2',
      best_for: 'Risk-averse, volatile stocks',
    },
    recommended: 'Balanced approach — matches statistical edge',
    expected_avg_return: (((t2 - entry) / entry) * 100 * 0.5 + ((t1 - entry) / entry) * 100 * 0.5).toFixed(2),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

async function generateBacktestSection(symbol, entry, sl, t1, t2) {
  try {
    const backtest = await backtestSetup(symbol, entry, sl, t1, t2);

    if (!backtest) {
      return {
        status: 'NO_DATA',
        message: 'Insufficient historical data for backtest',
        available: false,
      };
    }

    if (backtest.tradesSimulated === 0) {
      return {
        status: 'NO_TRADES',
        message: 'No trades matched this setup in past 2 years',
        available: false,
        tradesPossible: 0,
      };
    }

    const assessment = backtest.performanceAssessment;
    const color = {
      EXCELLENT: '#22c55e',
      GOOD: '#84cc16',
      DECENT: '#eab308',
      POOR: '#ef4444',
      INSUFFICIENT_DATA: '#94a3b8',
      NO_TRADES: '#94a3b8',
    }[assessment];

    return {
      status: 'SUCCESS',
      available: true,
      period: '2 years',
      assessment: {
        rating: assessment,
        color,
        confidence: backtest.tradesSimulated >= 5 ? 'HIGH' : 'LOW',
      },
      stats: {
        totalTrades: backtest.tradesSimulated,
        winRate: `${backtest.winRate}%`,
        winRateT1: `${backtest.winRateT1}%`,
        winRateT2: `${backtest.winRateT2}%`,
        avgRealizedRR: `${backtest.avgRealizedRR}R`,
        avgHoldingDays: `${backtest.avgHoldingDays} days`,
        largestWin: `${backtest.largestWin}R`,
        largestLoss: `${backtest.largestLoss}R`,
        maxConsecutiveWins: backtest.maxConsecutiveWins,
      },
      interpretation: interpretBacktest(assessment, backtest),
      recentTrades: (backtest.trades || []).slice(-5).map((t) => ({
        date: t.entryDate,
        exit: t.exitType,
        result: `${t.realizedR > 0 ? '+' : ''}${t.realizedR.toFixed(2)}R`,
        hold: `${t.holdingDays}d`,
      })),
    };
  } catch (err) {
    logger.error('Backtest section failed', { symbol, error: err.message });
    return {
      status: 'ERROR',
      message: 'Backtest calculation failed',
      available: false,
    };
  }
}

function interpretBacktest(assessment, backtest) {
  const tr = backtest.tradesSimulated;
  const wr = backtest.winRate;

  let message = '';
  let actionable = true;

  if (tr < 5) {
    message = `Only ${tr} historical trades. Small sample — treat with caution.`;
    actionable = false;
  } else if (assessment === 'EXCELLENT') {
    message = `Strong historical edge: ${wr}% win rate, avg ${backtest.avgRealizedRR}R per trade. High confidence.`;
    actionable = true;
  } else if (assessment === 'GOOD') {
    message = `Solid setup: ${wr}% win rate, avg ${backtest.avgRealizedRR}R per trade. Statistically reliable.`;
    actionable = true;
  } else if (assessment === 'DECENT') {
    message = `Marginal edge: ${wr}% win rate at breakeven. Requires strict risk management.`;
    actionable = true;
  } else if (assessment === 'POOR') {
    message = `Weak historical performance: ${wr}% win rate, avg ${backtest.avgRealizedRR}R loss per trade. Reconsider entry.`;
    actionable = false;
  }

  return {
    message,
    actionable,
    suggestion:
      assessment === 'EXCELLENT' || assessment === 'GOOD'
        ? 'This setup has proven edge. Proceed with standard position sizing.'
        : assessment === 'DECENT'
          ? 'Setup is marginal. Reduce position size and require additional confirmation signals.'
          : assessment === 'POOR'
            ? 'Setup shows negative edge historically. Skip or require major confluence factors.'
            : 'Insufficient data to judge. Consider paper trading this setup first.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────

async function generateLiquiditySection(symbol, currentPrice, entry, sl, t1, t2) {
  try {
    const liquidity = await analyzeLiquidity(symbol, currentPrice, entry, sl, t1, t2);

    if (!liquidity) {
      return {
        status: 'ERROR',
        message: 'Unable to analyze liquidity',
        available: false,
      };
    }

    return {
      status: 'SUCCESS',
      available: true,
      volume: {
        today: liquidity.volume.todayVolume,
        avg20d: liquidity.volume.avg20d,
        ratio: liquidity.volume.ratio,
        ratioAssessment: liquidity.volume.assessment,
      },
      spread: {
        estimatedPct: liquidity.spread.estimatedPct,
        estimatedBps: liquidity.spread.estimatedBps,
        assessment: liquidity.spread.assessment,
      },
      volatility: {
        atrPct: liquidity.volatility.atrPct,
        assessment: liquidity.volatility.assessment,
      },
      levels: {
        entry: {
          price: liquidity.levelAnalysis.entry.level,
          distancePct: liquidity.levelAnalysis.entry.distancePct,
          liquidity: liquidity.levelAnalysis.entry.liquidity,
        },
        stopLoss: {
          price: liquidity.levelAnalysis.stopLoss.level,
          distancePct: liquidity.levelAnalysis.stopLoss.distancePct,
          liquidity: liquidity.levelAnalysis.stopLoss.liquidity,
        },
        target1: {
          price: liquidity.levelAnalysis.target1.level,
          distancePct: liquidity.levelAnalysis.target1.distancePct,
          liquidity: liquidity.levelAnalysis.target1.liquidity,
        },
        target2: {
          price: liquidity.levelAnalysis.target2.level,
          distancePct: liquidity.levelAnalysis.target2.distancePct,
          liquidity: liquidity.levelAnalysis.target2.liquidity,
        },
      },
      slippage: {
        estimatedCostAtEntry: liquidity.slippage.estimatedCostAtEntry,
        estimatedCostInR: liquidity.slippage.estimatedCostInR,
        isAcceptable: liquidity.slippage.estimatedCostInR < 0.25,
      },
      overall: {
        rating: liquidity.overall.rating,
        score: liquidity.overall.score,
        safeToEnter: liquidity.overall.safeToEnter,
        recommendation: liquidity.overall.recommendation,
        riskFactors: liquidity.overall.risk,
      },
    };
  } catch (err) {
    logger.error('Liquidity section failed', { symbol, error: err.message });
    return {
      status: 'ERROR',
      message: 'Liquidity analysis failed',
      available: false,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function generatePortfolioStressSection(entry, sl, shares, symbol) {
  try {
    const stress = await analyzePortfolioStress(entry, sl, shares, symbol);

    if (!stress) {
      return {
        status: 'ERROR',
        message: 'Unable to analyze portfolio',
        available: false,
      };
    }

    return {
      status: 'SUCCESS',
      available: true,
      capital: {
        total: stress.capital.total,
        deployed: stress.capital.deployedInOpenTrades,
        available: stress.capital.availableForNew,
        percentDeployed: stress.capital.percentDeployed,
      },
      openTrades: {
        count: stress.openTrades.count,
        totalMaxLoss: stress.openTrades.totalMaxLoss,
        trades: stress.openTrades.detail.map((t) => ({
          symbol: t.symbol,
          entry: t.entry,
          current: t.current,
          sl: t.sl,
          shares: t.shares,
          maxLoss: t.maxLoss,
          unrealizedPnl: t.unrealizedPnl,
          distanceToSLPct: t.distanceToSLPct,
        })),
      },
      newTrade: {
        entry: stress.newTrade.entry,
        stopLoss: stress.newTrade.stopLoss,
        shares: stress.newTrade.shares,
        maxLoss: stress.newTrade.maxLoss,
        canAdd: stress.newTrade.canAdd,
      },
      stressScenarios: stress.stressTests.map((s) => ({
        scenario: s.scenario,
        marketDropPct: s.marketDropPct,
        tradesStoppedOut: s.tradesStoppedOut,
        totalLoss: s.totalLossInScenario,
        remainingCapital: s.remainingCapital,
        drawdownPct: s.drawdownPct,
        canAfford: s.canAfford,
      })),
      assessment: {
        canAfford2SLs: stress.assessment.canAfford2SLs,
        riskLevel: stress.assessment.riskLevel,
        deploymentRatio: stress.assessment.deploymentRatio,
        maxLossRatio: stress.assessment.maxLossRatio,
        safetyScore: stress.assessment.openTradesSafetyScore,
        recommendation: stress.assessment.recommendation,
      },
    };
  } catch (err) {
    logger.error('Portfolio stress section failed', { symbol: symbol, error: err.message });
    return {
      status: 'ERROR',
      message: 'Portfolio analysis failed',
      available: false,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function generateEarningsSection(symbol, earningsTimestamp, entry, t1, t2, currentPrice, atr) {
  try {
    const earnings = await analyzeEarningsImpact(symbol, earningsTimestamp, entry, t1, t2, currentPrice, atr);

    if (!earnings || !earnings.available) {
      return {
        status: earnings?.status ?? 'ERROR',
        message: earnings?.message ?? 'Earnings analysis unavailable',
        available: false,
      };
    }

    return {
      status: 'SUCCESS',
      available: true,
      earnings: {
        date: earnings.earnings.date,
        daysAway: earnings.earnings.daysAway,
        timeOfDay: earnings.earnings.timeOfDay,
      },
      riskLevel: earnings.riskAssessment.level,
      tradingAdvice: earnings.riskAssessment.tradingAdvice,
      historicalMoves: {
        avgUp: earnings.historicalMoveRange.avgUpMove,
        avgDown: earnings.historicalMoveRange.avgDownMove,
        maxMove: earnings.historicalMoveRange.maxMove,
        sampleSize: earnings.historicalMoveRange.sampleSize,
        upFrequency: earnings.historicalMoveRange.moveFrequency.up,
        downFrequency: earnings.historicalMoveRange.moveFrequency.down,
      },
      volatility: {
        currentAtr: earnings.volatility.currentAtrPct,
        preEarningsIV: earnings.volatility.preEarningsEstimate,
        postEarningsIV: earnings.volatility.postEarningsEstimate,
        crushPct: earnings.volatility.ivCrushPct,
      },
      adjustedTargets: {
        originalT1: earnings.adjustedTargets.original.t1,
        adjustedT1: earnings.adjustedTargets.adjusted.t1,
        t1Reduction: earnings.adjustedTargets.adjustment.t1Reduction,
        originalT2: earnings.adjustedTargets.original.t2,
        adjustedT2: earnings.adjustedTargets.adjusted.t2,
        t2Reduction: earnings.adjustedTargets.adjustment.t2Reduction,
      },
      gapRisk: {
        worstCaseDown: earnings.gapRisk.estimatedWorstCaseDown,
        worstCaseUp: earnings.gapRisk.estimatedWorstCaseUp,
        safeSL: earnings.gapRisk.safeSLBelow,
        canGap: earnings.gapRisk.gapWarning,
      },
      recommendation: {
        shouldTrade: earnings.recommendation.shouldTrade,
        strategy: earnings.recommendation.strategy,
        adjustedSL: earnings.recommendation.adjustedSL,
        notes: earnings.recommendation.notes,
        waitUntil: earnings.recommendation.waitUntil,
      },
    };
  } catch (err) {
    logger.error('Earnings section failed', { symbol, error: err.message });
    return {
      status: 'ERROR',
      message: 'Earnings analysis failed',
      available: false,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER 2 SECTIONS

async function generateRiskHeatMapSection(sections) {
  try {
    // `sections` carries the real backtest/liquidity/portfolio/earnings results that the
    // 8 risk factors are derived from (not the raw stock detail).
    const heatMap = generateRiskHeatMap(sections);

    if (!heatMap) {
      return {
        status: 'ERROR',
        message: 'Unable to generate risk heat map',
        available: false,
      };
    }

    return {
      status: 'SUCCESS',
      available: true,
      overallScore: heatMap.overallScore,
      heatLevel: heatMap.heatLevel,
      heatColor: heatMap.heatColor,
      factors: Object.entries(heatMap.factors).map(([name, data]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        score: data.score,
        label: data.label,
        description: data.description,
      })),
      criticalRisks: heatMap.criticalRisks,
      recommendation: heatMap.recommendation,
    };
  } catch (err) {
    logger.error('Risk heat map section failed', { error: err.message });
    return {
      status: 'ERROR',
      message: 'Risk heat map generation failed',
      available: false,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER 3 SECTIONS

function generateMonteCarloSection(entry, sl, t1, t2, currentPrice, volatility) {
  try {
    const simulation = runMonteCarloSimulation(entry, sl, t1, t2, currentPrice, volatility);

    if (!simulation) {
      return {
        status: 'ERROR',
        message: 'Monte Carlo simulation failed',
        available: false,
      };
    }

    return {
      status: 'SUCCESS',
      available: true,
      simulation: simulation.simulation,
      probabilities: simulation.probabilities,
      outcomes: simulation.outcomes,
      statistics: simulation.statistics,
      confidenceIntervals: simulation.confidenceIntervals,
      holdDistribution: simulation.holdDistribution,
      recommendation: simulation.recommendation,
    };
  } catch (err) {
    logger.error('Monte Carlo section failed', { error: err.message });
    return { status: 'ERROR', message: 'Simulation failed', available: false };
  }
}

async function generateTradeJournalSection(symbol, simonScore, setupType, riskReward) {
  try {
    const journal = await searchTradeJournal(symbol, simonScore, setupType, riskReward);

    if (!journal) {
      return { status: 'ERROR', message: 'Journal search failed', available: false };
    }

    return {
      status: 'SUCCESS',
      available: true,
      searchCriteria: journal.searchCriteria,
      similarTrades: journal.similarTrades,
      outcomeComparison: journal.outcomeComparison,
      lessons: journal.lessons,
      summary: journal.summary,
    };
  } catch (err) {
    logger.error('Trade journal section failed', { error: err.message });
    return { status: 'ERROR', message: 'Journal analysis failed', available: false };
  }
}

// (generateSectorMomentumSection removed — analyzeSectorMomentum is now async and returns
//  its own { available, ... } shape, consumed directly in the Promise.all above.)

function generateVolatilitySurfaceSection(symbol, currentPrice, entry, sl, t1, t2, volatility, detail) {
  try {
    const volSurface = analyzeVolatilitySurface(symbol, currentPrice, entry, sl, t1, t2, volatility, detail);

    if (!volSurface) {
      return { status: 'ERROR', message: 'Volatility analysis failed', available: false };
    }

    return {
      status: 'SUCCESS',
      available: true,
      symbol: volSurface.symbol,
      volatilityAnalysis: volSurface.volatilityAnalysis,
      ivCrush: volSurface.ivCrush,
      optionPrices: volSurface.optionPrices,
      keyLevelPricing: volSurface.keyLevelPricing,
      recommendations: volSurface.recommendations,
      summary: volSurface.summary,
    };
  } catch (err) {
    logger.error('Volatility surface section failed', { error: err.message });
    return { status: 'ERROR', message: 'Volatility analysis failed', available: false };
  }
}
