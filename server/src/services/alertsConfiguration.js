/**
 * @file alertsConfiguration.js
 * @description Alert configuration and notification setup for trades
 * Generates pre-configured alerts for all critical levels and events
 */

import { logger } from '../config/logger.js';

/**
 * Generate comprehensive alerts configuration for a trade
 * @param {string} symbol - Stock symbol
 * @param {number} entry - Entry price
 * @param {number} stopLoss - Stop loss price
 * @param {number} target1 - First target
 * @param {number} target2 - Second target
 * @param {number} currentPrice - Current market price
 * @param {Object} analysis - Full analysis data
 * @returns {Object} alerts configuration
 */
export function generateAlertsConfiguration(symbol, entry, stopLoss, target1, target2, currentPrice, analysis) {
  try {
    // Generate price-level alerts
    const priceAlerts = generatePriceAlerts(symbol, entry, stopLoss, target1, target2);

    // Generate time-based alerts
    const timeAlerts = generateTimeAlerts(analysis);

    // Generate event-based alerts
    const eventAlerts = generateEventAlerts(symbol, analysis);

    // Generate alert templates for different platforms
    const alertTemplates = generateAlertTemplates(symbol, entry, stopLoss, target1, target2, analysis);

    return {
      symbol,
      timestamp: new Date(),
      priceAlerts,
      timeAlerts,
      eventAlerts,
      alertTemplates,
      summary: {
        totalAlerts: priceAlerts.length + timeAlerts.length + eventAlerts.length,
        priceAlertsCount: priceAlerts.length,
        timeAlertsCount: timeAlerts.length,
        eventAlertsCount: eventAlerts.length,
      },
      setup: generateSetupInstructions(symbol, priceAlerts, timeAlerts),
    };
  } catch (err) {
    logger.error('Alerts configuration generation failed', { symbol, error: err.message });
    return null;
  }
}

/**
 * Generate price-level alerts
 */
function generatePriceAlerts(symbol, entry, stopLoss, target1, target2) {
  const alerts = [];

  // Entry alerts (approaching entry)
  alerts.push({
    id: 'entry_high',
    type: 'ENTRY',
    level: entry,
    condition: `Price ≥ ₹${entry.toFixed(2)}`,
    description: 'Entry zone reached - prepare to execute',
    action: 'Place limit order at entry',
    priority: 'HIGH',
    sound: true,
  });

  alerts.push({
    id: 'entry_approach',
    type: 'ENTRY',
    level: entry - (entry - stopLoss) * 0.5,
    condition: `Price ≥ ₹${(entry - (entry - stopLoss) * 0.5).toFixed(2)}`,
    description: 'Approaching entry zone',
    action: 'Monitor price action',
    priority: 'MEDIUM',
    sound: false,
  });

  // Stop loss alerts (danger zone)
  alerts.push({
    id: 'sl_critical',
    type: 'STOPLOSS',
    level: stopLoss,
    condition: `Price ≤ ₹${stopLoss.toFixed(2)}`,
    description: 'Stop loss hit - exit position immediately',
    action: 'Execute market sell',
    priority: 'CRITICAL',
    sound: true,
    notification: 'URGENT',
  });

  alerts.push({
    id: 'sl_warning',
    type: 'STOPLOSS',
    level: stopLoss + (entry - stopLoss) * 0.2,
    condition: `Price ≤ ₹${(stopLoss + (entry - stopLoss) * 0.2).toFixed(2)}`,
    description: 'Approaching stop loss - watch closely',
    action: 'Monitor position, tighten SL if possible',
    priority: 'HIGH',
    sound: true,
  });

  // Target 1 alerts (partial profit)
  alerts.push({
    id: 't1_reach',
    type: 'TARGET1',
    level: target1,
    condition: `Price ≥ ₹${target1.toFixed(2)}`,
    description: 'Target 1 reached - book 50% profit',
    action: 'Sell 50% of position at limit price',
    priority: 'HIGH',
    sound: true,
  });

  alerts.push({
    id: 't1_approach',
    type: 'TARGET1',
    level: target1 - (target1 - entry) * 0.1,
    condition: `Price ≥ ₹${(target1 - (target1 - entry) * 0.1).toFixed(2)}`,
    description: 'Approaching Target 1',
    action: 'Prepare to book 50% profit',
    priority: 'MEDIUM',
    sound: false,
  });

  // Target 2 alerts (full exit)
  alerts.push({
    id: 't2_reach',
    type: 'TARGET2',
    level: target2,
    condition: `Price ≥ ₹${target2.toFixed(2)}`,
    description: 'Target 2 reached - exit remaining position',
    action: 'Sell remaining 50% at limit price',
    priority: 'HIGH',
    sound: true,
  });

  alerts.push({
    id: 't2_approach',
    type: 'TARGET2',
    level: target2 - (target2 - entry) * 0.15,
    condition: `Price ≥ ₹${(target2 - (target2 - entry) * 0.15).toFixed(2)}`,
    description: 'Approaching Target 2',
    action: 'Monitor for full exit',
    priority: 'MEDIUM',
    sound: false,
  });

  return alerts;
}

