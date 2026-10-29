# `hidekiTestnet` ships no `blockExplorers`, though a public explorer is live

Severity: normal
Area: SDK

## Steps to reproduce

```js
import { hidekiTestnet, somniaShannon, somniaMainnet } from "@somnia-chain/markets-sdk/chains";
for (const c of [hidekiTestnet, somniaShannon, somniaMainnet]) {
  console.log(c.id, c.name, JSON.stringify(c.blockExplorers));
}
```

Then ask the explorer whether it knows this chain:

```bash
curl -s "https://explorer.testnet.somnia.network/tokyo/api?module=block&action=eth_block_number"
curl -s "https://explorer.testnet.somnia.network/tokyo/api/v2/transactions/0xd9d65bb2cf4f1fe518af5f8754df341f28ade19b85d5022a41d9088521c2b2bc"
```

## Expected

`hidekiTestnet.blockExplorers.default.url` resolves, the way it does for the
SDK's other two public chains. `blockExplorers` is a standard viem field, and
it is what a receipt view, a wallet's "view on explorer" affordance, or
`getTransactionLink`-style code reads to turn a hash into a link.

## Actual

```
50383  Hideki Testnet   blockExplorers=undefined
50312  Somnia Testnet   blockExplorers={"default":{...shannon-explorer.somnia.network...}}
5031   Somnia           blockExplorers={"default":{...explorer.somnia.network...}}
```

Hideki is the only one of the three without it, and the definition states the
reason in a comment:

> No public block explorer is known for Hideki, so that field stays unset.

One is live. `https://explorer.testnet.somnia.network/tokyo` is a Blockscout
instance serving this chain, with both API generations answering:

```
GET /tokyo/api?module=block&action=eth_block_number
  {"jsonrpc":"2.0","result":"0x22ab21e","id":1}

GET /tokyo/api/v2/transactions/0xd9d65bb2…
  {"hash":"0xd9d65bb2…","block_number":33475358,"status":"ok","result":"success",
   "from":{"hash":"0x60eF148485C2a5119fa52CA13c52E9fd98F28e87"},
   "to":{"hash":"0xd3D0133439C74C7d0CA42d39Ae5FEd6476BA2314"}, …}
```

That is a real transaction of ours, returned in full. The explorer is on the
same chain the definition describes: the RPC it indexes answers `eth_chainId`
with `0xc4cf` (50383) and `net_version` with `50000259` — the exact split the
definition's own comment documents as Hideki's distinguishing oddity.

The naming is probably what hid it: the chain is called **Hideki** in the SDK
and the developer docs, the RPC host is `hideki2`, and the explorer path is
`/tokyo`. Same network.

## Impact

Small but it lands on every builder who renders a transaction link. With the
field unset, anything reading `chain.blockExplorers.default.url` gets
`undefined`, so the URL has to be hardcoded alongside a chain object that is
otherwise complete — which is what we did, in `src/config.ts`. A hardcoded
explorer URL is exactly the kind of value that goes stale silently.

## Suggested fix

```js
blockExplorers: {
  default: {
    name: "Somnia Explorer",
    url: "https://explorer.testnet.somnia.network/tokyo",
    apiUrl: "https://explorer.testnet.somnia.network/tokyo/api",
  },
},
```

## Environment

- SDK: `@somnia-chain/markets-sdk` 0.32.1, export `./chains`
- Network: Somnia Hideki / Tokyo testnet (chain 50383, `net_version` 50000259)
- RPC: `https://api.hideki2.infra.testnet.somnia.network`
- Checked: 2026-10-29
