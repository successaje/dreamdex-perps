/**
 *  Wait for the account to cross into a margin call, then fire the cut.
 *
 *  This is the proof the whole product rests on: a FILLED reduction, with the
 *  position measured on both sides and the budget moved by what actually
 *  reduced rather than what was asked for.
 */
import { createPublicClient, createWalletClient, decodeEventLog, formatUnits, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hideki, PERPS } from "../src/config.js";

const DC = "0xcaff129ec344a98da8c9a4091a239df158cf31a5" as const;
const POOL = "0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0" as const;
const RUNG = ["Healthy", "MarginCall", "PartialLiquidation", "CloseOut"] as const;

const pk = process.env.PRIVATE_KEY as Hex;
const account = privateKeyToAccount(pk);
const pub = createPublicClient({ chain: hideki, transport: http() });
const wc = createWalletClient({ account, chain: hideki, transport: http() });

const bankAbi = parseAbi([
  "function getMarginStatus(address) view returns (uint8)",
  "function getPosition(address,address) view returns (int256,uint256,int256,int256)",
]);
const dcAbi = parseAbi([
  "function cut(address account, address pool)",
  "function quote(address account, address pool) view returns (bool,bool,uint256,uint8,string)",
  "function watches(address,address) view returns (uint256,uint16,uint128,uint8,uint16,uint32,uint64,uint16,bool)",
  "event Cut(address indexed account, address indexed pool, bool isBid, uint256 requested, uint256 filled, uint256 limitPrice, uint8 statusBefore, uint16 cutsLeft)",
  "event CutNoFill(address indexed account, address indexed pool, uint256 requested, uint16 attempts)",
  "event CutSkipped(address indexed account, address indexed pool, string reason)",
  "event CutFailed(address indexed account, address indexed pool, bytes4 selector)",
]);

const read = <T,>(fn: string, args: unknown[], addr = PERPS.marginBank, abi = bankAbi) =>
  pub.readContract({ address: addr as `0x${string}`, abi: abi as never, functionName: fn as never, args: args as never }) as Promise<T>;

const DEADLINE = Date.now() + 10 * 60_000;
let tick = 0;

while (Date.now() < DEADLINE) {
  const status = Number(await read<number>("getMarginStatus", [account.address]));
  const pos = await read<readonly [bigint, bigint, bigint, bigint]>("getPosition", [account.address, POOL]);
  const q = await read<readonly [boolean, boolean, bigint, number, string]>(
    "quote", [account.address, POOL], DC, dcAbi,
  );

  if (++tick % 5 === 1 || status >= 1) {
    console.log(
      `${new Date().toISOString().slice(11, 19)}  ${RUNG[status].padEnd(10)} ` +
      `size ${formatUnits(pos[0] < 0n ? -pos[0] : pos[0], 8)}  ` +
      `wouldCut=${q[0]}${q[4] ? ` (${q[4]})` : ""}`,
    );
  }

  if (status >= 1 && q[0]) {
    console.log(`\nfiring cut — quote says ${formatUnits(q[2], 8)} BTC, isBid=${q[1]}`);
    const before = pos[0];
    const hash = await wc.writeContract({ address: DC, abi: dcAbi, functionName: "cut", args: [account.address, POOL], gas: 60_000_000n });
    const r = await pub.waitForTransactionReceipt({ hash });
    console.log(`tx ${hash}\nstatus ${r.status}  gasUsed ${r.gasUsed}`);
    for (const l of r.logs) {
      if (l.address.toLowerCase() !== DC.toLowerCase()) continue;
      try {
        const d = decodeEventLog({ abi: dcAbi, data: l.data, topics: l.topics });
        console.log(`event ${d.eventName}`, JSON.stringify(d.args, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
      } catch { /* not ours */ }
    }
    const after = (await read<readonly [bigint, bigint, bigint, bigint]>("getPosition", [account.address, POOL]))[0];
    console.log(`\nposition  ${formatUnits(before, 8)} -> ${formatUnits(after, 8)} BTC`);
    console.log(`reduced   ${formatUnits(before - after, 8)} BTC`);
    const w = await read<readonly unknown[]>("watches", [account.address, POOL], DC, dcAbi);
    console.log(`cutsLeft  ${w[7]}   attempts ${w[4]}`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 4_000));
}
console.log("\n10 minutes elapsed without crossing the trigger.");
process.exit(1);
