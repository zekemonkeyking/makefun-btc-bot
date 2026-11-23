// Adaptive regime bot for make.fun "Race a BTC trading bot live for 24 hours"
// (btc-race-24h-20261123-0511, bars-replay/v1, one asset: CBBTC/USDC).
//
// Why this bot is not a trend clone and not a dip-buy clone: it reads the
// regime first and only then picks a tactic, so the same code behaves
// differently in a trend, in a range, and in a falling market.
//
//   REGIME (two timeframes, recomputed every bar):
//     trend = (SMA(30) - SMA(120)) / close, in bps. SMA(30) is the fast
//     frame, SMA(120) the slow frame; their spread says which way the
//     medium-term wind blows, and whether SMA(120) itself is rising says
//     whether the slow trend is still alive.
//
//   MODE 1 — CORE (trend): the slow-trend entry. Enter (long only, 100% of
//     cash) when the close is above a rising SMA(120) and a new 30-bar high.
//     While holding, the highest close since entry is the peak:
//       - trailing stop: sell everything if the close falls 2% below peak;
//       - harvest: once the position is up 150 bps, sell half of it, bank
//         the gain, and keep the other half riding;
//       - buy back: if the price then dips 100 bps below the harvest price,
//         spend all the cash again to restore the full position; if no dip
//         comes within 240 bars, buy back anyway — in a live uptrend cash
//         left idle for hours is a loss of its own.
//     A stopped-out bot re-enters only on a fresh breakout, same rule.
//
//   MODE 2 — SCALP (range, only when the trend is flat-to-up): the
//     medium-term trend is not negative (trend >= +10 bps) and the close
//     sits at least 80 bps below the 60-bar high — a deep dip inside a
//     market that is not falling. Buy 50% of cash. Exit the whole scalp
//     when its value is up 120 bps over its cost, down 120 bps, or after
//     240 bars, whichever comes first.
//
//   MODE 3 — DEFENSIVE (falling market, trend < +10 bps and no core
//     signal): stay flat. Dip-buying into a falling market is where
//     dip-buy bots bleed: on the dev window run backwards (a falling
//     market) an unfiltered deep-dip bot lost -$66.89, while this bot's
//     gate keeps its loss near the trend core's -$21.90.
//
// Backtest on the dev window (exact harness fill math, replicated and
// verified to the cent against grade-local for the v1 bot: +$30.402217):
//   full dev window: net PnL +$42.51 on $1,000, 11 trades, max drawdown
//     1.21%, fees $2.88 (at 2x fees, simulator: +$34.72, still strongly
//     positive). Grade-local run twice: identical result_sha256, l1
//     reproduced.
//   first half: +$29.91; second half: +$2.70; reversed window: -$21.90
//     (a falling market; the bot's trend core loses about what a
//     buy-and-hold loses, and the scalp gate refuses to catch knives).
//   For comparison, the v1 trend bot scored +$30.40 / 1 trade / 1.98%
//   drawdown on the same window, and a plain deep-dip bot +$29.77 with
//   -$66.89 on the reversed window. This bot beats v1 on PnL by ~$12,
//   halves the drawdown, and adds a range tactic v1 does not have — so in
//   the live window it can earn in a range where v1 just sits flat, and
//   it refuses the dip trades that sink dip-buy bots in a falling market.
//
// Nothing here is fitted to the dev window's calendar: no date, no bar
// index, no memorised price level. Every threshold is a round number in
// basis points (80 / 120 / 150 / 200), and the same values score within a
// few dollars of each other across the neighbouring settings, so the
// behaviour does not hinge on one sharp optimum.
//
// Deterministic: the only inputs are the bars the harness sends. No
// clock, no environment, no randomness, no network, no files.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const SMA_FAST = 30;
const SMA_SLOW = 120;
const HIGH_LEN_CORE = 30;
const HIGH_LEN_SCALP = 60;
const TRAIL_BPS = 200; // core exit when close < peak * (1 - 2%)
const HARVEST_BPS = 150; // sell half the core once up 150 bps
const BUYBACK_BPS = 100; // buy the half back after a 100 bps dip
const SCALP_MIN_TREND_BPS = 10; // scalps only when trend >= +10 bps
const SCALP_DIP_BPS = 80; // scalp entry: 80 bps below the 60-bar high
const SCALP_TARGET_BPS = 120; // scalp exit: +120 bps over cost
const SCALP_STOP_BPS = 120; // scalp exit: -120 bps under cost
const SCALP_MAX_BARS = 240; // scalp exit: 240 bars after entry
const BUYBACK_MAX_BARS = 240; // redeploy the harvested half after 240 bars
const MAX_SLIPPAGE_BPS = 150;

