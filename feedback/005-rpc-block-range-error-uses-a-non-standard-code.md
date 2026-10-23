# RPC returns a non-standard JSON-RPC error code for the block-range limit

Severity: normal
Area: API

## Steps to reproduce

Call `eth_getLogs` with a range wider than 1000 blocks, then call three other
methods that also fail, and compare the codes.

```bash
RPC=https://api.hideki2.infra.testnet.somnia.network
call() { curl -s -X POST $RPC -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}"; }

call eth_getLogs '[{"fromBlock":"0x1","toBlock":"0x99999"}]'
call eth_notARealMethod '[]'
call eth_getBalance '["not-an-address","latest"]'
call eth_getTransactionByHash '[]'
```

## Expected

The block-range refusal carries a code a client can switch on, in one of the
ranges JSON-RPC 2.0 reserves for errors — `-32000..-32099` for server errors,
or `-32602` for an invalid parameter. The same node already does this for every
other failure, so a caller can reasonably expect it here.

## Actual

The block-range error alone returns **`-1`**:

```
eth_getLogs oversized range    code      -1   block range exceeds 1000
unknown method                 code  -32601   method not found
bad params                     code  -32602   invalid parameters
missing params                 code  -32602   invalid parameters
```

`-1` is outside every range JSON-RPC 2.0 reserves, so a client cannot classify
it. The only way to detect this specific, completely routine condition and
react to it — by splitting the range and retrying — is to **string-match the
message** `"block range exceeds 1000"`, which breaks the moment the wording or
the limit changes.

This is not an exotic path. Somnia produces blocks roughly every 100ms, so the
1000-block window is about **100 seconds of history**. Any keeper, indexer,
backfill or log-scanning client hits this constantly and has to handle it
programmatically rather than as a fatal error.

A secondary note: the limit is 1000 blocks **inclusive**. A span of exactly
1000 succeeds and 1001 fails, which is worth stating in the docs since the
obvious `toBlock - fromBlock` arithmetic lands a developer one block over.

```
  999 blocks  ok
 1000 blocks  ok          <- 6455 logs returned
 1001 blocks  block range exceeds 1000
```

## Evidence

Raw JSON-RPC response for the oversized range:

```json
{"code":-1,"message":"block range exceeds 1000","data":null}
```

Note that `viem` surfaces this only as `RPC Request failed.`, so the useful
message is invisible to anyone using it unless they unwrap the cause by hand —
another reason the code matters more than the string.

## Environment

- Network: Somnia Hideki / Tokyo testnet (chain 50383)
- RPC: `https://api.hideki2.infra.testnet.somnia.network`
- Checked: 2026-10-23
