# TradeZen — Edge Investigation Findings & Honest Verdict

_Last updated: 2026-06-27. This document records the cost-aware, out-of-sample
investigation into whether TradeZen's signals have a tradeable edge, so the work is
preserved and the project is positioned truthfully. **Read this before claiming the
system makes money, or before risking real capital.**_

---

## The question

Does TradeZen's signal stack (8 gates + Simons composite score) have a **real, robust,
cost-surviving edge** — or does it just *look* authoritative?

## How it was tested

Walk-forward backtester (`server/src/services/backtestEngine.js`) with deliberate realism
guards so results can't flatter themselves:

- **Point-in-time** — each bar reconstructs only the data known that day (no look-ahead).
- **Next-bar-open entry** — fills on the open after the signal, never intrabar.
- **Worst-case straddle** — the stop fills before the target on a bar that hits both.
- **Min-stop floor** — prevents tiny-stop R inflation.
- **Live scorers reused verbatim** — the same `runAllGates` + `calculateSimonsSignals` the
  live system uses, so the backtest can't drift from production.
- **NSE cost model** — statutory (STT/exchange/stamp/GST ≈ 0.12%/side) + ATR-scaled
  slippage (volatility as a liquidity proxy), expressed in R.

Outcome metric: **avg R per trade** (gross and **net of costs**), plus win-rate-by-score
bucket for threshold calibration, and a per-signal edge (lift) analysis.

---

## What we found, step by step

**Baseline.** As originally configured, the strategy was ~breakeven gross (**+0.05R**) and
the composite score did **not** separate winners from losers (score buckets were flat).

**Step 1 — Rebuilt the composite from measured edge.** Added RSI sweet-spot scoring (the
biggest measured signal, previously unscored), neutralized an **inverted** volume reward,
tightened the RS bonus to the top tier, added overbought penalties, and recalibrated the
BUY threshold (70 → 60; the old 70 was mathematically unreachable from price signals).
→ In-sample, the score finally became a **filter**: the 60–69 bucket ran +0.20 to +0.35R.

**Step 2 — Universe (large-cap vs mid-cap).** Mid-caps had ~2× the *gross* ambient edge
(+0.08 vs +0.04R), but the composite score only *ranked* large-caps; in mid-caps it was
flat/inverted (their edge is momentum-driven, which our overbought penalties fight).

**Step 3 — Costs.** Round-trip cost ≈ **0.15–0.16R per trade**. After costs:
- Broad trading of **either** tier is **net-negative** (large −0.11R, mid −0.08 to −0.10R).
- **Mid-cap's gross edge vanished** — it was just compensation for higher slippage.
- The **only** net-positive cohort was **large-cap + composite ≥ 60** (+0.14 to +0.36R net)
  — but that was measured partly in-sample.

**Validation — out-of-sample (the decider).** Re-ran the lone survivor on **fresh large-cap
names** (not in the weight-fit set) over **2y and a regime-spanning 5y**:

| large-cap `60–69` (NET avg R) | In-sample | Fresh, 2y | Fresh, 5y |
|---|---|---|---|
| fixed:10 / adaptive | **+0.14 / +0.36** | **−0.19 / −0.23** | **−0.09 / −0.12** |

On unseen names the cohort **loses money after costs**, in both windows, and the score
**stops ranking** (fresh 5y: `<50` gross +0.09 = `60–69` gross +0.07). The in-sample
result was **overfit**.

---

## The verdict

**TradeZen has no robust, cost-surviving, out-of-sample edge in price signals alone on
liquid NSE equities.** Gross edges are thin (~+0.05 to +0.09R) and costs (~0.15R/trade)
eat them. This is the *expected* result for price-only signals on a fairly efficient,
cost-laden market — it is an honest finding, not a bug in the analysis.

### What TradeZen **is**
A genuinely strong **risk-managed paper-trading / discipline tool**: it enforces
no-downtrend / no-earnings / R:R ≥ 2 / position & capital caps / daily-loss pause, and it
can rigorously **measure itself** (backtest, signal-edge, cost model). That discipline is
the part most retail setups get wrong, and it's correct here.

