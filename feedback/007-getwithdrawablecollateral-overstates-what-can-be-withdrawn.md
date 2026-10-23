# `getWithdrawableCollateral` reports more than `withdraw` will accept

Severity: normal
Area: contracts

## Steps to reproduce

With an account holding an open perp position:

1. Ask the MarginBank how much collateral is withdrawable.
2. Try to withdraw exactly that amount.

```bash
MB=0x478769E1177C0773c43A593DCCc4Ad15F15F1394
RPC=https://api.hideki2.infra.testnet.somnia.network

# getWithdrawableCollateral(address)
cast call $MB "getWithdrawableCollateral(address)(uint256)" <ACCOUNT> --rpc-url $RPC

# withdraw(uint256) with that exact value, simulated from the same account
cast call $MB "withdraw(uint256)" <THAT_VALUE> --from <ACCOUNT> --rpc-url $RPC
```

## Expected

A getter named `getWithdrawableCollateral` returns an amount that `withdraw`
will accept. If the real constraint is `equity − initialMarginRequirement`,
the getter should return that, or be named for whatever it does return.

## Actual

The getter overstates the withdrawable amount, and withdrawing it reverts
`InsufficientCollateral()` (`0x3a23d825`).

Two measurements on the same account, taken minutes apart with different
position sizes, so this is not a one-off rounding artefact:

```
                             run 1        run 2
getWithdrawableCollateral   14.752       13.846
equity                      13.565       12.761
initial margin requirement   8.126        9.508
actual headroom              5.439        3.253      (equity − imReq)
overstatement                 2.7x         4.3x
```

In run 1 a withdrawal of the reported 14.752 reverted
`InsufficientMarginAfterWithdrawal()`; 0.7 succeeded and 0.3 did not, which
locates the true limit at the headroom rather than the reported figure. The
getter appears to ignore the margin locked against open positions.

## Why it matters

This is the number a UI puts next to a withdraw button. A front end that trusts
it offers users a maximum that always fails, and the failure arrives as a
contract revert after a signature rather than as client-side validation.

It also misleads anything automated. We hit it building a liquidation-protection
tool: reading the getter to understand an account's free collateral gives a
figure several times larger than the account actually has available, which would
make a risk calculation wrong in the dangerous direction.

Either the getter should subtract locked margin, or its name and documentation
should say which quantity it reports and which call will reject it.

## Environment

- Network: Somnia Hideki / Tokyo testnet (chain 50383)
- MarginBank: `0x478769E1177C0773c43A593DCCc4Ad15F15F1394`
- Account held one BTC perp position throughout
- `@somnia-chain/markets-sdk` 0.32.1 for the health figures
  (`getAccountHealth` → `equity`, `imReq`)
- Checked: 2026-10-23
