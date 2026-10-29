# A delegate cannot create a stop order, yet the operator registry records the grant anyway

Severity: major
Area: contracts

## Steps to reproduce

The prerequisite matters, so it is step one: the registry places orders on the
owner's behalf, so the **owner must approve the registry as an operator on the
pool** before anything reaches ownership validation. Without it every call
reverts `RegistryNotApprovedByOwner()` (`0x28e0a7ba`) — including the owner's
own, which is what made our first run look like a delegation failure when it was
a missing prerequisite.

1. Fork Hideki and, as the owner, approve the stop registry on the pool:

```solidity
bytes4[] memory sels = new bytes4[](2);
sels[0] = 0x80054449; // placeOrderFor
sels[1] = 0xe37b444b; // cancelOrderFor
vm.prank(owner);
IOperatorRegistry(OP_REGISTRY).setOperatorApprovalForPool(BTC_POOL, STOP_REGISTRY, sels, true);
```

2. From a **contract that is not the owner**, call `createPendingOrder` with
   `order.owner` set to the owner — the arrangement that proves delegation
   rather than impersonation.

3. Now grant that contract `createPendingOrder` (`0x9a03efbf`) on the pool
   through the operator registry, assert `isApprovedForPool` returns true, and
   repeat step 2.

A runnable version of all three is in our repo as
`contracts/test/StopDelegation.fork.t.sol`:

```bash
forge test --match-contract StopDelegationForkTest -vv
```

## Expected

Either delegated creation works — the tuple carries an explicit `owner` field,
which reads like a delegation mechanism, and the venue already supports
delegated order placement through `placeOrderFor` — or the operator registry
refuses to record a grant for a selector that can never be honoured.

One of the two. Today a builder gets neither.

## Actual

**A delegate is refused `InvalidOrderOwner()` (`0xc32ff34d`), with or without a
grant.** The registry requires `order.owner == msg.sender`; the `owner` field is
bookkeeping for the registry's own calls into the pool, not delegation.

That the refusal is specifically an ownership error, and not something else, is
established by the contrast: the **owner** making the identical call gets past
ownership validation and fails on `NoReducingPositionAtCreation()`
(`0xd156c90a`) instead, because that test account holds no position. Two
different errors from the same calldata, distinguished only by `msg.sender`.

The part that costs a builder real time is the grant. The owner can approve the
delegate for `createPendingOrder` on the pool, `isApprovedForPool` then returns
**true**, and the very next call is refused exactly as before. The permission
system reports a capability that the target contract will never consult. Nothing
on chain, and nothing in the SDK, says the grant is inert — so a builder can
verify the permission is in place and still ship something that cannot fire.

A smaller sharp edge found while reproducing this: `RegistryNotApprovedByOwner()`
is keyed on `order.owner`, not on `msg.sender`. A delegate calling for an owner
who has not yet approved the registry is told the *registry* is unapproved,
which reads as the caller's own missing setup.

## Impact

The stop path is the only one that enforces **reduce-only at creation** — the
owner's own call above proves that check exists and runs. `placeOrderFor` has
no reduce-only option. So a non-custodial tool that wants the venue to guarantee
it can only ever shrink a position cannot use the mechanism that provides that
guarantee, and has to reconstruct it: cap quantity at the live position, execute
immediate-or-cancel, re-read after and unwind if the account grew or flipped.
That is what we ended up doing.

Delegated stop-loss is the most obvious product in the "trader tools" category
this bounty is asking for, and it is currently not buildable.

## Evidence

Four tests, all passing against the live chain, re-run 2026-10-29:

```
[PASS] test_delegateCannotCreateForAnotherOwnerEvenWithAGrant()  207546 gas
[PASS] test_ownerPassesOwnershipAndIsCheckedForReduceOnly()      160172 gas
[PASS] test_registryNeedsTheOwnersApprovalFirst()                 61512 gas
[PASS] test_stopFeeIsWhatTheDocsSay()                              2377 gas
```

Selectors observed, same calldata, varying only `msg.sender`:

```
delegate, no grant     0xc32ff34d  InvalidOrderOwner()
delegate, with grant   0xc32ff34d  InvalidOrderOwner()          <- grant has no effect
owner, for themselves  0xd156c90a  NoReducingPositionAtCreation()
owner, registry unapproved  0x28e0a7ba  RegistryNotApprovedByOwner()
```

Note for whoever reproduces this with `cast` rather than a fork test: an
`eth_call` carrying the 0.15 STT value from an unfunded `--from` address reverts
with **empty data**, which looks like a contract revert and is not one. Use a
funded sender.

## Environment

- Network: Somnia Hideki / Tokyo testnet (chain 50383)
- PerpStopOrderRegistry (BTC): `0x52E2ccebAeC9332672C247e9A90AA3d61FB615ef`
- PerpPool (BTC): `0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0`
- OperatorPermissionsRegistry: `0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a`
- Stop fee: 0.15 STT per pending order, charged at creation and refunded in full
  on cancel — verified separately, and correct as documented
- Foundry fork tests against `https://api.hideki2.infra.testnet.somnia.network`
- Checked: 2026-10-29
