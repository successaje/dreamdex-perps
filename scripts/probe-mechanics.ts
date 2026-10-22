/**
 *  What can a third party actually do on someone else's perp position?
 *
 *  This decides Dreamcatcher's architecture. If an operator can add margin for
 *  an account, Dreamcatcher can protect a position the user already holds. If
 *  it cannot, Dreamcatcher has to custody the position itself, which is a much
 *  worse product.
 */
import { toFunctionSelector, toEventSelector } from "viem";
import * as sdk from "@somnia-chain/markets-sdk";

const names = Object.keys(sdk);

console.log("\n=== perp ABIs the SDK exports ===");
for (const k of names.filter((n) => /perp.*abi|abi.*perp|marginBank|liquidation/i.test(n))) {
  const v: any = (sdk as any)[k];
  if (Array.isArray(v)) console.log(`  ${k}  (${v.length} entries)`);
}

const eventsAbi: any[] = (sdk as any).perpPoolEventsAbi ?? [];
console.log(`\n=== perpPoolEventsAbi — ${eventsAbi.length} events (reactivity subscribes to these) ===`);
for (const e of eventsAbi.filter((x) => x.type === "event")) {
  const sig = `${e.name}(${e.inputs.map((i: any) => i.type).join(",")})`;
  const indexed = e.inputs.filter((i: any) => i.indexed).map((i: any) => i.name).join(", ");
  console.log(`  ${toEventSelector(sig)}  ${e.name}`);
  console.log(`      ${sig}`);
  if (indexed) console.log(`      indexed: ${indexed}`);
}

const writeAbi: any[] = (sdk as any).perpPoolWriteAbi ?? [];
console.log(`\n=== perpPoolWriteAbi — writable functions ===`);
for (const f of writeAbi.filter((x) => x.type === "function")) {
  const sig = `${f.name}(${f.inputs.map((i: any) => i.type).join(",")})`;
  console.log(`  ${toFunctionSelector(sig).padEnd(12)} ${sig}`);
}

console.log(`\n=== margin / operator helpers in the SDK ===`);
for (const k of names.filter((n) => /margin|operator|liquidat|collateral|deposit|withdraw/i.test(n))) {
  console.log(`  ${k}  (${typeof (sdk as any)[k]})`);
}
