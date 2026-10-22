/**
 *  Dreamcatcher's core read: can we see a live account's margin health?
 *  Find a real account with an open position and ask the SDK how healthy it is.
 */
import { createPublicClient, http, formatUnits } from "viem";
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { hideki, INDEXER_URL, WS_URL, PERPS } from "../src/config.js";

const markets = new SomniaMarkets({
  chain: hideki, indexerUrl: INDEXER_URL, wsRpcUrl: WS_URL,
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
});
const client = createPublicClient({ chain: hideki, transport: http() });

const positions: any[] = await markets.client.listPerpPositions({ limit: 6 } as any);
console.log(`\n${positions.length} open position(s) found on the venue\n`);

const seen = new Set<string>();
for (const p of positions.slice(0, 4)) {
  const acct = p.account ?? p.owner;
  if (!acct || seen.has(acct)) continue;
  seen.add(acct);
  console.log(`account ${acct}`);
  console.log(`   market ${p.baseSymbol ?? p.perpPool}  size ${p.size ?? p.netSize}`);
  try {
    // These live on the client, not as standalone exports.
    const health = await (markets.client as any).getAccountHealth(PERPS.marginBank, acct);
    for (const [k, v] of Object.entries(health)) {
      console.log(`   ${k.padEnd(22)} ${typeof v === "bigint" ? v.toString() : JSON.stringify(v)}`);
    }
  } catch (err: any) {
    console.log(`   getAccountHealth failed: ${(err?.shortMessage ?? err?.message ?? err).split("\n")[0]}`);
  }
  console.log();
}

await markets.close?.();
process.exit(0);
