/**
 *  Does `getMaxPerpOrderSize` agree with what the pool will accept?
 *
 *  Same shape as the `getWithdrawableCollateral` finding: a view that tells a
 *  UI the maximum, and a write that may refuse it. Simulated only — no orders
 *  are placed.
 */
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { createPublicClient, formatUnits, http, parseAbi, toFunctionSelector } from "viem";
import * as sdk from "@somnia-chain/markets-sdk";
import { hideki, INDEXER_URL, WS_URL, PERPS } from "../src/config.js";

const WHO = "0x60eF148485C2a5119fa52CA13c52E9fd98F28e87" as const;
const POOL = "0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0" as const;
const LOT = 1_000n;

const pub = createPublicClient({ chain: hideki, transport: http() });
const m = new SomniaMarkets({
  chain: hideki, indexerUrl: INDEXER_URL, wsRpcUrl: WS_URL,
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
});

const levels = parseAbi(["function getBookLevels(bool,uint64) view returns ((uint256 price,uint256 quantity)[])"]);
const asks = await pub.readContract({ address: POOL, abi: levels, functionName: "getBookLevels", args: [false, 3] });
const price = (asks[asks.length - 1]?.price ?? 0n) + 100n * 10n ** 18n;

const max = (await (m.client as never as { getMaxPerpOrderSize: (o: unknown) => Promise<{ maxQuantity: bigint; limitedBy: string; placeable: boolean }> })
  .getMaxPerpOrderSize({ pool: POOL, marginBank: PERPS.marginBank, account: WHO, isBid: true, price }));

console.log(`\nmaxQuantity  ${formatUnits(max.maxQuantity, 8)} BTC  (${max.maxQuantity})`);
console.log(`limitedBy    ${max.limitedBy}   placeable ${max.placeable}`);
console.log(`price used   ${formatUnits(price, 18)}`);

const pool = parseAbi([
  "function placeOrder(bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFee)",
]);

const resolve = (sel: string) => {
  for (const e of (sdk.contractErrorsAbi ?? []) as Array<{ type: string; name: string; inputs?: Array<{ type: string }> }>) {
    if (e.type !== "error") continue;
    const s = `${e.name}(${(e.inputs ?? []).map((i) => i.type).join(",")})`;
    if (toFunctionSelector(s) === sel) return s;
  }
  return "(unknown)";
};

for (const [label, qty] of [
  ["exactly max      ", max.maxQuantity],
  ["max minus one lot", max.maxQuantity - LOT],
  ["max plus one lot ", max.maxQuantity + LOT],
] as const) {
  if (qty <= 0n) { console.log(`  ${label}  skipped (non-positive)`); continue; }
  try {
    await pub.simulateContract({
      address: POOL, abi: pool, functionName: "placeOrder",
      args: [true, 0n, price, qty, BigInt(Math.floor(Date.now() / 1000) + 300) * 1_000_000_000n, 2, 0, "0x0000000000000000000000000000000000000000", 0n],
      account: WHO,
    });
    console.log(`  ${label}  ACCEPTED`);
  } catch (err) {
    const data = (err as { cause?: { data?: string } })?.cause?.data;
    const sel = typeof data === "string" ? data.slice(0, 10) : "";
    console.log(`  ${label}  refused  ${sel} ${sel ? resolve(sel) : (err as Error).message.split("\n")[0].slice(0, 60)}`);
  }
}

await m.close?.();
process.exit(0);
