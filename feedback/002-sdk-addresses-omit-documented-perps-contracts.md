# SDK address export omits perps contracts the docs document

Severity: normal
Area: SDK

## Steps to reproduce

1. Install `@somnia-chain/markets-sdk@0.32.1`.
2. Print the bundled Hideki address book:

```js
const { SOMNIA_HIDEKI_TESTNET_ADDRESSES } = require("@somnia-chain/markets-sdk");
console.log(Object.keys(SOMNIA_HIDEKI_TESTNET_ADDRESSES));
```

3. Compare against the "Perps contracts" table in the perps developer docs.

## Expected

Every perps core contract the docs list is reachable from the SDK, so a build can
resolve them for a network instead of pasting addresses. The docs explicitly
advise against hardcoding ("Per-market addresses should be read from each market
row, not hardcoded"), and the same reasoning applies to the core.

## Actual

The export contains `marginBank` and `perpPoolFactory`, but **not**
`LiquidationEngine`, `InsuranceFund`, `VoucherDistributor`, or
`OperatorPermissionsRegistry`. A build that needs any of those — for example to
watch liquidations or to claim the paper USDso voucher — has to hardcode an
address copied from the docs, which is the thing the docs warn against.

## Evidence

SDK export keys:

```
binaryModule, binaryPoolBeacon, binaryPoolImpl, binarySettlement, clobFactory,
collateral, marginBank, marketCreator, marketCreatorFactory, marketsCore,
oracleHub, perpPoolFactory, priceFeedScheduler, testUsdc
```

Documented but absent:

```
LiquidationEngine            0xA66d3C24Ad4a389d863846905D8173e1017e9F4D
InsuranceFund                0x50826894D47C6D4f3BeA38BFDC7Dc5c5be171b80
VoucherDistributor           0x2ACD9EFdA721450906bfE1bef3edE269636E42C4
OperatorPermissionsRegistry  0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a
```

All four hold code on chain, so they exist — they are simply not exported.

## Environment

- SDK: `@somnia-chain/markets-sdk` 0.32.1
- Network: Somnia Hideki / Tokyo testnet (chain 50383)
- RPC: `https://api.hideki2.infra.testnet.somnia.network`