/**
 * Generate time-based alerts
 */
function generateTimeAlerts(analysis) {
  const alerts = [];
  const now = new Date();

  // Market open alert
  alerts.push({
    id: 'market_open',
    type: 'TIME_BASED',
    time: '09:15 IST',
    description: 'Market opens - verify setup and place orders',
    action: 'Review all pre-entry checklist items',
    priority: 'HIGH',
    repeat: 'Daily',
  });

  // Pre-earnings alert
  if (analysis.section14_earnings?.available) {
    const earningsDate = new Date(analysis.section14_earnings.earnings.date);
    const daysAway = analysis.section14_earnings.earnings.daysAway;

    if (daysAway > 0 && daysAway <= 15) {
      alerts.push({
        id: 'earnings_warning',
        type: 'TIME_BASED',
        time: 'Daily at 09:00 IST',
        description: `Earnings ${daysAway} days away - plan exit strategy`,
        action: `Exit before ${earningsDate.toDateString()} or widen SL`,
        priority: daysAway <= 3 ? 'CRITICAL' : 'HIGH',
        repeat: 'Daily until earnings',
      });

      // Day before earnings
      alerts.push({
        id: 'earnings_day_before',
        type: 'TIME_BASED',
        time: '15:00 IST',
        description: 'Earnings tomorrow - final chance to exit',
        action: 'Book profits or close position before announcement',
        priority: 'CRITICAL',
        repeat: 'Once',
      });
    }
  }

  // Market close alert
  alerts.push({
    id: 'market_close',
    type: 'TIME_BASED',
    time: '15:25 IST',
    description: 'Market closing soon - verify position status',
    action: 'Check all open orders, close any pending positions',
    priority: 'MEDIUM',
    repeat: 'Daily',
  });

  // Intraday review alerts
  alerts.push({
    id: 'intraday_review_1',
    type: 'TIME_BASED',
    time: '11:00 IST',
    description: 'Mid-morning review - trade progressing?',
    action: 'Check profit/loss, verify SL/T1/T2 orders active',
    priority: 'MEDIUM',
    repeat: 'Daily',
  });

  alerts.push({
    id: 'intraday_review_2',
    type: 'TIME_BASED',
    time: '14:00 IST',
    description: 'Afternoon review - trade status update',
    action: 'Check if targets/SL approaching, plan end-of-day action',
    priority: 'MEDIUM',
    repeat: 'Daily',
  });

  return alerts;
}

/**
 * Generate event-based alerts
 */
