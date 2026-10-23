/**
 *  Did the old implementation leave anything resting on the book?
 *
 *  Immediate-only execution prevents NEW leftovers; it does not cancel old
 *  ones. The previous build passed `orderType = 0` (a resting limit), so any
 *  order it placed could still be live — and disarming Dreamcatcher would not
 *  touch it.
 */
import { createPublicClient, http, parseAbi, formatUnits } from "viem";
import { hideki } from "../src/config.js";

const ACCOUNT = "0x60eF148485C2a5119fa52CA13c52E9fd98F28e87" as const;
const POOLS = [
  ["BTC", "0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0"],
] as const;

const c = createPublicClient({ chain: hideki, transport: http() });
const abi = parseAbi([
  "function getAllOpenOrdersOffChain(bool isBid, uint256 maxCount, uint64 startCursor) view returns ((uint128 orderId, bool isBid, address owner, uint64 userData, uint256 price, uint256 fullQuantity, uint256 quantityRemaining, uint64 expireTimestampNs)[] orders, bool hasMoreOrders, uint64 nextCursor)",
]);

console.log(`\naccount ${ACCOUNT}`);
let total = 0;
for (const [symbol, pool] of POOLS) {
  for (const isBid of [true, false]) {
    try {
      const [orders] = await c.readContract({
        address: pool as `0x${string}`, abi,
        functionName: "getAllOpenOrdersOffChain", args: [isBid, 200n, 0n],
      });
      const mine = orders.filter((o) => o.owner.toLowerCase() === ACCOUNT.toLowerCase());
      total += mine.length;
      console.log(`  ${symbol} ${isBid ? "bids" : "asks"}: ${orders.length} on the book, ${mine.length} ours`);
      for (const o of mine) {
        console.log(`     id ${o.orderId}  qty ${formatUnits(o.quantityRemaining, 8)} / ${formatUnits(o.fullQuantity, 8)}  @ ${formatUnits(o.price, 18)}`);
      }
    } catch (err) {
      console.log(`  ${symbol} ${isBid ? "bids" : "asks"}: read failed — ${(err as Error).message.split("\n")[0].slice(0, 70)}`);
    }
  }
}
console.log(
  total === 0
    ? `\nNothing of ours is resting. The old build placed no surviving order.\n`
    : `\n${total} resting order(s) belong to this account and would NOT be cancelled by disarming.\n`,
);
