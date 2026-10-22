/**
 *  The MarginBank is a 176-byte proxy. To know what it really exposes we need
 *  the implementation, not the SDK's curated write ABI.
 */
import { createPublicClient, http, toFunctionSelector } from "viem";
import { hideki, PERPS } from "../src/config.js";

const client = createPublicClient({ chain: hideki, transport: http() });
const EIP1967_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const slot = await client.getStorageAt({ address: PERPS.marginBank as `0x${string}`, slot: EIP1967_IMPL });
const impl = slot && slot !== "0x" ? (`0x${slot.slice(-40)}` as `0x${string}`) : null;
console.log(`MarginBank proxy  ${PERPS.marginBank}`);
console.log(`EIP-1967 impl     ${impl ?? "(not an EIP-1967 proxy)"}`);

if (impl) {
  const code = await client.getCode({ address: impl });
  console.log(`impl code         ${code ? (code.length - 2) / 2 : 0} bytes`);

  // Which selectors does the implementation bytecode actually contain?
  const candidates = [
    "deposit(uint256)",
    "withdraw(uint256)",
    "depositFor(address,uint256)",
    "depositFor(address,address,uint256)",
    "depositForAccount(address,uint256)",
    "fundChild(address,uint256)",
    "recallFromChild(address,uint256)",
    "repayFunding(uint256)",
    "setMaxLeverage(address,uint16)",
    "marginStatus(address)",
    "getMarginStatus(address)",
    "equity(address)",
    "accountEquity(address)",
  ];
  console.log(`\nselector present in implementation bytecode?`);
  for (const sig of candidates) {
    const sel = toFunctionSelector(sig).slice(2);
    const present = code ? code.toLowerCase().includes(sel.toLowerCase()) : false;
    console.log(`  ${present ? " yes " : "  -  "} 0x${sel}  ${sig}`);
  }
}
