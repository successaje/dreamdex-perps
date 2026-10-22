import { toFunctionSelector, toEventSelector } from "viem";
import * as sdk from "@somnia-chain/markets-sdk";

const dump = (label: string, abi: any[], kind: "function" | "event") => {
  console.log(`\n=== ${label} ===`);
  for (const f of abi.filter((x) => x.type === kind)) {
    const sig = `${f.name}(${f.inputs.map((i: any) => i.type).join(",")})`;
    const sel = kind === "function" ? toFunctionSelector(sig) : toEventSelector(sig);
    const args = f.inputs.map((i: any) => `${i.type}${i.indexed ? " indexed" : ""} ${i.name}`).join(", ");
    console.log(`  ${sel.slice(0, 12).padEnd(12)} ${f.name}(${args})`);
  }
};

dump("marginBankWriteAbi — can anyone add margin for another account?", (sdk as any).marginBankWriteAbi, "function");
dump("operatorRegistryWriteAbi — delegation", (sdk as any).operatorRegistryWriteAbi, "function");
dump("marginBankEventsAbi — margin health signals for reactivity", (sdk as any).marginBankEventsAbi, "event");
dump("liquidationEngineEventsAbi", (sdk as any).liquidationEngineEventsAbi, "event");

console.log("\n=== MARGIN_STATUS ===");
console.log(" ", JSON.stringify((sdk as any).MARGIN_STATUS));
console.log("\n=== LIQUIDATION_KIND ===");
console.log(" ", JSON.stringify((sdk as any).LIQUIDATION_KIND));