function generateEventAlerts(symbol, analysis) {
  const alerts = [];

  // News alerts
  alerts.push({
    id: 'news_monitor',
    type: 'EVENT_BASED',
    event: 'News Alert',
    description: 'Monitor for breaking news on this stock',
    action: 'Check news feed for any announcements',
    priority: 'HIGH',
    setup: `Set Google News alert for "${symbol}" stock`,
  });

  // Earnings announcement alert
  if (analysis.section14_earnings?.available) {
    alerts.push({
      id: 'earnings_announcement',
      type: 'EVENT_BASED',
      event: 'Earnings Announcement',
      description: `Earnings announcement on ${analysis.section14_earnings.earnings.date}`,
      action: 'Be ready to exit if holding position',
      priority: 'CRITICAL',
      setup: 'Set calendar reminder for earnings date',
    });
  }

  // Portfolio alerts
  alerts.push({
    id: 'portfolio_monitor',
    type: 'EVENT_BASED',
    event: 'Portfolio Change',
    description: 'Monitor open positions correlation',
    action: 'If other positions open, check correlation with this trade',
    priority: 'MEDIUM',
    setup: 'Track sector concentration',
  });

  // Technical pattern alerts
  alerts.push({
    id: 'pattern_break',
    type: 'EVENT_BASED',
    event: 'Price Pattern Break',
    description: 'If price breaks setup pattern',
    action: 'Reassess entry thesis, consider closing',
    priority: 'MEDIUM',
    setup: 'Monitor 4h/daily candle closes',
  });

  return alerts;
}

/**
 * Generate alert templates for different platforms
 */
function generateAlertTemplates(symbol, entry, stopLoss, target1, target2, analysis) {
  const templates = {};

  // TradingView alert template
  templates.tradingview = {
    platform: 'TradingView',
    instructions: 'Create alerts on TradingView using these conditions:',
    alerts: [
      {
        name: `${symbol} Entry Zone`,
        condition: `close >= ${entry}`,
        message: `${symbol} entered entry zone at ${entry}. Place limit order.`,
      },
      {
        name: `${symbol} Stop Loss Hit`,
        condition: `close <= ${stopLoss}`,
        message: `${symbol} hit stop loss at ${stopLoss}. EXIT IMMEDIATELY.`,
      },
      {
        name: `${symbol} Target 1`,
        condition: `close >= ${target1}`,
        message: `${symbol} hit Target 1 at ${target1}. Book 50% profit.`,
      },
      {
        name: `${symbol} Target 2`,
        condition: `close >= ${target2}`,
        message: `${symbol} hit Target 2 at ${target2}. Exit fully.`,
      },
    ],
  };

  // Broker alert template
  templates.broker = {
    platform: 'Broker Platform (Zerodha/Upstox/etc)',
    instructions: 'Set alerts in your broker mobile app:',
    alerts: [
      {
        name: `${symbol} Entry`,
        level: entry,
        type: 'Above/Equal',
        action: 'Place buy limit order',
      },
      {
        name: `${symbol} SL`,
        level: stopLoss,
        type: 'Below/Equal',
        action: 'Sell market immediately',
      },
      {
        name: `${symbol} T1`,
        level: target1,
        type: 'Above/Equal',
        action: 'Sell 50% at limit',
      },
      {
        name: `${symbol} T2`,
        level: target2,
        type: 'Above/Equal',
        action: 'Sell remaining at limit',
      },
    ],
  };

  // Telegram/Email alert template
  templates.telegram = {
    platform: 'Telegram Bot / Email Alerts',
    instructions: 'Send alerts to your phone/email:',
    alerts: [
      {
        trigger: `${symbol} >= ₹${entry.toFixed(2)}`,
        message: `🎯 ${symbol} Entry: Price at ₹${entry.toFixed(2)}. Place order.`,
      },
      {
        trigger: `${symbol} <= ₹${stopLoss.toFixed(2)}`,
        message: `🛑 ${symbol} SL: Price at ₹${stopLoss.toFixed(2)}. EXIT NOW!`,
      },
      {
        trigger: `${symbol} >= ₹${target1.toFixed(2)}`,
        message: `📈 ${symbol} T1: Price at ₹${target1.toFixed(2)}. Sell 50%.`,
      },
      {
        trigger: `${symbol} >= ₹${target2.toFixed(2)}`,
        message: `✅ ${symbol} T2: Price at ₹${target2.toFixed(2)}. Exit 100%.`,
      },
    ],
  };

  // Google Calendar template
  templates.calendar = {
    platform: 'Google Calendar / Outlook',
    instructions: 'Schedule these reminders:',
    events: [
      {
        title: `${symbol} - Trade Setup Review`,
        time: 'Tomorrow 09:00 IST',
        reminder: '15 minutes before',
        notes: 'Verify all pre-entry checklist items before market open',
      },
      {
        title: `${symbol} - Intraday Review 1`,
        time: 'Daily 11:00 IST',
        reminder: 'At time of event',
        notes: 'Check trade progress, verify SL/T1/T2 orders active',
      },
      {
        title: `${symbol} - Intraday Review 2`,
        time: 'Daily 14:00 IST',
        reminder: 'At time of event',
        notes: 'Prepare for end-of-day, check targets/SL approaching',
      },
      {
        title: `${symbol} - Market Close Check`,
        time: 'Daily 15:25 IST',
        reminder: '5 minutes before',
        notes: 'Verify position status before market closes',
      },
    ],
  };

  // If earnings data available, add earnings alerts
  if (analysis.section14_earnings?.available) {
    templates.calendar.events.push({
      title: `${symbol} - EARNINGS ANNOUNCEMENT`,
      time: analysis.section14_earnings.earnings.date,
      reminder: '1 day before',
      notes: `⚠️ Plan exit or widen SL. Potential gap: ±${analysis.section14_earnings.gapRisk.worstCaseDown.toFixed(1)}%`,
    });
  }

  return templates;
}