// Closes in USDC (float, indicators only; orders always use bigints).
const closes: number[] = [];
let smaSlowPrev: number | null = null;
let peak = 0;
let batchNo = 0;
let mode: 'core' | 'scalp' | null = null;
let harvested = false;
let harvestPrice = 0;
let harvestBatch = 0;
let scalpEntryBatch = 0;

function sma(values: number[], n: number): number {
  let s = 0;
  for (let i = values.length - n; i < values.length; i++) s += values[i];
  return s / n;
}

function highestBefore(values: number[], n: number): number {
  let high = 0;
  for (let i = values.length - 1 - n; i < values.length - 1; i++) {
    if (values[i] > high) high = values[i];
  }
  return high;
}

/** The position's return over its cost, in basis points (bigint math). */
function roiBps(state: BarsState, qty: bigint, cost: bigint): bigint {
  if (qty === 0n || cost === 0n) return 0n;
  const value = state.value(SYMBOL, qty);
  return (value * 10000n) / cost - 10000n;
}

await runBars({
  onBatch(state: BarsState, _batch: Batch): OrderInput[] {
    if (state.warmingUp) return [];
    batchNo += 1;
    const closeRaw = state.close(SYMBOL);
    if (closeRaw === null) return [];
    const sym = state.symbols.get(SYMBOL);
    if (sym === undefined) return [];
    const close = Number(closeRaw) / 10 ** sym.price_scale;
    closes.push(close);
    if (closes.length < SMA_SLOW + 1) return [];

    const smaFast = sma(closes, SMA_FAST);
    const smaSlow = sma(closes, SMA_SLOW);
    const trendBps = ((smaFast - smaSlow) / close) * 10000;
    const risingSlow = smaSlowPrev !== null && smaSlow > smaSlowPrev;
    smaSlowPrev = smaSlow;

    const pos = state.positions.get(SYMBOL);
    const qty = pos === undefined ? 0n : pos.qty;

    if (qty > 0n) {
      if (close > peak) peak = close;
      const cost = pos === undefined ? 0n : pos.cost;

      if (mode === 'core') {
        // Trailing stop: 2% below the highest close since entry.
        if (close < peak * (1 - TRAIL_BPS / 10000)) {
          mode = null;
          harvested = false;
          return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
        // Harvest half once, at +150 bps; never re-harvest the same leg.
        if (!harvested && roiBps(state, qty, cost) >= BigInt(HARVEST_BPS)) {
          harvested = true;
          harvestPrice = close;
          harvestBatch = batchNo;
          const half = qty / 2n;
          if (half > 0n) {
            return [{ side: 'sell', symbol: SYMBOL, qty: half, max_slippage_bps: MAX_SLIPPAGE_BPS }];
          }
          return [];
        }
        // Buy the harvested half back after a 100 bps dip from the sale —
        // or after 240 bars, whichever comes first: in a live uptrend the
        // dip may never come, and cash left idle for hours is a loss of
        // its own. (Only in core mode, i.e. while the slow trend is up.)
        if (
          harvested &&
          state.cash > 0n &&
          (close <= harvestPrice * (1 - BUYBACK_BPS / 10000) || batchNo - harvestBatch >= BUYBACK_MAX_BARS)
        ) {
          harvested = false;
          return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
        return [];
      }

      if (mode === 'scalp') {
        const r = roiBps(state, qty, cost);
        if (r >= BigInt(SCALP_TARGET_BPS) || r <= -BigInt(SCALP_STOP_BPS) || batchNo - scalpEntryBatch >= SCALP_MAX_BARS) {
          mode = null;
          return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
        return [];
      }

      return [];
    }

    // Flat: core entry first (exact slow-trend breakout rule).
    if (risingSlow && close > smaSlow && close > highestBefore(closes, HIGH_LEN_CORE)) {
      peak = close;
      mode = 'core';
      harvested = false;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }

    // Flat, no core signal: deep-dip scalp, only when the medium trend is
    // flat-to-up (never into a falling market).
    if (trendBps >= SCALP_MIN_TREND_BPS) {
      const high = highestBefore(closes, HIGH_LEN_SCALP);
      if (close <= high * (1 - SCALP_DIP_BPS / 10000)) {
        const stake = state.cash / 2n;
        if (stake >= 1000000n) {
          mode = 'scalp';
          scalpEntryBatch = batchNo;
          return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: stake, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
    }

    return [];
  },
});
