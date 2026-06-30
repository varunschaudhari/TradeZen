/**
 * @file peerComparison.js
 * @description Peer comparison — ranks the analyzed setup against REAL same-sector peers.
 *   Peers come from the Stock master (real sectors); each peer's price, day change, and
 *   20-day return are real (live quotes + cached daily history), and any active signal's
 *   verdict/score/R:R is pulled from the DB. Ranking is on genuine 20-day relative
 *   performance — no fabricated prices or random scores.
 * @author TradeZen Team
 * @created 2026-06-27
 */

import Signal from '../models/Signal.js';
import { getSectorPeers, getSymbolStats } from './marketPeers.js';
import { logger } from '../config/logger.js';

/**
 * @param {string} symbol
 * @param {number} entry
 * @param {number} stopLoss
 * @param {number} target1
 * @param {number} target2
 * @param {number} currentPrice
 * @param {object} detail - stock detail (carries .sector and .simonsScore)
 * @returns {Promise<object>} peer comparison (available:false when no sector peers)
 */
export async function generatePeerComparison(symbol, entry, stopLoss, target1, target2, currentPrice, detail) {
  try {
    const sector = detail?.sector || 'Unknown';
    const peers = await getSectorPeers(symbol, sector, 5);
    if (!peers.length) {
      return { available: false, sector, message: `No same-sector peers found for ${symbol}.` };
    }

    const [stats, peerSignals] = await Promise.all([
      getSymbolStats([symbol, ...peers]),
      Signal.find({ symbol: { $in: peers } }).sort({ createdAt: -1 }).lean(),
    ]);

    // Latest signal per peer.
    const sigBy = {};
    for (const s of peerSignals) if (!sigBy[s.symbol]) sigBy[s.symbol] = s;

    const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
    const yourRR = entry > stopLoss ? round2((target1 - entry) / (entry - stopLoss)) : null;
    const yourReturn20d = stats[symbol]?.return20d ?? null;

    const peerData = peers.map((p) => {
      const st = stats[p] ?? {};
      const sig = sigBy[p];
      const sigRR =
        sig && sig.entryZone?.high && sig.stopLoss
          ? round2((sig.target1 - sig.entryZone.high) / (sig.entryZone.high - sig.stopLoss))
          : sig?.riskReward ?? null;
      return {
        symbol: p,
        price: st.price ?? null,
        changePct: st.changePct ?? null,
        return20d: st.return20d ?? null,
        verdict: sig?.verdict ?? null,
        score: sig?.compositeScore ?? sig?.simonsScore ?? null,
        riskReward: sigRR,
      };
    });

    // Rank on real 20-day relative performance (always available); peers without history
    // are excluded from the percentile.
    const ranked = peerData.filter((p) => p.return20d != null);
    const betterPeers = ranked.filter((p) => (p.return20d ?? -Infinity) > (yourReturn20d ?? -Infinity)).length;
    const totalRanked = ranked.length;
    const percentile = totalRanked ? Math.round(((totalRanked - betterPeers) / totalRanked) * 100) : null;

    let position = 'IN_LINE';
    if (percentile != null) {
      if (percentile >= 80) position = 'SECTOR_LEADER';
      else if (percentile >= 60) position = 'LEADING';
      else if (percentile >= 40) position = 'IN_LINE';
      else position = 'LAGGING';
    }

    const recommendation = buildRecommendation(percentile, betterPeers, totalRanked, yourReturn20d);

    return {
      available: true,
      sector,
      currentSymbol: symbol,
      peerCount: peerData.length,
      your: { return20d: yourReturn20d, riskReward: yourRR, score: detail?.simonsScore ?? null },
      peers: peerData.sort((a, b) => (b.return20d ?? -Infinity) - (a.return20d ?? -Infinity)),
      ranking: { percentile, betterPeers, totalPeers: totalRanked, position },
      recommendation,
      note: 'Peers are real same-sector stocks; ranked on 20-day price performance, with each peer’s latest signal verdict/R:R where available.',
    };
  } catch (err) {
    logger.error('Peer comparison generation failed', { symbol, error: err.message });
    return { available: false, message: 'Peer comparison failed' };
  }
}

function buildRecommendation(percentile, betterPeers, totalRanked, yourReturn20d) {
  if (percentile == null || !totalRanked) {
    return 'Not enough peer history to rank relative performance.';
  }
  const rs = yourReturn20d != null ? `${yourReturn20d > 0 ? '+' : ''}${yourReturn20d}% 20-day` : 'its 20-day';
  if (percentile >= 80) {
    return `${percentile}%ile: sector leader on 20-day performance (${rs}). Outperforming ${totalRanked - betterPeers}/${totalRanked} peers.`;
  }
  if (percentile >= 60) {
    return `${percentile}%ile: leading the sector (${rs}). Only ${betterPeers} peer${betterPeers === 1 ? '' : 's'} stronger.`;
  }
  if (percentile >= 40) {
    return `${percentile}%ile: in line with sector (${rs}). ${betterPeers} of ${totalRanked} peers are stronger.`;
  }
  return `${percentile}%ile: lagging the sector (${rs}). ${betterPeers} of ${totalRanked} peers are outperforming — prefer the leaders.`;
}
