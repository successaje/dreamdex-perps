/**
 *  Somnia Hideki testnet — the network the dreamDEX Perps Builder Bounty runs on.
 *
 *  Naming is not consistent across sources and this tripped us before anything
 *  else did: the bounty page says "Somnia Tokyo testnet", the developer docs say
 *  "Hideki testnet", the explorer path is /tokyo, and the RPC host is `hideki2`.
 *  They are the same chain, 50383.
 */
import { defineChain } from "viem";

export const hideki = defineChain({
  id: 50383,
  name: "Somnia Hideki",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://api.hideki2.infra.testnet.somnia.network"] },
  },
  blockExplorers: {
    default: { name: "Somnia Explorer", url: "https://explorer.testnet.somnia.network/tokyo" },
  },
  testnet: true,
});

export const WS_URL = "wss://api.hideki2.infra.testnet.somnia.network/ws";
export const INDEXER_URL = "https://hideki-dev.smk.somnia.host/v1/graphql";

/**
 *  Documented perps core. Per-market addresses (`poolAddress`, `marginBank`,
 *  `stopRegistry`) are deliberately NOT here — the docs say to read those from
 *  each market row rather than hardcode them.
 */
export const PERPS = {
  marginBank: "0x478769E1177C0773c43A593DCCc4Ad15F15F1394",
  collateral: "0xed7993A74dAe1e6656B704A424DcD8711aAf4F72",
  perpPoolFactory: "0xE631fAEE547baeE07353E290f0562ea67d856560",
  liquidationEngine: "0xA66d3C24Ad4a389d863846905D8173e1017e9F4D",
  insuranceFund: "0x50826894D47C6D4f3BeA38BFDC7Dc5c5be171b80",
  voucherDistributor: "0x2ACD9EFdA721450906bfE1bef3edE269636E42C4",
  operatorPermissionsRegistry: "0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a",
} as const;
