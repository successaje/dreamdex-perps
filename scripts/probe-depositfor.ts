import { createPublicClient, http, parseAbi } from "viem";
import { hideki, PERPS } from "../src/config.js";
const client = createPublicClient({ chain: hideki, transport: http() });
const abi = parseAbi(["function depositFor(address account, uint256 amount)"]);
const STRANGER = "0x1111111111111111111111111111111111111111" as const;
const TARGET  = "0x2222222222222222222222222222222222222222" as const;
try {
  await client.simulateContract({
    address: PERPS.marginBank as `0x${string}`, abi,
    functionName: "depositFor", args: [TARGET, 1n], account: STRANGER,
  });
  console.log("  simulate succeeded — a stranger can top up another account");
} catch (err: any) {
  const msg = err?.shortMessage ?? err?.message ?? String(err);
  const reason = err?.cause?.reason ?? err?.cause?.data?.errorName ?? "";
  console.log(`  reverted: ${String(msg).split("\n")[0]}`);
  if (reason) console.log(`  reason:   ${reason}`);
  console.log(`\n  (a balance/allowance revert means permission is NOT the blocker)`);
}
