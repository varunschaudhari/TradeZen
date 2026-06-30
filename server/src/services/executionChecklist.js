/**
 * @file executionChecklist.js
 * @description Generate execution checklists for trades
 * Step-by-step actionable checklist for pre-entry, entry, and post-entry phases
 */

import { logger } from '../config/logger.js';

/**
 * Generate execution checklist for a trade setup
 * @param {string} symbol - Stock symbol
 * @param {number} entry - Entry price
 * @param {number} stopLoss - Stop loss price
 * @param {number} target1 - First target
 * @param {number} target2 - Second target
 * @param {number} currentPrice - Current market price
 * @param {number} shares - Share count
 * @param {Object} analysis - Full analysis report data
 * @returns {Object} execution checklist
 */
export function generateExecutionChecklist(
  symbol,
  entry,
  stopLoss,
  target1,
  target2,
  currentPrice,
  shares,
  analysis
) {
  try {
    const risk = entry - stopLoss;
    const maxLoss = risk * shares;
    const maxProfit1 = (target1 - entry) * shares;
    const maxProfit2 = (target2 - entry) * shares;

    const preEntryChecklist = [
      {
        id: 1,
        phase: 'PRE-ENTRY',
        item: `Confirm Signal Quality: Simons Score ≥ 70 (Current: ${Math.round(analysis?.metadata?.simonScore ?? 50)})`,
        description: 'Verify the signal has sufficient strength before proceeding',
        checked: false,
      },
      {
        id: 2,
        phase: 'PRE-ENTRY',
        item: 'Check News & Sentiment: No negative announcements in last 24h',
        description: 'Verify no adverse news that would invalidate the setup',
        checked: false,
      },
      {
        id: 3,
        phase: 'PRE-ENTRY',
        item: `Verify Liquidity: Volume ratio > 0.8× (Check bid-ask < 0.5%)`,
        description: 'Confirm adequate liquidity to enter and exit',
        checked: false,
      },
      {
        id: 4,
        phase: 'PRE-ENTRY',
        item: `Check Portfolio: Can afford 2 SL hits simultaneously?`,
        description: 'Ensure capital adequacy for this position',
        checked: false,
      },
      {
        id: 5,
        phase: 'PRE-ENTRY',
        item: `Earnings Check: ${analysis?.section14_earnings?.available ? `Earnings in ${analysis.section14_earnings.earnings.daysAway} days (${analysis.section14_earnings.recommendation.shouldTrade})` : 'No earnings within 30 days'}`,
        description: 'Be aware of upcoming events that could impact trade',
        checked: false,
      },
      {
        id: 6,
        phase: 'PRE-ENTRY',
        item: 'Review Risk Parameters: Entry, SL, and Targets confirmed',
        description: `Entry: ₹${entry.toFixed(2)} | SL: ₹${stopLoss.toFixed(2)} | T1: ₹${target1.toFixed(2)} | T2: ₹${target2.toFixed(2)}`,
        checked: false,
      },
      {
        id: 7,
        phase: 'PRE-ENTRY',
        item: `Calculate Max Risk: ₹${maxLoss.toFixed(0)} (${((maxLoss / (analysis?.capital?.total ?? 1000000)) * 100).toFixed(1)}% of capital)`,
        description: 'Confirm risk is acceptable (typically ≤1-2% of capital)',
        checked: false,
      },
      {
        id: 8,
        phase: 'PRE-ENTRY',
        item: `Position Size Confirmed: ${shares} shares at ₹${entry.toFixed(2)}`,
        description: `Total capital required: ₹${(entry * shares).toFixed(0)}`,
        checked: false,
      },
      {
        id: 9,
        phase: 'PRE-ENTRY',
        item: 'Verify Market Hours: NSE 09:15-15:30 IST',
        description: 'Trading only during official market hours to ensure liquidity',
        checked: false,
      },
      {
        id: 10,
        phase: 'PRE-ENTRY',
        item: 'Set Alerts: Entry-5 rupees, Entry+5 rupees',
        description: 'Pre-set price alerts to monitor entry zone',
        checked: false,
      },
    ];

    const entryPhaseChecklist = [
      {
        id: 11,
        phase: 'ENTRY',
        item: `Place Limit Order: ₹${entry.toFixed(2)} (not market order)`,
        description: 'Use limit order to avoid slippage. Target 2-3% fill within 30 minutes.',
        checked: false,
      },
      {
        id: 12,
        phase: 'ENTRY',
        item: 'Monitor Fill: Watch for order execution in first 5 minutes',
        description: 'If not filled, adjust limit price +0.5 rupees and retry',
        checked: false,
      },
      {
        id: 13,
        phase: 'ENTRY',
        item: 'Confirm Entry: Actual entry price captured and recorded',
        description: 'Note actual fill price and timestamp',
        checked: false,
      },
      {
        id: 14,
        phase: 'ENTRY',
        item: 'Verify Quantity: Correct number of shares purchased',
        description: `Confirm: ${shares} shares at entry`,
        checked: false,
      },
      {
        id: 15,
        phase: 'ENTRY',
        item: `Set Stop Loss Order: ₹${stopLoss.toFixed(2)} (Market order)`,
        description: 'Place SL immediately after entry to protect capital',
        checked: false,
      },
      {
        id: 16,
        phase: 'ENTRY',
        item: `Set Target 1 Order: ₹${target1.toFixed(2)} (Limit order)`,
        description: `Profit at T1: ₹${maxProfit1.toFixed(0)}. Consider booking half position here.`,
        checked: false,
      },
      {
        id: 17,
        phase: 'ENTRY',
        item: `Set Target 2 Order: ₹${target2.toFixed(2)} (Limit order)`,
        description: `Profit at T2: ₹${maxProfit2.toFixed(0)}. Hold remaining half for extended move.`,
        checked: false,
      },
      {
        id: 18,
        phase: 'ENTRY',
        item: 'Check Execution: All 3 orders confirmed (Entry, SL, T1/T2)',
        description: 'Verify broker shows pending orders',
        checked: false,
      },
      {
        id: 19,
        phase: 'ENTRY',
        item: 'Log Trade: Record entry time, price, shares in journal',
        description: 'Timestamp: now, Entry: completed, Next: monitor',
        checked: false,
      },
    ];

    const postEntryChecklist = [
      {
        id: 20,
        phase: 'POST-ENTRY',
        item: 'First 5 Minutes: Monitor price action closely',
        description: 'If price moves against you >1% within 5 min, re-evaluate thesis',
        checked: false,
      },
      {
        id: 21,
        phase: 'POST-ENTRY',
        item: `Distance to SL: ${((entry - stopLoss) / stopLoss * 100).toFixed(1)}% (Safe margin)`,
        description: 'If price approaches SL, consider tightening it by 0.5%',
        checked: false,
      },
      {
        id: 22,
        phase: 'POST-ENTRY',
        item: 'Target 1 Hit: Book half position (50%) when T1 touched',
        description: `T1 Profit: ₹${maxProfit1.toFixed(0)}. Lock in gains. Trail SL to breakeven.`,
        checked: false,
      },
      {
        id: 23,
        phase: 'POST-ENTRY',
        item: 'Trail Stop to Entry: After T1 hit, move SL to entry price',
        description: 'Protect remaining half position. Risk-free trade now.',
        checked: false,
      },
      {
        id: 24,
        phase: 'POST-ENTRY',
        item: 'Target 2 Phase: Hold remaining 50% for T2',
        description: `Profit potential at T2: ₹${maxProfit2.toFixed(0)}. Check every 15 min.`,
        checked: false,
      },
      {
        id: 25,
        phase: 'POST-ENTRY',
        item: 'Monitor Earnings/News: If earnings declared, consider exiting before close',
        description: 'Gap risk post-earnings. Lock in profits before announcement.',
        checked: false,
      },
      {
        id: 26,
        phase: 'POST-ENTRY',
        item: '15-Min Rule: If SL not hit in 15 min, position is valid',
        description: 'Entry thesis is working. Let trade run. Monitor every 5 min.',
        checked: false,
      },
      {
        id: 27,
        phase: 'POST-ENTRY',
        item: 'Target 2 Hit: Book full position when T2 touched',
        description: `T2 Profit: ₹${maxProfit2.toFixed(0)}. Exit completely. Log results.`,
        checked: false,
      },
      {
        id: 28,
        phase: 'POST-ENTRY',
        item: 'SL Hit: Exit immediately when SL triggered',
        description: `SL Loss: ₹${maxLoss.toFixed(0)}. Accept loss. Log & move on. No averaging down.`,
        checked: false,
      },
      {
        id: 29,
        phase: 'POST-ENTRY',
        item: '15-Day Max Hold: Exit by 15:30 if no target/SL hit within 15 days',
        description: 'Timeout exit. Don\'t hold indefinitely. Lock in profit/loss.',
        checked: false,
      },
      {
        id: 30,
        phase: 'POST-ENTRY',
        item: 'Log Exit: Record exit time, price, PnL, actual R:R achieved',
        description: 'Update journal. Calculate realized R:R. Lessons learned?',
        checked: false,
      },
      {
        id: 31,
        phase: 'POST-ENTRY',
        item: 'Debrief: Did price action match thesis? Any surprises?',
        description: 'Review setup quality. Update playbook if new patterns found.',
        checked: false,
      },
    ];

    return {
      symbol,
      timestamp: new Date().toISOString(),
      riskMetrics: {
        entry,
        stopLoss,
        target1,
        target2,
        shares,
        riskPerShare: risk,
        maxLossInRupees: maxLoss,
        maxProfitT1: maxProfit1,
        maxProfitT2: maxProfit2,
        riskRewardT1: (maxProfit1 / maxLoss).toFixed(2),
        riskRewardT2: (maxProfit2 / maxLoss).toFixed(2),
      },
      phases: {
        preEntry: preEntryChecklist,
        entry: entryPhaseChecklist,
        postEntry: postEntryChecklist,
      },
      summary: {
        totalItems: preEntryChecklist.length + entryPhaseChecklist.length + postEntryChecklist.length,
        preEntryCount: preEntryChecklist.length,
        entryCount: entryPhaseChecklist.length,
        postEntryCount: postEntryChecklist.length,
      },
    };
  } catch (err) {
    logger.error('Execution checklist generation failed', { symbol, error: err.message });
    return null;
  }
}

