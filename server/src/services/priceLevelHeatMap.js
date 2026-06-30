/**
 * @file priceLevelHeatMap.js
 * @description Price level heat map - volume profile and key levels visualization
 */

import { logger } from '../config/logger.js';

/**
 * Generate price level heat map showing volume profile and key levels
 * @param {number} currentPrice - Current market price
 * @param {number} entry - Entry price
 * @param {number} stopLoss - Stop loss price
 * @param {number} target1 - First target
 * @param {number} target2 - Second target
 * @param {Object} analysis - Full analysis data
 * @returns {Object} price level heat map
 */
export function generatePriceLevelHeatMap(currentPrice, entry, stopLoss, target1, target2, analysis) {
  try {
    // Get support/resistance levels from analysis
    const liquidity = analysis.section12_liquidity;

    // Create price levels with confidence scores
    const priceLevels = [];

    // Add entry level
    priceLevels.push({
      price: entry,
      type: 'entry',
      label: 'Entry',
      strength: 85,
      description: 'Entry zone - high volume expected',
      volume: 'HIGH',
      imbalance: 0,
    });

    // Add stop loss level
    priceLevels.push({
      price: stopLoss,
      type: 'stoploss',
      label: 'Stop Loss',
      strength: 80,
      description: 'Critical support - below here = exit',
      volume: 'MEDIUM',
      imbalance: -1,
    });

    // Add target 1
    priceLevels.push({
      price: target1,
      type: 'target1',
      label: 'Target 1',
      strength: 70,
      description: 'First profit target - 50% book here',
      volume: 'MEDIUM',
      imbalance: 1,
    });

    // Add target 2
    priceLevels.push({
      price: target2,
      type: 'target2',
      label: 'Target 2',
      strength: 75,
      description: 'Second profit target - full exit',
      volume: 'HIGH',
      imbalance: 1,
    });

    // Calculate order flow between levels
    const orderFlow = calculateOrderFlow(currentPrice, entry, stopLoss, target1, target2);

    // Calculate volume profile zones
    const volumeZones = calculateVolumeZones(currentPrice, entry, stopLoss, target1, target2);

    // Get support/resistance if available from liquidity
    const supportResistance = extractSupportResistance(liquidity);

    // Calculate imbalance (buy vs sell pressure)
    const imbalanceAnalysis = analyzeImbalance(orderFlow, currentPrice, entry);

    // Create heat intensity map
    const heatMap = createHeatIntensityMap(priceLevels, currentPrice, analysis);

    return {
      timestamp: new Date(),
      currentPrice,
      levels: priceLevels.sort((a, b) => b.price - a.price),
      orderFlow,
      volumeZones,
      supportResistance,
      imbalance: imbalanceAnalysis,
      heatMap,
      interpretation: interpretPriceLevelMap(priceLevels, currentPrice, imbalanceAnalysis),
      basis:
        'Levels, heat and S/R are real (trade levels + proximity + liquidity zones). ' +
        'Order-flow/volume labels are heuristic estimates inferred from price structure — ' +
        'retail data has no live order-book or volume-at-price feed.',
    };
  } catch (err) {
    logger.error('Price level heat map generation failed', { error: err.message });
    return null;
  }
}

function calculateOrderFlow(currentPrice, entry, stopLoss, target1, target2) {
  const orderFlow = [];

  // Calculate flow between price levels
  if (currentPrice < entry) {
    orderFlow.push({
      zone: 'BELOW_ENTRY',
      range: `₹${Math.min(currentPrice, stopLoss).toFixed(2)} - ₹${entry.toFixed(2)}`,
      signal: 'ACCUMULATION',
      strength: 'STRONG',
      description: 'Buyers stepping in at lower levels',
    });
  }

  if (currentPrice > entry && currentPrice < target1) {
    orderFlow.push({
      zone: 'ENTRY_TO_T1',
      range: `₹${entry.toFixed(2)} - ₹${target1.toFixed(2)}`,
      signal: 'MOMENTUM_UP',
      strength: 'STRONG',
      description: 'Price moving toward first target',
    });
  }

  if (currentPrice > target1) {
    orderFlow.push({
      zone: 'ABOVE_T1',
      range: `₹${target1.toFixed(2)} - ₹${target2.toFixed(2)}`,
      signal: 'STRONG_MOMENTUM',
      strength: 'VERY_STRONG',
      description: 'Price extended. Profit protection advised.',
    });
  }

  return orderFlow;
}

function calculateVolumeZones(currentPrice, entry, stopLoss, target1, target2) {
  const zones = [];

  // Identify volume concentration zones
  const zoneSize = Math.abs(entry - stopLoss);

  // Zone 1: Below entry (accumulation)
  zones.push({
    zone: 'ZONE_1_SUPPORT',
    priceRange: { low: stopLoss, high: entry },
    volumeIntensity: 'MEDIUM',
    description: 'Support zone. Accumulation area if price revisits.',
  });

  // Zone 2: Entry (key level)
  zones.push({
    zone: 'ZONE_2_ENTRY',
    priceRange: { low: entry - zoneSize * 0.1, high: entry + zoneSize * 0.1 },
    volumeIntensity: 'VERY_HIGH',
    description: 'Entry zone. High volume expected. Testing entry multiple times common.',
  });

  // Zone 3: T1 (intermediate resistance)
  zones.push({
    zone: 'ZONE_3_RESISTANCE',
    priceRange: { low: target1 - zoneSize * 0.2, high: target1 + zoneSize * 0.2 },
    volumeIntensity: 'HIGH',
    description: 'Resistance/T1 zone. Profit taking area. May consolidate.',
  });

  // Zone 4: T2 (extended target)
  zones.push({
    zone: 'ZONE_4_TARGET',
    priceRange: { low: target2 - zoneSize * 0.3, high: target2 + zoneSize * 0.3 },
    volumeIntensity: 'MEDIUM',
    description: 'Extended target zone. Lower volume. Full exit here.',
  });

  return zones;
}

