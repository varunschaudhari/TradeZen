/**
 * @file sectorMomentum.js
 * @description Sector momentum & relative strength from REAL data. The stock's relative
 *   strength is its 20-day return vs its same-sector peers (live quotes + cached daily
 *   history). With no sector-index feed available, "sector momentum" is derived from the
 *   peer group's average 20-day return and is labelled as such — no random numbers.
 * @author TradeZen Team
 * @created 2026-06-27
 */

import { getSectorPeers, getSymbolStats } from './marketPeers.js';
import { logger } from '../config/logger.js';

/**
 * @param {string} symbol
 * @param {object} detail - stock detail (carries .sector)
 * @returns {Promise<object>} sector momentum analysis (available:false when no peers)
 */
export async function analyzeSectorMomentum(symbol, detail) {
  try {
    const sector = detail?.sector || 'Unknown';
    const peers = await getSectorPeers(symbol, sector, 5);
    if (!peers.length) {
      return { available: false, sector, message: `No same-sector peers found for ${symbol}.` };
    }

    const stats = await getSymbolStats([symbol, ...peers]);
    const myReturn = stats[symbol]?.return20d ?? null;

    const peerReturns = peers
      .map((p) => ({ symbol: p, return20d: stats[p]?.return20d ?? null }))
      .filter((p) => p.return20d != null);

    if (myReturn == null || !peerReturns.length) {
      return { available: false, sector, message: 'Insufficient price history for sector relative strength.' };
    }

    // ── Sector momentum: peer-group average 20-day return, mapped to 0–100 (labelled,
    //    since this is peer-derived, not a true sector index). +10% 20d → ~83, flat → 50.
    const avgPeerReturn = peerReturns.reduce((s, p) => s + p.return20d, 0) / peerReturns.length;
    const score = Math.max(0, Math.min(100, Math.round(50 + avgPeerReturn * 3.3)));
    const strength =
      score >= 70 ? 'STRONG' : score >= 60 ? 'POSITIVE' : score >= 40 ? 'NEUTRAL' : score >= 30 ? 'NEGATIVE' : 'WEAK';
    const trend = avgPeerReturn >= 0 ? 'UPTREND' : 'DOWNTREND';

    // ── Relative strength: where the stock's 20-day return ranks within the peer group ──
    const stronger = peerReturns.filter((p) => p.return20d > myReturn).length;
    const total = peerReturns.length;
    const percentile = Math.round(((total - stronger) / total) * 100);
    const rank = `${stronger + 1} of ${total + 1}`;
    let position = 'IN_LINE';
    if (percentile >= 80) position = 'MARKET_LEADER';
    else if (percentile >= 60) position = 'LEADING';
    else if (percentile >= 40) position = 'IN_LINE';
    else if (percentile >= 20) position = 'LAGGING';
    else position = 'LAGGARD';

    return {
      available: true,
      symbol,
      sector,
      sectorMomentum: {
        score,
        strength,
        trend,
        avgPeerReturn20d: Math.round(avgPeerReturn * 10) / 10,
        basis: 'Peer-group avg 20-day return (no sector-index feed — derived from real peer prices)',
      },
      ranking: {
        relativeStrength: myReturn,
        percentile,
        position,
        ranking: rank,
        peersStronger: stronger,
        totalPeers: total,
      },
      peers: peerReturns
        .map((p) => ({ symbol: p.symbol, relativeStrength: p.return20d }))
        .sort((a, b) => b.relativeStrength - a.relativeStrength),
      actionable: buildActionable(symbol, myReturn, position, strength),
    };
  } catch (err) {
    logger.error('Sector momentum analysis failed', { symbol, error: err.message });
    return { available: false, message: 'Sector momentum failed' };
  }
}

function buildActionable(symbol, myReturn, position, strength) {
  const rs = `${myReturn > 0 ? '+' : ''}${myReturn}% 20-day`;
  let recommendation;
  let riskLevel = 'MEDIUM';
  if (position.includes('LEADER') && (strength === 'STRONG' || strength === 'POSITIVE')) {
    recommendation = `${symbol} is leading a rising sector (${rs}) — momentum tailwind supports the setup.`;
    riskLevel = 'LOW';
  } else if (position === 'LAGGARD') {
    recommendation = `${symbol} is lagging its sector peers (${rs}) — needs stock-specific strength to justify entry.`;
    riskLevel = 'HIGH';
  } else if (strength === 'WEAK' || strength === 'NEGATIVE') {
    recommendation = `Sector is weak (${rs} stock); require strong individual confirmation before entry.`;
    riskLevel = 'HIGH';
  } else {
    recommendation = `${symbol} is mid-pack in its sector (${rs}); rely on the stock-specific setup.`;
  }
  return { recommendation, riskLevel };
}
