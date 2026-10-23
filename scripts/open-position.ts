/**
 *  Open a small perp position from the bounty dev EOA, through the SDK.
 *
 *  Deliberately small: this exists so there is something for Dreamcatcher to
 *  protect, not to express a view.
 */
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { createPublicClient, formatUnits, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hideki, INDEXER_URL, WS_URL, PERPS } from "../src/config.js";

const SYMBOL = process.argv.includes("--symbol")
  ? process.argv[process.argv.indexOf("--symbol") + 1]
  : "BTC";

const pk = process.env.PRIVATE_KEY as Hex | undefined;
if (!pk) { console.error("PRIVATE_KEY required (use --env-file=.env)"); process.exit(1); }
const account = privateKeyToAccount(pk);

const pub = createPublicClient({ chain: hideki, transport: http() });
const markets = new SomniaMarkets({
  chain: hideki, indexerUrl: INDEXER_URL, wsRpcUrl: WS_URL,
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, privateKey: pk,
});

const perps = (await markets.client.listPerpMarkets()) as Array<Record<string, unknown>>;
const m = perps.find((x) => x.baseSymbol === SYMBOL);
if (!m) { console.error(`no ${SYMBOL} market`); process.exit(1); }

const pool = String(m.poolAddress) as `0x${string}`;
const baseDec = Number(m.baseDecimals);
const quoteDec = Number(m.quoteDecimals);

console.log(`\n${SYMBOL}  pool ${pool}`);
console.log(`  decimals   base ${baseDec}  quote ${quoteDec}`);
console.log(`  lotSize    ${m.lotSize}`);
console.log(`  tickSize   ${m.tickSize}`);

// Wallet and margin state before anything moves.
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const collateral = String(m.quoteToken ?? PERPS.collateral) as `0x${string}`;
const wallet = await pub.readContract({ address: collateral, abi: erc20, functionName: "balanceOf", args: [account.address] });
console.log(`\nwallet USDso ${formatUnits(wallet, quoteDec)}`);

// The book, so the order is placed where it can actually fill.
const levels = parseAbi(["function getBookLevels(bool isBid, uint64 numLevels) view returns ((uint256 price, uint256 quantity)[])"]);
for (const [label, isBid] of [["bids", true], ["asks", false]] as const) {
  try {
    const l = await pub.readContract({ address: pool, abi: levels, functionName: "getBookLevels", args: [isBid, 3] });
    console.log(`  ${label.padEnd(5)} ${l.map((x) => `${formatUnits(x.price, quoteDec)} x ${formatUnits(x.quantity, baseDec)}`).join("  |  ") || "(empty)"}`);
  } catch (err) {
    console.log(`  ${label.padEnd(5)} read failed: ${(err as Error).message.split("\n")[0].slice(0, 60)}`);
  }
}


/* ----------------------------------------------------------------- trade */

const DEPOSIT = 15n * 10n ** BigInt(quoteDec);   // margin to post
const QUANTITY = 200_000n;                        // 0.002 BTC at 8 decimals
const SLIP = 20n * 10n ** BigInt(quoteDec);       // cross a few levels

if (!process.argv.includes("--go")) {
  console.log("\n--go not passed; nothing sent.");
  await markets.close?.();
  process.exit(0);
}

// 1 · approve, then post margin
const allowance = await pub.readContract({ address: collateral, abi: erc20, functionName: "allowance", args: [account.address, PERPS.marginBank as `0x${string}`] });
if (allowance < DEPOSIT) {
  console.log("\napproving USDso to the MarginBank…");
  const hash = await markets.trader.approveBuilder
    ? undefined
    : undefined;
  void hash;
  const wc = (await import("viem")).createWalletClient({ account, chain: hideki, transport: http() });
  const h = await wc.writeContract({ address: collateral, abi: erc20, functionName: "approve", args: [PERPS.marginBank as `0x${string}`, DEPOSIT * 10n] });
  await pub.waitForTransactionReceipt({ hash: h });
  console.log(`  approve ${h}`);
}

console.log(`\ndepositing ${formatUnits(DEPOSIT, quoteDec)} USDso as margin…`);
try {
  const r = await markets.trader.depositMargin({ marginBank: PERPS.marginBank, amount: DEPOSIT } as never);
  console.log(`  deposit ${JSON.stringify(r, (k, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 160)}`);
} catch (err) {
  console.log(`  depositMargin failed: ${((err as { shortMessage?: string }).shortMessage ?? (err as Error).message).split("\n")[0]}`);
}

// 2 · open the position
const asks = await pub.readContract({ address: pool, abi: levels, functionName: "getBookLevels", args: [false, 3] });
const limit = (asks[asks.length - 1]?.price ?? 0n) + SLIP;
console.log(`\nbuying ${formatUnits(QUANTITY, baseDec)} ${SYMBOL} up to ${formatUnits(limit, quoteDec)}…`);
try {
  const r = await markets.trader.placePerpOrder({ pool, isBid: true, price: limit, quantity: QUANTITY } as never);
  console.log(`  order ${JSON.stringify(r, (k, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 300)}`);
} catch (err) {
  console.log(`  placePerpOrder failed: ${((err as { shortMessage?: string }).shortMessage ?? (err as Error).message).split("\n")[0]}`);
}

await markets.close?.();
process.exit(0);
