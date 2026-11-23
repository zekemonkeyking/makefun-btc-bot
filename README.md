# Adaptive regime BTC bot

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/zekemonkeyking/makefun-btc-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/zekemonkeyking/makefun-btc-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

An adaptive regime bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty, $50 in USDC. It trades Coinbase Wrapped BTC (CBBTC) against USDC, minute by minute, in a replay of on-chain prices. Paper money only — nothing is traded for real.

## Strategy

Most bots pick one tactic and pray the market cooperates: trend bots sit flat in a range, dip-buy bots bleed in a falling market. This bot reads the regime first — the spread between SMA(30) and SMA(120), in basis points — and only then picks a tactic:

- **Trend (core):** enter long, 100% of cash, when the close is above a rising SMA(120) and a new 30-bar high. While holding: trailing stop 2% below the peak; harvest half the position once it is up 150 bps, then buy the half back if the price dips 100 bps below the harvest price — or after 240 bars, whichever comes first, so harvested cash never sits idle for hours in an uptrend.
- **Range (scalp):** when the trend is flat-to-up (spread ≥ +10 bps) and the close sits at least 80 bps below the 60-bar high, buy 50% of cash. Exit at +120 bps over cost, −120 bps, or after 240 bars.
- **Falling market (defensive):** stay flat. Dip-buying into a falling market is where dip-buy bots bleed — on the dev window run backwards, an unfiltered deep-dip bot lost −$66.89, while this bot's gate keeps its loss near the trend core's −$21.90.

## Backtest (dev window, 1,440 bars, exact harness fill math)

Net PnL **+$42.51** on $1,000 starting capital, 11 trades, max drawdown 1.21%, fees $2.88. At 2× fees (simulator): +$34.72. First half of the window: +$29.91; second half: +$2.70; reversed window (a falling market): −$21.90. For comparison, a plain trend bot scored +$30.40 with a 1.98% drawdown on the same window, and a plain deep-dip bot +$29.77 with −$66.89 on the reversed window.

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/bars-replay/v1` on stdin/stdout (see `vendor/makefun-bars.ts`, the kit's SDK shim, copied byte for byte).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
