# Capability matrix — what is actually established

Baseline: `2d2ace4e02646253a54f8c2e060ad1a5fef2ea0c`, which **is** the revision the
review inspected. Network: Somnia Hideki / Tokyo, chain **50383** (confirmed by
`eth_chainId`, not by docs).

Four columns, and nothing is promoted without the evidence named.

## Verified by deployed bytecode or official type

- **Chain id 50383**, RPC `api.hideki2.infra.testnet.somnia.network`.
- **`placeOrderFor(address,…)` = `0x80054449`** exists on the perp pool
  implementation (beacon `0xb787f7d2` → `0x81f9eb88`, 90,808 bytes).
- **Operator grants are honoured.** Without a grant the call reverts
  `OnlyApprovedContracts()` (`0x3fb0ba2e`); with one it reaches economics and
  reverts `InsufficientCollateral()` (`0x3a23d825`). Grants are scoped per pool
  **and** per selector, and revocation is immediate.
- **`ORDER_TYPE` = `{ LIMIT: 0, FILL_OR_KILL: 1, MARKET: 2, POST_ONLY: 3 }`.`**
- **`getMarginStatus` costs ~3.19M gas** called as a contract.
- **`depositFor` is pool-only** — `OnlyPerpPool()` (`0xad5d0577`) for any other
  caller. The original top-up design is impossible.
- **Reduce-only is a real venue concept**, but it lives in the **stop-order**
  path: `PerpStopIntent = "reduceOnly" | "opening"`, and
  `PERP_STOP_DROP_REASON` includes `ReduceOnlyNoPosition`,
  `ReduceOnlyWrongSide`, `ReduceOnlyBelowMinQty`.
- **Stop orders carry an explicit `owner`.** `createPendingOrder` takes
  `{ bool isBid, address owner, uint64 userData, uint256 quantity }` plus
  trigger/limit prices, and the deployed perp stop registry
  (`0x8d7fcdfc…096e`, 32,634 bytes) exposes `cancelPendingOrder` and
  `somiPaymentPerOrder`.

## Verified by executable test

- 33 tests pass, 9 of them against forked live contracts.
- Policy arithmetic: budget ceiling, cooldown, lot rounding, direction from the
  sign of the position, failed-order refund, gas floor.

## Verified by authorized testnet transaction

- Margin deposited, **0.002 BTC long opened** at 81,858 on 15 USDso (~10.9x).
- Operator grant and `arm` landed.
- `cut()` executed and emitted **`CutSkipped "above trigger"`** — a correct
  no-op on a healthy position.
- Gas floor behaves: starved → `insufficient gas to read status` (70,628 gas);
  funded → `above trigger` (145,214 gas).

## Unsupported, unknown, or NOT established

- **No filled reduction has ever happened.** Every "cut" to date is a skip.
- **The deployed contract has no reactivity.** `0x34d156d6…4113` is the
  5,344-byte pre-callback build: `onEvent`, `subscribePool` and `rosterLength`
  are absent on chain. Reactivity exists in source only, and no subscription has
  been created.
- **`placeOrderFor` has no reduce-only guarantee.** `PlacePerpOrderParams`
  carries only `isBid`, `price`, `quantity`, `orderType` — there is no
  reduce-only flag, and nothing stops an opposite-side order from overshooting
  and flipping the position if size changed between the read and the fill.
- **`orderType: 0` is `LIMIT` — a RESTING order**, not an immediate one. The
  app passes 0 today, so a "cut" would rest on the book rather than cut.
- **Cut accounting is order-based, not fill-based.** `cutsLeft` decrements and
  `Cut` is emitted when `placeOrderFor` returns, which is submission, not a
  reduction.
- **The roster is swept from index 0 with no rotation.** Entries 4+ are never
  reached by a callback.
- **Disarm and revoke do not cancel resting orders**, and nothing has tested
  what happens to an outstanding order when a grant is revoked.
- Fill semantics, partial fills, and reconciliation are entirely untested.
