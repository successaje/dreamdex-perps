/**
 *  Check every documented network fact against the live chain.
 *
 *  A documented address with no code behind it, or a chain id that disagrees
 *  with the docs, is a feedback item — and finding them is cheaper than finding
 *  out later from a reverted transaction.
 */
import { createPublicClient, http, formatEther } from "viem";
import { hideki, PERPS, INDEXER_URL, WS_URL } from "../src/config.js";

const client = createPublicClient({ chain: hideki, transport: http() });

const ok = (b: boolean) => (b ? "  ok " : " BAD ");

console.log(`\nRPC   ${hideki.rpcUrls.default.http[0]}`);

const [chainId, head, gas] = await Promise.all([
  client.getChainId(),
  client.getBlockNumber(),
  client.getGasPrice(),
]);

console.log(`${ok(chainId === 50383)} chain id        ${chainId}  (docs say 50383)`);
console.log(`  --  head block      ${head.toLocaleString()}`);
console.log(`  --  gas price       ${formatEther(gas * 10n ** 9n)} gwei-ish (${gas} wei)`);

console.log(`\nDocumented perps core — does each address actually hold code?`);
let missing = 0;
for (const [name, address] of Object.entries(PERPS)) {
  const code = await client.getCode({ address: address as `0x${string}` });
  const size = code && code !== "0x" ? (code.length - 2) / 2 : 0;
  if (size === 0) missing++;
  console.log(`${ok(size > 0)} ${name.padEnd(28)} ${address}  ${size ? `${size} bytes` : "NO CODE"}`);
}

console.log(`\nAncillary endpoints`);
for (const [label, url] of [["indexer", INDEXER_URL], ["websocket", WS_URL]] as const) {
  console.log(`  --  ${label.padEnd(10)} ${url}`);
}

console.log(
  missing === 0
    ? `\nAll ${Object.keys(PERPS).length} documented addresses hold code.\n`
    : `\n${missing} documented address(es) hold NO CODE — candidate feedback item.\n`,
);
