/**
 * @file tradingCosts.js
 * @description Real Indian equity trading costs, so paper results are judged NET —
 *   an edge that dies to charges must die on paper, not in a live account. Itemized
 *   at current discount-broker (Zerodha-style) rates:
 *
 *     DELIVERY (swing):  brokerage ₹0 · STT 0.1% both sides · NSE txn 0.00297% both
 *                        sides · SEBI 0.0001% both sides · stamp 0.015% buy only
 *     INTRADAY:          brokerage min(0.03%, ₹20)/side · STT 0.025% sell only ·
 *                        NSE txn 0.00297% · SEBI 0.0001% · stamp 0.003% buy only
 *     GST 18% on (brokerage + exchange txn + SEBI) both modes.
 *
 *   Slippage is modeled separately (per-side % of traded value) because it's a market
 *   cost, not a statutory one — and for market-order entries it usually dwarfs charges.
 *   Rates live here (not constants.js) since they form one cohesive model; revisit
 *   yearly against the broker's charge sheet.
 *
 * @author TradeZen Team
 * @created 2026-07-07
 */

const round2 = (n) => Math.round(n * 100) / 100;

const RATES = {
  DELIVERY: {
    brokeragePctPerSide: 0, // discount brokers: ₹0 delivery brokerage
    brokerageCapPerSide: 0,
    sttBuyPct: 0.1,
    sttSellPct: 0.1,
    stampBuyPct: 0.015,
    slippagePctPerSide: 0.05, // entry-zone limit-ish fills; conservative
  },
  INTRADAY: {
    brokeragePctPerSide: 0.03,
    brokerageCapPerSide: 20, // min(0.03%, ₹20) per executed order
    sttBuyPct: 0,
    sttSellPct: 0.025,
    stampBuyPct: 0.003,
    slippagePctPerSide: 0.08, // market orders chasing a breakout — realistic, not kind
  },
};
const EXCHANGE_TXN_PCT = 0.00297; // NSE, both sides
const SEBI_FEES_PCT = 0.0001; // both sides
const GST_PCT = 18; // on brokerage + exchange txn + SEBI

/**
 * Itemized round-trip cost estimate for one trade (pure).
 *
 * @param {number} entry - Entry price
 * @param {number} exit - Exit price
 * @param {number} shares - Quantity
 * @param {'DELIVERY'|'INTRADAY'} [mode='DELIVERY']
 * @returns {{ brokerage:number, stt:number, exchangeTxn:number, sebiFees:number,
 *   stampDuty:number, gst:number, charges:number, slippage:number, total:number }}
 *   `charges` = statutory+broker; `total` = charges + slippage.
 */
export function estimateTradeCosts(entry, exit, shares, mode = 'DELIVERY') {
  const r = RATES[mode] ?? RATES.DELIVERY;
  const buyValue = (entry ?? 0) * (shares ?? 0);
  const sellValue = (exit ?? 0) * (shares ?? 0);
  if (!(buyValue > 0) || !(sellValue > 0)) {
    return { brokerage: 0, stt: 0, exchangeTxn: 0, sebiFees: 0, stampDuty: 0, gst: 0, charges: 0, slippage: 0, total: 0 };
  }

  const sideBrokerage = (v) => {
    const pct = (v * r.brokeragePctPerSide) / 100;
    return r.brokerageCapPerSide > 0 ? Math.min(pct, r.brokerageCapPerSide) : pct;
  };
  const brokerage = sideBrokerage(buyValue) + sideBrokerage(sellValue);
  const stt = (buyValue * r.sttBuyPct + sellValue * r.sttSellPct) / 100;
  const exchangeTxn = ((buyValue + sellValue) * EXCHANGE_TXN_PCT) / 100;
  const sebiFees = ((buyValue + sellValue) * SEBI_FEES_PCT) / 100;
  const stampDuty = (buyValue * r.stampBuyPct) / 100;
  const gst = ((brokerage + exchangeTxn + sebiFees) * GST_PCT) / 100;
  const charges = brokerage + stt + exchangeTxn + sebiFees + stampDuty + gst;
  const slippage = ((buyValue + sellValue) * r.slippagePctPerSide) / 100;

  return {
    brokerage: round2(brokerage),
    stt: round2(stt),
    exchangeTxn: round2(exchangeTxn),
    sebiFees: round2(sebiFees),
    stampDuty: round2(stampDuty),
    gst: round2(gst),
    charges: round2(charges),
    slippage: round2(slippage),
    total: round2(charges + slippage),
  };
}

/**
 * Net P&L after estimated costs (pure convenience).
 *
 * @param {number} grossPnl - (exit − entry) × shares
 * @param {number} entry
 * @param {number} exit
 * @param {number} shares
 * @param {'DELIVERY'|'INTRADAY'} [mode='DELIVERY']
 * @returns {{ netPnl:number, costs:object }}
 */
export function netAfterCosts(grossPnl, entry, exit, shares, mode = 'DELIVERY') {
  const costs = estimateTradeCosts(entry, exit, shares, mode);
  return { netPnl: round2((grossPnl ?? 0) - costs.total), costs };
}
