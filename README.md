# dreamDEX Perps Builder Bounty

Work for the [dreamDEX Perps Builder Bounty](https://dorahacks.io/hackathon/dreamdex-perps-bounty/detail)
on Somnia Hideki / Tokyo testnet (chain **50383**).

## Network

The naming is inconsistent across sources and it is worth stating plainly, because
it cost us the first ten minutes: the bounty page says **Tokyo testnet**, the
developer docs say **Hideki testnet**, the explorer path is `/tokyo`, and the RPC
host is `hideki2`. They are one chain, id 50383.

```
RPC        https://api.hideki2.infra.testnet.somnia.network
WebSocket  wss://api.hideki2.infra.testnet.somnia.network/ws
Indexer    https://hideki-dev.smk.somnia.host/v1/graphql
Explorer   https://explorer.testnet.somnia.network/tokyo
SDK        @somnia-chain/markets-sdk 0.32.1
```

## Probes

```bash
npm install
npx tsx scripts/probe-network.ts       # chain id, and whether every documented address holds code
npx tsx scripts/probe-markets.ts       # live perp markets and their per-market addresses
npx tsx scripts/probe-docs-example.ts  # runs the docs' own example against the live venue
```

Each probe checks a documented claim against the chain rather than restating it.
That is how the `feedback/` items below were found.

## What the probes established

All seven documented perps core addresses hold code. 21 perp markets are live:
ZRO, LIT, VVV, 1000PEPE, PUMP, ZEC, TAO, WLD, NEAR, XLM, AVAX, LINK, SUI, ADA,
BNB, DOGE, XRP, HYPE, SOL, ETH, BTC.

**`baseDecimals` ranges from 6 to 24.** Nine markets are 18, but PUMP/ADA/XRP/HYPE
are 6, ZEC/DOGE/BTC are 8, TAO/SUI/SOL are 9, XLM is 7, and NEAR is **24**. Any
code that assumes 18 is wrong for twelve of the twenty-one markets. `quoteDecimals`
is 18 everywhere, which makes the asymmetry easier to miss.

## Feedback track

One file per issue in `feedback/`, in the format the bounty specifies.

Security issues are **not** filed here — those go privately to security@dreamdex.io.
