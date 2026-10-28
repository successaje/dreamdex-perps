/** Does the indexer agree with the chain about our own account? */
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { createPublicClient, formatUnits, http, parseAbi } from "viem";
import { hideki, INDEXER_URL, WS_URL, PERPS } from "../src/config.js";

const WHO = "0x60eF148485C2a5119fa52CA13c52E9fd98F28e87" as const;
const POOL = "0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0" as const;

const pub = createPublicClient({ chain: hideki, transport: http() });
const m = new SomniaMarkets({
  chain: hideki, indexerUrl: INDEXER_URL, wsRpcUrl: WS_URL,
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
});

const bank = parseAbi([
  "function getPosition(address,address) view returns (int256,uint256,int256,int256)",
]);

console.log("\n=== position: chain vs indexer ===");
const onchain = await pub.readContract({ address: PERPS.marginBank as `0x${string}`, abi: bank, functionName: "getPosition", args: [WHO, POOL] });
console.log(`  chain    ${formatUnits(onchain[0], 8)} BTC   entry ${formatUnits(onchain[1], 18)}`);

try {
  // Positional account, then options — unlike listPerpPositionChanges, which
  // takes the account inside its options object.
  const rows = (await (m.client as never as { listPerpPositions: (a: string, o: unknown) => Promise<unknown> })
    .listPerpPositions(WHO, { limit: 10 })) as Array<Record<string, unknown>>;
  const mine = rows.filter((r) => String(r.pool ?? r.perpPool).toLowerCase() === POOL.toLowerCase());
  if (mine.length === 0) console.log(`  indexer  no row for this pool (${rows.length} rows total for the account)`);
  for (const r of mine) {
    console.log(`  indexer  size ${r.size} entry ${r.avgEntryPrice ?? r.entryPrice} block ${r.blockNumber ?? "?"}`);
    const idx = BigInt(String(r.size));
    console.log(idx === onchain[0] ? "  -> agree" : `  -> DISAGREE  chain ${onchain[0]} vs indexer ${idx}`);
  }
} catch (err) {
  console.log(`  listPerpPositions failed: ${(err as Error).message.split("\n")[0].slice(0, 90)}`);
}

console.log("\n=== our fills: does the indexer have the cut? ===");
for (const fn of ["getUserFills", "listPerpPositionChanges"] as const) {
  try {
    const rows = (fn === "getUserFills"
      ? await (m.client as never as Record<string, (a: string, o: unknown) => Promise<unknown>>)[fn](WHO, { limit: 10 })
      : await (m.client as never as Record<string, (o: unknown) => Promise<unknown>>)[fn]({ account: WHO, limit: 10 })) as unknown[];
    const arr = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] })?.rows ?? []);
    console.log(`  ${fn}: ${arr.length} row(s)`);
    if (arr.length) console.log(`     newest: ${JSON.stringify(arr[0], (_k, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 220)}`);
  } catch (err) {
    console.log(`  ${fn} failed: ${(err as Error).message.split("\n")[0].slice(0, 90)}`);
  }
}

console.log("\n=== funding ===");
try {
  const f = (await (m.client as never as { getFundingRateHistory: (p: string, o: unknown) => Promise<unknown> })
    .getFundingRateHistory(POOL, { limit: 5 })) as unknown[];
  const arr = Array.isArray(f) ? f : ((f as { rows?: unknown[] })?.rows ?? []);
  console.log(`  getFundingRateHistory: ${arr.length} row(s)`);
  if (arr.length) console.log(`     ${JSON.stringify(arr[0], (_k, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 200)}`);
} catch (err) {
  console.log(`  getFundingRateHistory failed: ${(err as Error).message.split("\n")[0].slice(0, 90)}`);
}

await m.close?.();
process.exit(0);
