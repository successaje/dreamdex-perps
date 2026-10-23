/** Sweep read-only surfaces for things that misbehave. Candidates only. */
import { createPublicClient, http, parseAbi } from "viem";
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { hideki, INDEXER_URL, WS_URL, PERPS } from "../src/config.js";

const c = createPublicClient({ chain: hideki, transport: http() });
const m = new SomniaMarkets({
  chain: hideki, indexerUrl: INDEXER_URL, wsRpcUrl: WS_URL,
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
});

console.log("\n=== 1. eth_getLogs cap: what is it, and how does it fail? ===");
const head = await c.getBlockNumber();
for (const span of [999n, 1000n, 1001n, 5000n]) {
  try {
    await c.getLogs({ address: PERPS.marginBank as `0x${string}`, fromBlock: head - span, toBlock: head });
    console.log(`  ${String(span).padStart(5)} blocks  ok`);
  } catch (err) {
    console.log(`  ${String(span).padStart(5)} blocks  ${(err as Error).message.split("\n")[0].slice(0, 90)}`);
  }
}

console.log("\n=== 2. getMarginStatus on a never-seen account ===");
const bankAbi = parseAbi(["function getMarginStatus(address) view returns (uint8)"]);
for (const who of ["0x1111111111111111111111111111111111111111", "0x0000000000000000000000000000000000000000"] as const) {
  try {
    const s = await c.readContract({ address: PERPS.marginBank as `0x${string}`, abi: bankAbi, functionName: "getMarginStatus", args: [who] });
    console.log(`  ${who.slice(0, 10)}…  status ${s}`);
  } catch (err) {
    console.log(`  ${who.slice(0, 10)}…  reverted: ${(err as Error).message.split("\n")[0].slice(0, 70)}`);
  }
}

console.log("\n=== 3. indexer: does limit have a silent ceiling? ===");
for (const limit of [100, 500, 1000, 5000]) {
  const r = await fetch(INDEXER_URL, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: `{ LiquidationEvent(limit: ${limit}) { id } }` }),
  }).then((x) => x.json() as Promise<{ data?: { LiquidationEvent?: unknown[] }; errors?: Array<{ message: string }> }>);
  console.log(`  asked ${String(limit).padStart(4)}  got ${r.data?.LiquidationEvent?.length ?? `error: ${r.errors?.[0]?.message?.slice(0, 50)}`}`);
}

console.log("\n=== 4. market rows: any field that contradicts the chain? ===");
const perps = (await m.client.listPerpMarkets()) as Array<Record<string, unknown>>;
let mismatches = 0;
for (const mk of perps.slice(0, 6)) {
  const pool = String(mk.poolAddress) as `0x${string}`;
  try {
    const onchain = await c.readContract({
      address: pool,
      abi: parseAbi(["function getOrderBookParameters() view returns ((uint256 tickSize, uint256 minQuantity, uint256 lotSize))"]),
      functionName: "getOrderBookParameters",
    });
    const sameLot = BigInt(String(mk.lotSize)) === onchain.lotSize;
    const sameTick = BigInt(String(mk.tickSize)) === onchain.tickSize;
    if (!sameLot || !sameTick) {
      mismatches++;
      console.log(`  ${String(mk.baseSymbol).padEnd(9)} MISMATCH  indexer lot ${mk.lotSize} tick ${mk.tickSize} | chain lot ${onchain.lotSize} tick ${onchain.tickSize}`);
    } else {
      console.log(`  ${String(mk.baseSymbol).padEnd(9)} agrees    lot ${onchain.lotSize}  tick ${onchain.tickSize}  minQty ${onchain.minQuantity}`);
    }
  } catch (err) {
    console.log(`  ${String(mk.baseSymbol).padEnd(9)} read failed: ${(err as Error).message.split("\n")[0].slice(0, 60)}`);
  }
}
console.log(mismatches === 0 ? "  indexer and chain agree on the grid" : `  ${mismatches} mismatch(es)`);

await m.close?.();
process.exit(0);