/**
 * Generate setup instructions for alerts
 */
function generateSetupInstructions(symbol, priceAlerts, timeAlerts) {
  return {
    quickSetup: [
      {
        step: 1,
        title: 'Price Alerts (Broker App)',
        action: 'Open your broker app → Alerts',
        items: priceAlerts
          .filter((a) => a.priority === 'CRITICAL' || a.priority === 'HIGH')
          .map((a) => `Set ${a.type}: ${a.condition}`),
        timeEstimate: '5 minutes',
      },
      {
        step: 2,
        title: 'Time Reminders (Phone Calendar)',
        action: 'Add to Google Calendar / Outlook',
        items: [
          'Market Open: 09:15 IST',
          'Mid-morning Review: 11:00 IST',
          'Afternoon Review: 14:00 IST',
          'Market Close: 15:30 IST',
        ],
        timeEstimate: '3 minutes',
      },
      {
        step: 3,
        title: 'Breaking News Alert',
        action: 'Setup Google News / Twitter alert',
        items: [
          `Google News: Search "${symbol}" → Create alert`,
          `Twitter: Follow @NSEIndia, @BSEIndia for market news`,
        ],
        timeEstimate: '2 minutes',
      },
      {
        step: 4,
        title: 'Optional: Telegram Bot',
        action: 'Add price alert bot',
        items: [
          'Invite bot to Telegram group',
          'Set /alert ${symbol} ${entry} entry',
          'Set /alert ${symbol} ${stopLoss} stoploss',
        ],
        timeEstimate: '5 minutes',
      },
    ],
    totalSetupTime: '15 minutes',
    essentialAlerts: [
      { level: stopLoss, type: 'STOPLOSS (CRITICAL)' },
      { level: entry, type: 'ENTRY (HIGH)' },
      { level: target1, type: 'TARGET1 (HIGH)' },
      { level: target2, type: 'TARGET2 (HIGH)' },
    ],
  };
}
