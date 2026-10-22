/** Run the docs' own perps example and see whether it holds up. */
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { hideki, INDEXER_URL, WS_URL } from "../src/config.js";

const markets = new SomniaMarkets({
  chain: hideki, indexerUrl: INDEXER_URL, wsRpcUrl: WS_URL,
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
});

const perps: any[] = await markets.client.listPerpMarkets();
console.log(`\nall ${perps.length} symbols:`);
console.log("  " + perps.map((m) => m.baseSymbol).join(", "));

const btc = perps.find((m) => m.baseSymbol === "BTC");
console.log(`\ndocs example does: perps.find(m => m.baseSymbol === "BTC")!`);
console.log(btc ? `  -> found, pool ${btc.poolAddress}` : `  -> UNDEFINED. The docs' example market does not exist here.`);

console.log(`\nmethods the docs name:`);
for (const name of ["listPerpMarkets", "getMaxPerpOrderSize", "getPerpSystemConfig", "getPerpPortfolio"]) {
  console.log(`  client.${name.padEnd(22)} ${typeof (markets.client as any)[name] === "function" ? "exists" : "MISSING"}`);
}
// `markets.trader` is a getter that THROWS without a signer, so optional
// chaining does not protect you and plain feature-detection is impossible.
try {
  const t = markets.trader as any;
  console.log(`  trader.placePerpOrder        ${typeof t?.placePerpOrder === "function" ? "exists" : "MISSING"}`);
} catch (err) {
  console.log(`  trader.placePerpOrder        unreachable without a signer (${(err as Error).name})`);
}

console.log(`\ndecimals spread across markets (the docs example assumes you read them per market):`);
const spread = new Map<string, string[]>();
for (const m of perps) {
  const k = `base=${m.baseDecimals} quote=${m.quoteDecimals}`;
  spread.set(k, [...(spread.get(k) ?? []), m.baseSymbol]);
}
for (const [k, syms] of spread) console.log(`  ${k.padEnd(24)} ${syms.join(", ")}`);

await markets.close?.();
process.exit(0);
