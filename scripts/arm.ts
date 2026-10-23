/**
 *  Grant Dreamcatcher the one permission it needs, then arm a watch.
 *
 *  Two transactions on purpose: the grant is dreamDEX's own, scoped to one
 *  pool and one selector, and revoking it disables Dreamcatcher regardless of
 *  what the watch's storage says.
 */
import { createPublicClient, createWalletClient, formatUnits, http, parseAbi, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hideki, PERPS } from "../src/config.js";

const DREAMCATCHER = "0x34d156d6c062804771652b48f2d65d58d3794113" as const;
const POOL = "0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0" as const; // BTC
const PLACE_ORDER_FOR = "0x80054449" as const;

const LIMIT = parseUnits("70000", 18); // never sell this long below 70,000
const REDUCE_BPS = 2_500;              // a quarter of the position per cut
const LOT = 1_000n;                    // BTC lot, from the market row
const TRIGGER = 1;                     // wake at the first margin call
const COOLDOWN = 300;
const CUTS = 4;

const pk = process.env.PRIVATE_KEY as Hex | undefined;
if (!pk) { console.error("PRIVATE_KEY required"); process.exit(1); }
const account = privateKeyToAccount(pk);
const pub = createPublicClient({ chain: hideki, transport: http() });
const wc = createWalletClient({ account, chain: hideki, transport: http() });

const regAbi = parseAbi([
  "function setOperatorApprovalForPool(address pool, address operator, bytes4[] selectors, bool approved)",
  "function isApprovedForPool(address pool, address owner, address operator, bytes4 selector) view returns (bool)",
]);
const dcAbi = parseAbi([
  "function arm(address pool, uint256 limitPrice, uint16 reduceBps, uint128 lotSize, uint8 triggerStatus, uint32 cooldown, uint16 cuts)",
  "function quote(address account, address pool) view returns (bool wouldCut, bool isBid, uint256 quantity, uint8 status, string blockedBy)",
]);

const send = async (label: string, hash: Hex) => {
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${label.padEnd(9)} ${r.status}  ${hash}`);
  if (r.status !== "success") process.exit(1);
};

console.log(`\nowner        ${account.address}`);
console.log(`dreamcatcher ${DREAMCATCHER}`);

const granted = await pub.readContract({
  address: PERPS.operatorPermissionsRegistry as `0x${string}`, abi: regAbi,
  functionName: "isApprovedForPool", args: [POOL, account.address, DREAMCATCHER, PLACE_ORDER_FOR],
});

if (!granted) {
  console.log(`\n1 · granting placeOrderFor on BTC…`);
  await send("grant", await wc.writeContract({
    address: PERPS.operatorPermissionsRegistry as `0x${string}`, abi: regAbi,
    functionName: "setOperatorApprovalForPool",
    args: [POOL, DREAMCATCHER, [PLACE_ORDER_FOR], true],
  }));
} else {
  console.log(`\n1 · already granted`);
}

console.log(`\n2 · arming — cut ${REDUCE_BPS / 100}% at margin call, never below ${formatUnits(LIMIT, 18)}…`);
await send("arm", await wc.writeContract({
  address: DREAMCATCHER, abi: dcAbi, functionName: "arm",
  args: [POOL, LIMIT, REDUCE_BPS, LOT, TRIGGER, COOLDOWN, CUTS],
}));

const q = await pub.readContract({ address: DREAMCATCHER, abi: dcAbi, functionName: "quote", args: [account.address, POOL] });
console.log(`\nquote  wouldCut=${q[0]}  isBid=${q[1]}  qty=${formatUnits(q[2], 8)}  status=${q[3]}  ${q[4] ? `blocked: ${q[4]}` : ""}`);