function extractSupportResistance(liquidity) {
  if (!liquidity || !liquidity.available) {
    return { support: [], resistance: [] };
  }

  const levels = liquidity.levels;
  const support = [];
  const resistance = [];

  // Extract from liquidity analysis levels
  if (levels.stopLoss?.liquidity === 'EXCELLENT') {
    support.push({
      price: levels.stopLoss.price,
      strength: 'STRONG',
      type: 'DEMAND',
      description: 'Stop Loss level - strong demand below entry',
    });
  }

  if (levels.entry?.liquidity === 'EXCELLENT') {
    resistance.push({
      price: levels.entry.price,
      strength: 'STRONG',
      type: 'SUPPLY',
      description: 'Entry level - supply/resistance zone',
    });
  }

  if (levels.target1?.liquidity === 'EXCELLENT') {
    resistance.push({
      price: levels.target1.price,
      strength: 'MEDIUM',
      type: 'SUPPLY',
      description: 'Target 1 - intermediate resistance',
    });
  }

  if (levels.target2?.liquidity === 'EXCELLENT') {
    resistance.push({
      price: levels.target2.price,
      strength: 'MEDIUM',
      type: 'SUPPLY',
      description: 'Target 2 - supply zone',
    });
  }

  return { support, resistance };
}

function analyzeImbalance(orderFlow, currentPrice, entry) {
  let buyPressure = 0;
  let sellPressure = 0;

  orderFlow.forEach((flow) => {
    if (flow.signal === 'ACCUMULATION') {
      buyPressure += 2;
    } else if (flow.signal === 'MOMENTUM_UP') {
      buyPressure += 1;
    } else if (flow.signal === 'STRONG_MOMENTUM') {
      buyPressure += 2;
    }
  });

  const imbalance = buyPressure - sellPressure;
  let direction = 'BALANCED';
  let strength = 'NEUTRAL';

  if (imbalance > 2) {
    direction = 'BUY_IMBALANCE';
    strength = 'STRONG';
  } else if (imbalance > 0) {
    direction = 'SLIGHT_BUY';
    strength = 'MODERATE';
  } else if (imbalance < -2) {
    direction = 'SELL_IMBALANCE';
    strength = 'STRONG';
  } else if (imbalance < 0) {
    direction = 'SLIGHT_SELL';
    strength = 'MODERATE';
  }

  return {
    imbalanceScore: imbalance,
    direction,
    strength,
    description: `Price-structure bias: ${direction.toLowerCase()} (${strength.toLowerCase()}). Inferred from price position vs the trade levels — not live order-book data.`,
  };
}

function createHeatIntensityMap(priceLevels, currentPrice, analysis) {
  const map = {};

  priceLevels.forEach((level) => {
    let intensity = 0;

    // Intensity based on proximity to current price
    const distance = Math.abs(level.price - currentPrice);
    const proximity = 1 / (1 + distance / currentPrice * 100); // closer = higher score

    // Intensity based on level type
    const typeScore = {
      entry: 90,
      target1: 75,
      target2: 70,
      stoploss: 85,
    };

    // Combined intensity
    intensity = Math.round((typeScore[level.type] * 0.7 + proximity * 100 * 0.3));

    map[level.label] = {
      intensity,
      color: getHeatColor(intensity),
      proximity: Math.round(proximity * 100),
    };
  });

  return map;
}

function getHeatColor(intensity) {
  // Intensity 0-100 → Color mapping
  if (intensity >= 85) return '#ff0000'; // Red - highest heat
  if (intensity >= 70) return '#ff6600'; // Orange-red
  if (intensity >= 55) return '#ffaa00'; // Orange
  if (intensity >= 40) return '#ffff00'; // Yellow
  if (intensity >= 25) return '#00ff00'; // Green
  return '#0099ff'; // Blue - lowest heat
}

function interpretPriceLevelMap(priceLevels, currentPrice, imbalance) {
  const findings = [];

  // Find closest level
  let closestLevel = null;
  let minDistance = Infinity;

  priceLevels.forEach((level) => {
    const distance = Math.abs(level.price - currentPrice);
    if (distance < minDistance) {
      minDistance = distance;
      closestLevel = level;
    }
  });

  if (closestLevel) {
    findings.push(
      `Closest level: ${closestLevel.label} at ₹${closestLevel.price.toFixed(2)} (${minDistance.toFixed(2)} away)`
    );
  }

  // Find distance to entry
  const entryLevel = priceLevels.find((l) => l.type === 'entry');
  if (entryLevel) {
    const distanceToEntry = entryLevel.price - currentPrice;
    if (distanceToEntry > 0) {
      findings.push(`Entry is ₹${distanceToEntry.toFixed(2)} above current price`);
    } else {
      findings.push(`Already ${(distanceToEntry / entryLevel.price * 100).toFixed(1)}% above entry`);
    }
  }

  // Imbalance interpretation
  if (imbalance.direction === 'BUY_IMBALANCE') {
    findings.push('Strong buy imbalance - expect continued upside');
  } else if (imbalance.direction === 'SELL_IMBALANCE') {
    findings.push('Sell pressure present - watch for support holds');
  }

  return findings;
}
