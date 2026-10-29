# `hidekiTestnet.blockTime` is 10, but Hideki produces a block every ~100ms

Severity: normal
Area: SDK

## Steps to reproduce

Measure the cadence over a long enough window that timestamp granularity cannot
distort it:

```bash
RPC=https://api.hideki2.infra.testnet.somnia.network
LATEST=$(cast block-number --rpc-url $RPC)
for GAP in 10000 100000; do
  N=$((LATEST-GAP))
  T1=$(cast block $LATEST --rpc-url $RPC --field timestamp)
  T2=$(cast block $N      --rpc-url $RPC --field timestamp)
  echo "$GAP blocks: $((T1-T2))s"
done
```

Then compare against what the SDK declares:

```js
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
console.log(hidekiTestnet.blockTime); // 10
```

## Expected

`blockTime` matches the chain. The definition's own comment explains why the
value matters:

> a `blockTime` of 10 is what viem uses to size its own polling/waiting
> heuristics

So this is not a cosmetic field by the SDK's own account.

## Actual

**~100 ms per block, measured twice at different scales:**

```
latest block 36,352,738
gap     10,000 blocks →   1,001s  →  100.10 ms/block
gap    100,000 blocks →  10,004s  →  100.04 ms/block
```

The declared value is `10`. That is off by **10x**, and the surrounding
documentation is wrong in the same direction:

> Validators sit in one region to keep validator-to-validator latency low, so
> blocks land every **10 ms** (~100 blocks/s) instead of Shannon's 100 ms.

Measured, Hideki runs at Shannon's stated cadence, not ten times it. ~10
blocks/s, not ~100. The claim that "the SDK's live tail sees ~10x the block rate
of Shannon" does not hold either.

The chain's own explorer agrees with the measurement rather than with the SDK:
`GET /tokyo/api/v2/stats` reports `"average_block_time": 100`.

## Impact

Two things, neither fatal, both avoidable:

- **viem polls ~10x more often than the chain produces blocks.** `blockTime`
  feeds polling and waiting heuristics, so every consumer that takes the SDK's
  chain object at face value puts an order of magnitude more load on the RPC
  than the chain can reward. On a bounty testnet with shared infrastructure that
  is not nothing.
- **Latency work gets planned against a number that is wrong by 10x.** Hideki is
  presented as the low-latency target specifically on the strength of this
  figure. A builder sizing a keeper loop, a liquidation race or a book-tailing
  strategy around 10 ms blocks is designing for a chain that does not exist.

If the 10 ms figure was true before the 2026-09-17 regenesis, the definition is
describing v1 while pointing at v2's endpoints — worth saying so explicitly in
the comment, since it already warns that the two chains share an id.

## Suggested fix

Set `blockTime: 100` and correct the surrounding prose, or state plainly that
10 ms is a design target the current deployment does not yet hit.

## Environment

- SDK: `@somnia-chain/markets-sdk` 0.32.1, export `./chains`
- Network: Somnia Hideki / Tokyo testnet (chain 50383)
- RPC: `https://api.hideki2.infra.testnet.somnia.network`
- Measured across blocks 36,252,738 → 36,352,738
- Checked: 2026-10-29
