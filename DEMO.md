# Demo script

Roughly two minutes. Five beats: the problem, the permission, the no-op, the
cut, the receipt. Every number on screen is live.

Two things to have open before recording: the app at
`https://dreamcatcher-beige.vercel.app/?watch=0x60eF148485C2a5119fa52CA13c52E9fd98F28e87`,
and the cut transaction in the explorer —
`https://explorer.testnet.somnia.network/tokyo/tx/0xd9d65bb2cf4f1fe518af5f8754df341f28ade19b85d5022a41d9088521c2b2bc`.

Record at mobile width or in a phone frame. It is a risk-control instrument,
not an exchange terminal, and a maximised desktop window makes it look emptier
than it is.

---

## 1 · The problem (0:00–0:25)

**On screen:** the landing page, with the live liquidation count.

> "Several hundred positions a day are taken by dreamDEX's liquidation engine.
> When that happens you get whatever the book offers, plus a penalty, at a
> moment you did not pick.
>
> Dreamcatcher takes a slice earlier, at a price you choose, and stops there."

Do not claim the count is a Dreamcatcher metric — it is the venue's.

## 2 · The permission (0:25–0:55)

**On screen:** the "What holds it" panel.

> "It never holds your position or your collateral. You grant one function on
> one market — `placeOrderFor` — through dreamDEX's own operator registry.
>
> There are two switches, and they are not the same. Taking down the web stops
> this watch. Revoking the permission stops Dreamcatcher on this market whatever
> the watch says. The second is dreamDEX's switch, not ours, and it is the
> stronger one."

If asked about cancellation, say plainly: neither switch reaches into the book.
Nothing of ours rests there, because every order is immediate-or-cancel.

## 3 · The no-op (0:55–1:15)

**On screen:** the hoop, green, "Healthy enough. Watching."

> "Most of what a protective tool does is decline to act. While the account is
> healthy, every call correctly does nothing and says so — `above trigger`.
> A watch that is awake and choosing not to spend is the normal state."

This beat is worth keeping. It is the part that separates a risk tool from a bot
that trades on a timer.

## 4 · The cut (1:15–1:45)

**On screen:** the explorer tab on the cut transaction.

> "Overnight the market moved, the account crossed into margin call, and the
> watch cut it. It sold — reducing a long — at the limit price the owner set.
>
> Requested fifty-eight thousand base units. Filled fifty-eight thousand. The
> position went from 0.00234 to 0.00176, read at the blocks either side."

## 5 · The receipt (1:45–2:05)

**On screen:** back to the app — `STRANDS LEFT 3/4`, `CUTS SPENT 1`, `ATTEMPTS 1`.

> "One cut spent of four, one attempt, and those numbers come from the contract
> rather than from this browser — so the receipt reads the same on any device.
>
> An attempt that fills nothing costs an attempt and the cooldown, never a cut.
> A submitted order is not a reduction, and the screen does not pretend
> otherwise."

Close on the limitations if there is time: reactivity is deployed but dormant,
and execution today is the permissionless path.

---

## What not to say

- **Not** "protected" or "liquidation-proof". The product reduces a position at
  a price the user chose; it does not guarantee an outcome.
- **Not** "runs 24/7". No keeper is operationally supported.
- **Not** "reactive". The callback is deployed, no subscription exists, and
  nothing has fired. The honest line is: *"the chain can drive this, and the
  code for it is deployed — today it runs on the permissionless path."*
- **No** invented figures for losses avoided. There is no defensible
  counterfactual and none is claimed.
