# `getMarginStatus` costs ~3.2M gas, and wrapping it defeats `eth_estimateGas`

Severity: major
Area: contracts

## Steps to reproduce

1. Open any perp position so the account has something to evaluate.
2. Measure the cost of the status read *as a contract would pay it*:

```bash
cast estimate 0x478769E1177C0773c43A593DCCc4Ad15F15F1394 \
  "getMarginStatus(address)" <ACCOUNT> \
  --from <ANY_CONTRACT_ADDRESS> \
  --rpc-url https://api.hideki2.infra.testnet.somnia.network
```

3. Now call it from a contract that wraps it in `try/catch` — which any
   integrator must, since a reverting read should not take down a keeper — and
   let the caller use `eth_estimateGas` normally.

## Expected

A status read is a classifier over an account's positions. Integrators call it
on a hot path: keepers, vaults, liquidation-protection tools, anything that has
to decide whether to act. It should be cheap enough to call speculatively, and
in the low hundreds of thousands of gas at worst.

## Actual

**`getMarginStatus` costs 3,190,219 gas** for an account holding a *single*
position. That alone makes on-chain consumers expensive, but the second-order
effect is worse.

Wrapped in `try/catch`, the read has two branches: succeed for ~3.2M, or run
out of gas and be caught for almost nothing. `eth_estimateGas` finds the cheap
one:

```
getMarginStatus, called as a contract    3,190,219 gas
eth_estimateGas for the wrapping call    1,217,789 gas   <- less than the read
```

The estimate is **smaller than the read it is supposed to fund**, so a
transaction sent at the estimated limit takes exactly the branch the estimate
priced. In our case the contract reported the margin status as unreadable for a
position whose status was perfectly readable — a false negative that looks like
a venue outage rather than a gas problem. Re-sending the identical call with a
60,000,000 limit returned the correct answer using 145,214 gas.

This is a silent failure in the worst place: the code path that decides whether
to protect a position is the one that quietly does nothing.

## Evidence

Same contract, same arguments, same block, two gas limits:

```
estimated (starved)  gasUsed    70628  ->  "insufficient gas to read status"
60M (funded)         gasUsed   145214  ->  "above trigger"
```

Two things would each fix the integrator experience:

- bring the cost of `getMarginStatus` down, or document it prominently so
  callers size for it; and
- expose a cheap variant — a plain comparison against cached requirement
  figures — for consumers that only need the rung, not a full revaluation.

## Environment

- Network: Somnia Hideki / Tokyo testnet (chain 50383)
- MarginBank: `0x478769E1177C0773c43A593DCCc4Ad15F15F1394`
  (implementation `0x78C989C9c5cD2Ed68b4486373c0e4b118C8F1D5C`)
- Account under test held one BTC perp position, 0.002 BTC long
- Checked: 2026-10-23
