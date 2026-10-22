/**
 *  List the live perp markets and check what the docs say about them.
 *
 *  Two documented claims get tested here:
 *   1. per-market addresses must be read from the market row, not hardcoded;
 *   2. the perps collateral is the market's `quoteToken`, and is NOT
 *      `SOMNIA_HIDEKI_TESTNET_ADDRESSES.collateral`.
 */
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES, isPerpMarket } from "@somnia-chain/markets-sdk";
import { hideki, INDEXER_URL, WS_URL, PERPS } from "../src/config.js";

const markets = new SomniaMarkets({
  chain: hideki,
  indexerUrl: INDEXER_URL,
  wsRpcUrl: WS_URL,
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
});

const perps = await markets.client.listPerpMarkets();
console.log(`\n${perps.length} perp market(s) live\n`);

const j = (v: unknown) => (typeof v === "bigint" ? v.toString() : v);

for (const m of perps) {
  console.log(`— ${m.baseSymbol ?? "?"} / ${m.quoteSymbol ?? "?"}`);
  for (const k of [
    "marketId", "poolAddress", "marginBank", "stopRegistry", "quoteToken",
    "baseDecimals", "quoteDecimals", "tickSize", "lotSize", "minQuantity", "status",
  ] as const) {
    if (k in (m as any)) console.log(`     ${k.padEnd(16)} ${j((m as any)[k])}`);
  }
  console.log();
}

if (perps.length > 0) {
  const m: any = perps[0];
  const sdkCollateral = SOMNIA_HIDEKI_TESTNET_ADDRESSES.collateral;
  const same = String(m.quoteToken).toLowerCase() === String(sdkCollateral).toLowerCase();
  console.log(`market quoteToken          ${m.quoteToken}`);
  console.log(`SDK addresses.collateral   ${sdkCollateral}`);
  console.log(`docs "Collateral (USDso)"  ${PERPS.collateral}`);
  console.log(
    same
      ? "\nquoteToken EQUALS the SDK's collateral — the docs' warning does not hold here."
      : "\nquoteToken differs from the SDK's `collateral`, as the docs warn.",
  );
  console.log(
    String(m.quoteToken).toLowerCase() === PERPS.collateral.toLowerCase()
      ? "quoteToken matches the address the docs list as Collateral (USDso)."
      : "quoteToken does NOT match the docs' Collateral (USDso) either — three distinct addresses.",
  );
}

// Keep the process from hanging on the SDK's socket.
await markets.close?.();
process.exit(0);
