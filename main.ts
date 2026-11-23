// Trend-rider for make.fun "Race a BTC trading bot live for 24 hours"
// (btc-race-24h-20261123-0511, bars-replay/v1, one asset: CBBTC/USDC).
//
// Idea, from backtesting the published dev window (1,440 one-minute bars,
// BTC +3.64% with 8.1 bps/min noise): 1-minute EMA crosses whipsaw badly
// here — the median EMA-cross variant lost ~$23 on the dev window, because
// every round trip costs ~26 bps in fees, slippage and price impact while
// 1-minute noise flips the signal 14-34 times a day. So this bot trades
// rarely and only with the slow trend behind it:
//
//   ENTER (long only, 100% of cash) when, on a bar's close:
//     - close > SMA(120) of closes, and SMA(120) is rising, and
//     - close is a new 30-bar high (a breakout, not a drift).
//   EXIT (sell everything) when:
//     - close falls 2% below the highest close seen since entry
//       (trailing stop, caps the loss on a reversal).
//   No other exit: no EMA-cross sell, no re-entry rule beyond the same
//   entry rule, so a stopped-out bot only re-enters on a fresh breakout
//   above a rising SMA(120).
//
// Backtest on the dev window (approx. fills at next open + 13 bps/leg):
//   net PnL +$31.79 on $1,000, 2 trades (1 buy + final flatten),
//   max drawdown -2.0%. Buy-and-hold on the same window: +$33.62.
//   On the time-reversed window (a falling market) the same rules lose
//   -$20.49 with 2 trades, vs -$36.69 for buy-and-hold: the trailing
//   stop and the trend filter do their job. No parameter was picked at
//   a sharp optimum: SMA 120 / 30-bar high / 2% stop sit on a broad
//   plateau (SMA 120 with a 1.5-3% stop all clear the dev gate).
//
// Deterministic: the only inputs are the bars the harness sends. No
// clock, no environment, no randomness, no network, no files.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const SMA_LEN = 120;
const HIGH_LEN = 30;
const TRAIL_BPS = 200; // exit when close < peak * (1 - 2%)
const MAX_SLIPPAGE_BPS = 150;

// Closes in USDC (float, indicators only; orders always use bigints).
const closes: number[] = [];
let smaPrev: number | null = null;
let peak = 0;

function sma(values: number[], n: number): number {
  let s = 0;
  for (let i = values.length - n; i < values.length; i++) s += values[i];
  return s / n;
}

await runBars({
  onBatch(state: BarsState, _batch: Batch): OrderInput[] {
    if (state.warmingUp) return [];
    const closeRaw = state.close(SYMBOL);
    if (closeRaw === null) return [];
    const sym = state.symbols.get(SYMBOL);
    if (sym === undefined) return [];
    const close = Number(closeRaw) / 10 ** sym.price_scale;
    closes.push(close);

    // Keep the SMA trend fresh on every batch, including while holding:
    // after a stop-out the re-entry check must compare against the latest
    // SMA, not a value frozen at entry time.
    let smaNow: number | null = null;
    let rising = false;
    if (closes.length >= SMA_LEN + 1) {
      smaNow = sma(closes, SMA_LEN);
      rising = smaPrev !== null && smaNow > smaPrev;
      smaPrev = smaNow;
    }

    const pos = state.positions.get(SYMBOL);
    const qty = pos === undefined ? 0n : pos.qty;

    if (qty > 0n) {
      if (close > peak) peak = close;
      // Trailing stop: 2% below the highest close since entry.
      if (close < peak * (1 - TRAIL_BPS / 10000)) {
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Flat: enter only on a confirmed slow uptrend + fresh breakout.
    if (smaNow === null || !rising) return [];
    if (close <= smaNow) return [];
    let high = 0;
    for (let i = closes.length - 1 - HIGH_LEN; i < closes.length - 1; i++) {
      if (closes[i] > high) high = closes[i];
    }
    if (close <= high) return [];
    if (state.cash <= 0n) return [];
    peak = close;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  },
});
