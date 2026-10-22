# Perps docs deep links 308 to the docs index, losing the page

Severity: normal
Area: docs

## Steps to reproduce

1. Open the bounty page's Resources section, which links "Perps on testnet for
   developers" and "Perps on testnet for traders".
2. Request either documented URL:

```bash
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" \
  https://docs.dreamdex.io/developers/perps-on-testnet
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" \
  https://docs.dreamdex.io/trading/perps-on-testnet
```

## Expected

Each URL resolves to its own page, or 308s to the equivalent page under the new
host — e.g. `https://app.dreamdex.io/docs/developers/perps-testnet`.

## Actual

Both return `308` to `https://app.dreamdex.io/docs`, the generic documentation
index. The specific page is dropped, so the reader lands on a table of contents
and has to find the page again by hand. The content does exist at
`https://app.dreamdex.io/docs/developers/perps-testnet/README.md`.

## Evidence

```
perps-on-testnet    308 -> https://app.dreamdex.io/docs
perps-on-testnet    308 -> https://app.dreamdex.io/docs
```

Both links are reachable from the bounty page itself, so this is the first thing
a new participant hits.

## Environment

- Network: Somnia Hideki / Tokyo testnet (chain 50383)
- Checked: 2026-10-22
