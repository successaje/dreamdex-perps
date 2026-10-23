/**
 *  Push the existing position close to a margin call, so a real cut can fire.
 *
 *  Adds the largest size the venue will allow, which by definition leaves the
 *  initial-margin requirement at the edge of equity. Deliberate and bounded:
 *  maintenance margin stays far below, so this approaches a margin call rather
 *  than a liquidation.
 */
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { createPublicClient, formatUnits, http, parseAbi, type Hex } from "viem";
import { hideki, INDEXER_URL, WS_URL, PERPS } from "../src/config.js";

const POOL = "0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0" as const;
const WHO = "0x60eF148485C2a5119fa52CA13c52E9fd98F28e87" as const;
const RUNG = ["Healthy", "MarginCall", "PartialLiquidation", "CloseOut"] as const;

const pk = process.env.PRIVATE_KEY as Hex | undefined;
if (!pk) { console.error("PRIVATE_KEY required"); process.exit(1); }

const pub = createPublicClient({ chain: hideki, transport: http() });
const m = new SomniaMarkets({
  chain: hideki, indexerUrl: INDEXER_URL, wsRpcUrl: WS_URL,
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, privateKey: pk,
});

const bankAbi = parseAbi([
  "function getPosition(address,address) view returns (int256,uint256,int256,int256)",
  "function getMarginStatus(address) view returns (uint8)",
]);
const levels = parseAbi(["function getBookLevels(bool,uint64) view returns ((uint256 price,uint256 quantity)[])"]);

async function snapshot(label: string) {
  const [pos, status, health] = await Promise.all([
    pub.readContract({ address: PERPS.marginBank as `0x${string}`, abi: bankAbi, functionName: "getPosition", args: [WHO, POOL] }),
    pub.readContract({ address: PERPS.marginBank as `0x${string}`, abi: bankAbi, functionName: "getMarginStatus", args: [WHO] }),
    (m.client as unknown as { getAccountHealth: (a: string, b: string) => Promise<Record<string, bigint>> })
      .getAccountHealth(PERPS.marginBank, WHO),
  ]);
  console.log(`\n${label}`);
  console.log(`  size    ${formatUnits(pos[0] < 0n ? -pos[0] : pos[0], 8)} BTC ${pos[0] > 0n ? "long" : pos[0] < 0n ? "short" : ""}`);
  console.log(`  status  ${status} ${RUNG[Number(status)]}`);
  console.log(`  equity  ${formatUnits(health.equity, 18)}   imReq ${formatUnits(health.imReq, 18)}   mmReq ${formatUnits(health.mmReq, 18)}`);
  return Number(status);
}

await snapshot("before");

const max = await (m.client as unknown as { getMaxPerpOrderSize: (o: unknown) => Promise<{ maxQuantity: bigint }> })
  .getMaxPerpOrderSize({ pool: POOL, marginBank: PERPS.marginBank, account: WHO, isBid: true, price: 82_000n * 10n ** 18n });

const asks = await pub.readContract({ address: POOL, abi: levels, functionName: "getBookLevels", args: [false, 3] });
const limit = (asks[asks.length - 1]?.price ?? 0n) + 50n * 10n ** 18n;
const qty = (max.maxQuantity / 1000n) * 1000n; // onto the lot grid

console.log(`\nadding ${formatUnits(qty, 8)} BTC up to ${formatUnits(limit, 18)}…`);
const r = await (m.trader as unknown as { placePerpOrder: (o: unknown) => Promise<{ hash: string }> })
  .placePerpOrder({ pool: POOL, isBid: true, price: limit, quantity: qty });
console.log(`  tx ${r.hash}`);
await pub.waitForTransactionReceipt({ hash: r.hash as Hex });

const status = await snapshot("after");
console.log(
  status >= 1
    ? `\nAt ${RUNG[status]} — a cut should now fire.`
    : `\nStill Healthy. The requirement is at the edge; a small adverse move or a margin withdrawal tips it.`,
);

await m.close?.();
process.exit(0);
