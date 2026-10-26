# Dreamcatcher

**Cut a perp position before the liquidation engine does.**

Liquidation takes your position at whatever the book offers, plus a penalty.
Dreamcatcher takes a slice of it earlier, at a limit price you chose, and stops
there. Same direction of travel, on your terms instead of the engine's.

It never holds your position or your collateral. You grant **one function on
one market** through dreamDEX's own operator registry — `placeOrderFor` — and
revoking that grant disables Dreamcatcher entirely, whatever its own storage
says. It cannot open a position, increase one, withdraw anything, or touch a
market it was not granted.

Built for the [dreamDEX Perps Builder Bounty](https://dorahacks.io/hackathon/dreamdex-perps-bounty/detail).

---

**Try it without installing anything:**
[dreamcatcher-beige.vercel.app](https://dreamcatcher-beige.vercel.app) — and the
live watch this README documents, read-only, no wallet required:
[`?watch=0x60eF…8E87`](https://dreamcatcher-beige.vercel.app/?watch=0x60eF148485C2a5119fa52CA13c52E9fd98F28e87)

## Live on Somnia Hideki (Tokyo) testnet

```
Dreamcatcher   0xd3d0133439c74c7d0ca42d39ae5fed6476ba2314
chain          50383
accounting     cuts spent is read from chain state, not browser storage
execution      immediate-or-cancel only, enforced by the contract
explorer       https://explorer.testnet.somnia.network/tokyo/address/0xd3d0133439c74c7d0ca42d39ae5fed6476ba2314
```

A real position, a real watch, and a **real filled reduction** — all against the
contract address above, with before and after read at the block either side.

- **Margin deposited** — [`0x4e972770…`](https://explorer.testnet.somnia.network/tokyo/tx/0x4e9727702fd304679915e4e2a64fa2810722eff47caff56ab98dd035dd17e685)
- **Position opened** — [`0xac422e3e…`](https://explorer.testnet.somnia.network/tokyo/tx/0xac422e3e2a132491b21686bd9dba951c5029bdb7bb5c403ac78eb527990e0b08) · 0.002 BTC long at 81,858
- **Size raised to the margin edge** — [`0x4a2db694…`](https://explorer.testnet.somnia.network/tokyo/tx/0x4a2db694aca9e5d12e8465cf48b8bfc969581660efde99376a175b90aa518dc3)
- **Permission granted** — [`0xea24791c…`](https://explorer.testnet.somnia.network/tokyo/tx/0xea24791cbe7886238001070790e3ffde568c62d1f45b361ce25e9897b6fe42c6) · `placeOrderFor`, BTC only
- **Watch armed** — [`0x7c33fbe3…`](https://explorer.testnet.somnia.network/tokyo/tx/0x7c33fbe35490617fb526cda673451f7ccfdd419e96f72beb6a9e90dd62d5a302) · cut 25% at margin call, never sell below 70,000

The market then moved against the position overnight, it crossed into
**MarginCall**, and the watch cut it:

- **The cut** — [`0xd9d65bb2…`](https://explorer.testnet.somnia.network/tokyo/tx/0xd9d65bb2cf4f1fe518af5f8754df341f28ade19b85d5022a41d9088521c2b2bc) · block 33,475,358

```
Cut  isBid=false  requested=58000  filled=58000  statusBefore=1  cutsLeft=3

position @ 33475357   0.00234 BTC      (before)
position @ 33475358   0.00176 BTC      (after)
reduced               0.00058 BTC

cutsSpent   1     read from the contract, not from a browser
attempts    1
```

Read that against the claims it settles. The order **sold** to reduce a long —
direction derived from the sign of a live position, never passed in. It fired at
**MarginCall**, not before. `filled` is **measured** from the position on both
sides of the call rather than copied from the request. `cutsSpent` is answerable
**from chain state**, so the receipt reads the same on any device. And a
zero-fill would have spent an attempt and nothing else.

Before that, with the account healthy, repeated `cut()` calls correctly did
nothing and are recorded as `CutSkipped "above trigger"` — a watch that is awake
and declining to act, which is most of what a protective tool does.

## Who it is for

Anyone carrying leverage who does not want to watch a chart. The protection a
perps venue gives you today is a stop order you place by hand and a liquidation
engine you would rather never meet. Dreamcatcher sits between them.

## How it works

Three pieces: a contract that owns the decision, two drivers that wake it, and
an app whose centre is a woven hoop rather than another chart.

### The contract

A watch is five numbers over one market: the **rung** it wakes at on dreamDEX's
ladder (`Healthy → MarginCall → PartialLiquidation → CloseOut`), the **slice**
it cuts, your **limit price**, a **cooldown**, and the number of **cuts** it may
ever make. Nothing else, and nothing hidden.

Four decisions carry the weight:

**The limit price is yours, not an oracle's.** Reading a mark price on chain
would mean trusting a getter nothing here has verified; letting the caller pass
one would let a keeper dump your position into a bad book. An absolute limit you
set is the only version where nobody but you picks the price.

**Direction comes from the sign of the position, never from an argument.**
Cutting a long means selling. Getting that backwards would grow the position at
the worst possible moment.

**Quantity rounds down onto the market's lot grid**, read per market. Below one
lot it does nothing, because a sub-lot order is rejected outright.

**A gas floor guards the margin reads.** `getMarginStatus` costs about 3.2M gas,
and wrapped in the `try/catch` a reactive handler needs, `eth_estimateGas` finds
the cheap failure branch and returns a limit smaller than the read itself. The
first live cut reported "status unreadable" for a perfectly readable position.
It now says `insufficient gas to read status`, which tells a caller to raise the
limit rather than suspect the venue. Filed as `feedback/006`.

### Two drivers, one body

`cut(account, pool)` is **permissionless and idempotent** — anyone can catch
anyone, and a watch never depends on its author being online.

The same body runs as a **Somnia reactivity** callback: subscribe a pool and the
chain itself invokes the handler when that pool stirs. The callback is handed an
emitter rather than an account, so the contract keeps a per-pool roster of armed
accounts and sweeps up to `MAX_PER_EVENT` of them.

That constant is **3**, and the reason is the gas finding above: at ~3.2M gas per
status read, a callback sweeping twenty watchers would need 64M of gas before
placing a single order. Three is roughly what fits a sane handler budget, and
the permissionless `cut` covers whoever a sweep misses. That is the honest
ceiling of the reactive path at today's costs.

Subscribing needs **32 native tokens held by the contract** — a sybil gate, not
a fee; the balance is never consumed.

### The app

React, viem, and dreamDEX's own palette. The centre is a dreamcatcher whose web
tightens and reddens as the account descends the ladder, and whose severed
strands are the cuts a watch has already spent. Nothing on it is decoration that
does not mean something.

`?watch=0x…` opens any watch read-only, with no wallet at all.

```bash
cd web && npm install && npm run dev
# http://localhost:5190
# http://localhost:5190/?watch=0x60eF148485C2a5119fa52CA13c52E9fd98F28e87
```

## Running it

`contracts/lib/forge-std` is a submodule, and `npm install` must come **before**
`forge build` — Somnia's reactivity contracts arrive as an npm package, so
`node_modules` is one of Foundry's lib roots.

```bash
git clone --recursive https://github.com/successaje/dreamdex-perps.git
cd dreamdex-perps
npm install && (cd web && npm install)
forge build --root contracts
forge test --root contracts            # 33 tests, 9 against live contracts
```

Anything that signs reads `PRIVATE_KEY` from `.env`. Use a throwaway.

```bash
npm run deploy:dry                     # estimate, no key needed
npm run deploy                         # deploy to Hideki
npx tsx --env-file=.env scripts/arm.ts # grant + arm a watch
```

### Probes

Each one checks a documented claim against the chain rather than restating it.
That is how every item in `feedback/` was found.

```bash
npx tsx scripts/probe-network.ts       # chain id, and code at every documented address
npx tsx scripts/probe-markets.ts       # the 21 live perp markets
npx tsx scripts/probe-margin.ts        # margin, liquidation and operator surfaces
npx tsx scripts/probe-edges.ts         # log caps, indexer limits, grid agreement
```

## What the probes established

All seven documented perps contracts hold code, and 21 markets are live.

**`baseDecimals` range from 6 to 24.** Nine markets are 18, but BTC is 8, XRP is
6, and NEAR is **24**. `quoteDecimals` is 18 everywhere, which makes the
asymmetry easy to miss. Anything assuming 18 is wrong for most of the board — so
every decimal and lot size here is read per market.

**`depositFor` is not open to third parties.** The first version of this contract
topped margin up instead of cutting. The chain refuses: `OnlyPerpPool()`. That
test is kept, inverted, in `MechanismFacts.fork.t.sol`, so a deployment that ever
relaxes it fails loudly rather than changing behaviour unnoticed.

**The operator path does work.** Without a grant, `placeOrderFor` on another
account reverts `OnlyApprovedContracts()`; with one, the same call reaches the
economics and reverts `InsufficientCollateral()`. Refused on permission without
it, refused on economics with it.

## Feedback track

One file per issue in `feedback/`, in the format the bounty specifies. Security
issues are not filed here — those go privately to security@dreamdex.io.

## X posts

<!-- Replace each line with the real link once posted. Each must tag @DreamDEXSomnia. -->

- _(post 1 — the problem and what Dreamcatcher does)_
- _(post 2 — the filled cut, with the transaction)_
- _(post 3 — the permission model, optional)_

## Limitations

Stated here rather than discovered later.

- **Reactivity is deployed but dormant.** `onEvent`, `subscribePool` and
  `rosterLength` are on chain, but **no subscription has been created**, so no
  callback has ever fired. Execution today is the permissionless `cut`, which
  anyone can call. A subscription needs 32 native tokens parked in the contract.
- **A reactive callback sweeps at most three accounts**, from the front of the
  roster, with no rotation. At ~3.2M gas per margin-status read that is roughly
  what a handler budget allows; `cut` covers whoever a sweep misses. Multi-user
  reactive coverage is **not** demonstrated.
- **Non-increase comes from atomicity, not from a venue flag.** `placeOrderFor`
  has no reduce-only option. Execution is immediate-or-cancel with the quantity
  capped at the live position, and `deliver` re-reads afterwards and unwinds if
  the account ended up larger or flipped. The venue does enforce reduce-only on
  its **stop** path, but that path rejects delegated creation outright
  (`InvalidOrderOwner()`), which is tested in `StopDelegation.fork.t.sol`.
- **Revoking does not reach into the book.** No order of ours rests long enough
  to matter, because every order is IOC — but that is a property of how we
  execute, not a promise about cancellation.
- **One market, one account, testnet only.** Nothing here has run on mainnet,
  and the account-level margin trigger is not a position-specific liquidation
  prediction.
