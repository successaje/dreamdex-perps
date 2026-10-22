# `addresses.collateral` is not the perps collateral, and nothing in the type says so

Severity: normal
Area: SDK

## Steps to reproduce

1. Read the collateral from the SDK's address book, as the field name invites:

```js
const { SOMNIA_HIDEKI_TESTNET_ADDRESSES } = require("@somnia-chain/markets-sdk");
SOMNIA_HIDEKI_TESTNET_ADDRESSES.collateral
// 0x9E9492cC533E8696A3b6afC7df730800DF75148f
```

2. Read the quote token off any live perp market:

```js
const perps = await markets.client.listPerpMarkets();
perps[0].quoteToken
// 0xed7993a74dae1e6656b704a424dcd8711aaf4f72
```

## Expected

Either the field resolves to the collateral used by perps, or its name and
TypeScript doc comment make clear which product it belongs to — e.g.
`binaryCollateral`, or a `perpsCollateral` sibling.

## Actual

`collateral` is the binary/spot collateral: it is byte-identical to the
`testUsdc` field in the same object. Perps settle in the market's `quoteToken`,
a different address. The developer docs do warn about this in prose, but the API
shape still offers a field called `collateral` that is wrong for perps, and
nothing at the call site signals it.

The failure mode is quiet: approving or funding the "collateral" address for a
perps flow transfers a token the MarginBank does not accept, and the error
surfaces later and somewhere else.

## Evidence

```
SDK addresses.collateral    0x9E9492cC533E8696A3b6afC7df730800DF75148f
SDK addresses.testUsdc      0x9E9492cC533E8696A3b6afC7df730800DF75148f   (same)
market.quoteToken           0xed7993a74dae1e6656b704a424dcd8711aaf4f72
docs "Collateral (USDso)"   0xed7993A74dAe1e6656B704A424DcD8711aAf4F72   (matches the market)
```

Verified across all 21 live perp markets: every one quotes
`0xed7993a7…4f72`.

## Environment

- SDK: `@somnia-chain/markets-sdk` 0.32.1
- Network: Somnia Hideki / Tokyo testnet (chain 50383)