/**
 * Generate plain text version for copy-paste
 */
export function generateChecklistText(checklist) {
  if (!checklist) return '';

  const lines = [];
  lines.push(`EXECUTION CHECKLIST: ${checklist.symbol}`);
  lines.push(`Generated: ${new Date(checklist.timestamp).toLocaleString()}`);
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════');
  lines.push('RISK METRICS');
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(`Entry: ₹${checklist.riskMetrics.entry.toFixed(2)}`);
  lines.push(`Stop Loss: ₹${checklist.riskMetrics.stopLoss.toFixed(2)}`);
  lines.push(`Target 1: ₹${checklist.riskMetrics.target1.toFixed(2)}`);
  lines.push(`Target 2: ₹${checklist.riskMetrics.target2.toFixed(2)}`);
  lines.push(`Shares: ${checklist.riskMetrics.shares}`);
  lines.push(`Max Risk: ₹${checklist.riskMetrics.maxLossInRupees.toFixed(0)}`);
  lines.push(`Max Profit T1: ₹${checklist.riskMetrics.maxProfitT1.toFixed(0)} (R:R ${checklist.riskMetrics.riskRewardT1}:1)`);
  lines.push(`Max Profit T2: ₹${checklist.riskMetrics.maxProfitT2.toFixed(0)} (R:R ${checklist.riskMetrics.riskRewardT2}:1)`);
  lines.push('');

  ['preEntry', 'entry', 'postEntry'].forEach((phase) => {
    const phaseData = checklist.phases[phase];
    const phaseTitle = phase === 'preEntry' ? 'PRE-ENTRY' : phase === 'entry' ? 'ENTRY' : 'POST-ENTRY';

    lines.push('═══════════════════════════════════════════════════════');
    lines.push(phaseTitle);
    lines.push('═══════════════════════════════════════════════════════');

    phaseData.forEach((item) => {
      lines.push(`☐ ${item.item}`);
      if (item.description) {
        lines.push(`  → ${item.description}`);
      }
      lines.push('');
    });
  });

  lines.push('═══════════════════════════════════════════════════════');
  lines.push('QUICK REFERENCE');
  lines.push('═══════════════════════════════════════════════════════');
  lines.push('Entry Strategy: Place limit order at entry price');
  lines.push('Risk Management: SL at market, T1 and T2 at limit');
  lines.push('Profit Taking: Book 50% at T1, trail SL to entry, let T2 run');
  lines.push('Max Hold: 15 days (exit by 15:30 if no target/SL hit)');
  lines.push('Earnings: Check calendar before entering. Exit pre-earnings.');
  lines.push('');

  return lines.join('\n');
}
