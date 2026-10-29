# The indexer exposes Hasura aggregates on exactly one table, so nothing else can be counted

Severity: normal
Area: API

## Steps to reproduce

1. Ask the indexer which aggregate roots it exposes:

```bash
IDX=https://hideki-dev.smk.somnia.host/v1/graphql
curl -s -X POST $IDX -H 'content-type: application/json' \
  -d '{"query":"{ __schema { queryType { fields { name } } } }"}' \
  | tr ',' '\n' | grep -o '"[A-Za-z_]*_aggregate"' | sort -u
```

2. Confirm the one that exists works:

```bash
curl -s -X POST $IDX -H 'content-type: application/json' \
  -d '{"query":"{ Market_aggregate { aggregate { count } } }"}'
```

3. Ask for the same thing on any other table:

```bash
curl -s -X POST $IDX -H 'content-type: application/json' \
  -d '{"query":"{ LiquidationEvent_aggregate { aggregate { count } } }"}'
```

## Expected

Hasura generates `X`, `X_by_pk` and `X_aggregate` for every table it tracks.
`Fill`, `LiquidationEvent`, `Order`, `FundingPayment` and the rest should each
answer `aggregate { count }`, and `sum` / `avg` / `max` / `min` on their numeric
columns — which is how any volume figure, fill count or funding total is meant
to be computed.

## Actual

Of **199 query-root fields, exactly one is an aggregate**: `Market_aggregate`.

```
"Market_aggregate"
```

It works, which is the point — the capability is present and configured:

```json
{"data":{"Market_aggregate":{"aggregate":{"count":23742}}}}
```

Every other table refuses at validation:

```json
{"errors":[{"message":"field 'LiquidationEvent_aggregate' not found in type: 'query_root'",
            "extensions":{"code":"validation-failed"}}]}
```

So this is not a deliberate "no aggregates" policy. It is one table's `select`
permission carrying `allow_aggregations: true` and roughly ninety-eight others
not.

## Impact

**To learn one integer you must transfer every row it summarises.** Counting the
last 24 hours of liquidations — a single number — is 249,621 bytes over 4.59
seconds:

```
GET  LiquidationEvent(where: {timestamp: {_gt: <now-86400>}}) { id account kind timestamp }
     bytes=249621  time=4.588s  rows=1330
```

The equivalent `aggregate { count }` would be a few hundred bytes and one index
scan. On a page that refreshes, the difference is paid every interval, by every
client.

The second-order effect is worse, and it bit us: with no `count`, a client has
to pick a `limit` and treat the row count as the answer. Ours asked for 1,000
and reported `rows.length`. There are 1,330. The headline was not a
near-miss — it was the limit, rendered as a measurement, with nothing in the
response to indicate truncation. Any consumer that counts this way is wrong by
however much it guessed low, silently, and looks most precise exactly when it
is most wrong.

There is no server-side cap to work around, incidentally: a request for 20,000
rows returned all 7,690 that exist. The problem is purely that counting
requires downloading.

## Suggested fix

Set `allow_aggregations: true` on the `select` permission for the remaining
tracked tables, as `Market` already has. No schema change, no new endpoint.

If aggregates are being withheld from some tables deliberately — cost, cardinality
— then saying so in the docs, with the intended way to get a count, would be
worth as much as the feature.

## Environment

- Indexer: `https://hideki-dev.smk.somnia.host/v1/graphql` (Hasura)
- Network: Somnia Hideki / Tokyo testnet (chain 50383)
- `Market_aggregate` count at time of check: 23,742
- `LiquidationEvent` rows in the last 24h: 1,330; total in the table: 7,690
- Checked: 2026-10-29
