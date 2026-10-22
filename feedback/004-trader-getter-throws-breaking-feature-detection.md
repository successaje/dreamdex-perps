# `markets.trader` throws on access, so it cannot be feature-detected

Severity: normal
Area: SDK

## Steps to reproduce

1. Construct a read-only client — no `privateKey`, `account` or `walletClient`:

```ts
const markets = new SomniaMarkets({
  chain, indexerUrl, wsRpcUrl, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
});
```

2. Try to check whether writes are available before using them:

```ts
if (typeof markets.trader?.placePerpOrder === "function") { /* ... */ }
```

## Expected

A read-only client can be asked whether it can write without that question
throwing. Returning `undefined` would let both `?.` and `typeof` work, which is
how callers normally guard an optional capability.

## Actual

`trader` is a getter that constructs the trader eagerly and throws
`SignerRequiredError` on property access. Optional chaining does not help —
`markets.trader?.x` throws before the `?.` is reached — so the only way to ask
is `try/catch`:

```ts
try { const t = markets.trader; } catch { /* read-only */ }
```

This matters for any UI that renders before a wallet connects, which is the
normal shape of a consumer app: the read path and the write path share one
client, and the component cannot ask which one it has.

## Evidence

```
SignerRequiredError: @somnia-chain/markets-sdk: createTrader is authenticated —
construct SomniaMarkets with a privateKey / account / walletClient
    at Module.resolveSigner (dist/txSend.js:37:15)
    at get trader (dist/unified/exchange.js:681:21)
```

A `canTrade` boolean, or returning `undefined` from the getter, would resolve it.

## Environment

- SDK: `@somnia-chain/markets-sdk` 0.32.1
- Network: Somnia Hideki / Tokyo testnet (chain 50383)
