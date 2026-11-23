# Trend-rider BTC bot

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/zekemonkeyking/makefun-btc-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/zekemonkeyking/makefun-btc-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A trend-following bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty, $50 in USDC. It trades Coinbase Wrapped BTC (CBBTC) against USDC, minute by minute, in a replay of on-chain prices. Paper money only — nothing is traded for real.

## Strategy

1-minute EMA crosses whipsaw on this market (the median EMA-cross variant lost ~$23 on the dev window: every round trip costs ~26 bps while 1-minute noise flips the signal 14–34 times a day). So this bot trades rarely, only with the slow trend behind it:

- **Enter** (long only, 100% of cash) when the close is above a rising SMA(120) **and** a new 30-bar high.
- **Exit** (sell everything) when the close falls 2% below the highest close since entry (trailing stop).

No other exit, no leverage, no shorts. Deterministic: the only inputs are the bars the harness sends.

## Backtest (dev window, 1,440 bars)

Net PnL **+$31.79** on $1,000 starting capital, 2 trades, max drawdown -2.0%. Buy-and-hold on the same window: +$33.62. On the time-reversed window (a falling market) the same rules lose -$20.49 vs -$36.69 for buy-and-hold.

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/bars-replay/v1` on stdin/stdout (see `vendor/makefun-bars.ts`, the kit's SDK shim, copied byte for byte).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