### What TradeZen **is not (yet)**
A validated alpha engine. **Do not trade real capital on its signals.** Treat every "BUY"
as a hypothesis, not an instruction. `scoreConfidence` (HIGH/MEDIUM/LOW) is a heuristic,
**not** a validated edge predictor — the score did not generalize out-of-sample.

---

## Forward paper-trade protocol (the only test left)

Backtests can be wrong; the one truly out-of-sample test is live-forward. Run it **honestly,
expecting breakeven**, as the system's own go-live guard (`performanceEngine.evaluateGoLive`):

1. **`paperTradeMode: true`** (default — never flip to live based on backtests).
2. Let the scanner run in market hours; it records signals + tracked (paper) trades.
3. After **≥ 3 weeks**, check `evaluateGoLive`: it requires **positive realized expectancy
   AND win rate ≥ 50%** before it would even suggest going live.
4. **Expectation, stated plainly:** the backtests predict this gate will **not** pass with
   the current price-only signals. If it somehow does, treat it as a hypothesis to re-test,
   not a green light.

> Safety invariants (never remove): no auto-execution / no broker order submission;
> `paperTradeMode` default true; BUY requires Claude HIGH; max 3 open trades; ≤60% capital
> deployed; ≤1% risk/trade; 3% daily-loss pause.

---

## PEAD investigation (the one evidence-backed lever — tested 2026-06-27)

PEAD (post-earnings-announcement drift) was the most defensible remaining lever: a
documented academic anomaly, event-driven, and low-turnover (30-day hold → costs barely
bite). yfinance gave free, complete NSE earnings dates + Surprise% (24 quarters/stock).

- **Raw test:** large positive surprises (>10%) drifted strongly (+0.67R net) — but the
  MISS bucket was *also* positive, a tell that **market beta** (a 6-year bull market) was
  inflating raw returns.
- **Market-adjusted (excess over Nifty):** ~60% of the raw edge was beta. BIG_BEAT survived
  at +0.28R net (first basket), and held +0.14R in 2024–26 — looked promising.
- **OOS + sensitivity (fresh 38-name basket) — FAILED:**
  - Recent (2024–26) BIG_BEAT collapsed from +0.14 → **−0.01** on fresh names.
  - Surprise→drift was **non-monotonic** (2–5: −0.26, 5–10: +0.36, 10–15: −0.21, >15: +0.21)
    — the signature of noise, not a dose-response.
  - Recent net was **flat-to-negative across all hold windows**; only ALL-period numbers
    were positive and grew with hold length (residual beta).

**Verdict: no robust, current, market-adjusted, cost-surviving PEAD edge in liquid NSE
names.** It worked in 2020–23 and is gone by 2024–26 — a documented anomaly arbitraged away
in the liquid universe. (Scratch scripts: `scratchpad/pead_bt*.py`.)

## Both evidence-based levers have now failed the same bar

| Lever | Result |
|---|---|
| Price-signal composite (reweighted) | No OOS edge; in-sample gradient was overfit |
| PEAD (earnings drift) | Promising, then failed OOS + monotonicity + recent-period |

**The signal-based, free-data, liquid-NSE path to alpha is exhausted.** Stop tuning; the
honest conclusion stands.

## Where any remaining edge would have to come from (worse tradeability — diminishing returns)

These are long shots requiring terrain that's harder to trade and harder to get data for:

- **PEAD / anomalies in small-caps** — academically stronger, but worse liquidity/data and
  higher costs (which already killed mid-caps here).
- **The other unwired signals** — FII/DII flows, sector rotation, promoter activity (scored
  in the composite but never fire without a data feed). Lower prior than PEAD, now tested.
- **Alternative data / intraday / event-driven** beyond daily price + earnings.
- **Alternative data / shorter timeframe / event-driven** setups, or options-based
  strategies — different edges than daily price technicals.
- **Cost reduction** — wider stops (lower cost-in-R), lower turnover, longer holds; the
  score≥60 filter already reduces trade count, which helps net even without gross edge.

Any new candidate must clear the **same bar this investigation set**: positive **net-of-cost**
expectancy that **holds out-of-sample** (fresh names + a different period). Nothing less.
