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

## The stop path — verified and REJECTED

Tested on the deployed BTC stop registry (`0x52E2ccebAeC9332672C247e9A90AA3d61FB615ef`,
beacon impl `0x8d7fcdfc…096e`) with a delegate CONTRACT that is not the owner,
which is the only arrangement that tests delegation rather than impersonation.

- **The registry enforces reduce-only at creation.** The owner acting for
  themselves is refused `NoReducingPositionAtCreation()` (`0xd156c90a`) — past
  ownership validation, stopped because the account holds no position to
  reduce. That is the guarantee we were looking for.
- **But a delegate cannot use it.** A non-owner contract is refused
  `InvalidOrderOwner()` (`0xc32ff34d`), **with or without an operator grant**.
  The grant is recorded and changes nothing. `order.owner` must equal
  `msg.sender`; the field is bookkeeping for the registry's own calls into the
  pool, not a delegation mechanism.
- A second prerequisite exists regardless: the owner must first approve the
  **registry** as an operator on the pool, or every call reverts
  `RegistryNotApprovedByOwner()` (`0x28e0a7ba`).
- Each stop costs **0.15 STT**.

**Conclusion: Dreamcatcher cannot move execution onto the stop path.** The
dependent rewrite is stopped. The interaction between an account-margin trigger
and a stop's price trigger was not investigated, because it is moot once
delegated creation is impossible.

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
- **Reactivity is deployed but DORMANT.** As of `0xcaff129e…31a5` (8,608 bytes)
  `onEvent`, `subscribePool` and `rosterLength` are present on chain — the
  earlier deployment genuinely lacked them. **No subscription has been
  created**, so no callback has ever fired, and `subscribePool` needs 32 native
  tokens held by the contract.
- **`placeOrderFor` still has no venue-enforced reduce-only flag.** Non-increase
  is now obtained from ATOMICITY instead: execution is IOC, the quantity is
  capped at the live magnitude read in the same call, and `deliver` re-reads the
  position afterwards and reverts — unwinding the order — if the account ended
  up larger or flipped. That is a property of our transaction, not a promise by
  the venue.
- **The roster is swept from index 0 with no rotation.** Entries 4+ are never
  reached by a callback.
- **Disarm and revoke do not cancel resting orders**, and nothing has tested
  what happens to an outstanding order when a grant is revoked.
- Fill semantics, partial fills, and reconciliation are entirely untested.
