/**
 *  Times listPerpMarkets and listLiquidations stage by stage under Node.
 *
 *  Written to chase a browser hang in listLiquidations. It was not the SDK:
 *  the cause was a StrictMode double-mount deadlock in our own useVenue hook,
 *  and the SDK resolves the call in a browser in about 1.5s. Kept as a timing
 *  harness, not as evidence of an SDK fault.
 */
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { hideki, INDEXER_URL, WS_URL } from "../src/config.js";

const t0 = Date.now();
const lap = (what: string) => console.log(`  ${String(Date.now() - t0).padStart(6)}ms  ${what}`);

const markets = new SomniaMarkets({
  chain: hideki, indexerUrl: INDEXER_URL, wsRpcUrl: WS_URL,
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
});
lap("constructed");

const timeout = <T,>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms))]);

for (const [label, call] of [
  ["listPerpMarkets", () => markets.client.listPerpMarkets()],
  ["listLiquidations", () => (markets.client as never as { listLiquidations: (o: unknown) => Promise<unknown> }).listLiquidations({ limit: 10 })],
] as const) {
  try {
    const r = await timeout(call() as Promise<unknown>, 20_000, label);
    const n = Array.isArray(r) ? r.length : (r as { rows?: unknown[] })?.rows?.length ?? "?";
    lap(`${label} -> ${n} rows`);
  } catch (err) {
    lap(`${label} FAILED: ${(err as Error).message}`);
  }
}

await markets.close?.();
lap("closed");
process.exit(0);
