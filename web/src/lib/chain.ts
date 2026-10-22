import { createPublicClient, createWalletClient, custom, defineChain, http, type EIP1193Provider } from "viem";

/**
 *  Somnia Hideki testnet. The bounty calls it Tokyo, the docs call it Hideki,
 *  the explorer path is /tokyo and the RPC host is hideki2 — one chain, 50383.
 */
export const hideki = defineChain({
  id: 50383,
  name: "Somnia Hideki",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: {
      http: [(import.meta.env.VITE_RPC_URL as string | undefined) ?? "https://api.hideki2.infra.testnet.somnia.network"],
    },
  },
  blockExplorers: { default: { name: "Somnia Explorer", url: "https://explorer.testnet.somnia.network/tokyo" } },
  testnet: true,
});

export const MARGIN_BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const;
export const OPERATOR_REGISTRY = "0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a" as const;
/** Set once Dreamcatcher is deployed; until then the app runs read-only. */
export const DREAMCATCHER = import.meta.env.VITE_DREAMCATCHER as `0x${string}` | undefined;

export const publicClient = createPublicClient({ chain: hideki, transport: http() });

export function getProvider(): EIP1193Provider | null {
  return (globalThis as { ethereum?: EIP1193Provider }).ethereum ?? null;
}

export function walletClient(account: `0x${string}`) {
  const provider = getProvider();
  if (!provider) throw new Error("No wallet found");
  return createWalletClient({ account, chain: hideki, transport: custom(provider) });
}

/** Move the wallet to Hideki, adding the chain if it has never seen it. */
export async function ensureHideki(provider: EIP1193Provider): Promise<void> {
  const hexId = `0x${hideki.id.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (err) {
    // 4902 = the wallet does not know this chain yet. Anything else is a decline.
    const code = (err as { code?: number; data?: { originalError?: { code?: number } } })?.code;
    const inner = (err as { data?: { originalError?: { code?: number } } })?.data?.originalError?.code;
    if (code !== 4902 && inner !== 4902) throw err;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: hexId,
        chainName: hideki.name,
        nativeCurrency: hideki.nativeCurrency,
        rpcUrls: [...hideki.rpcUrls.default.http],
        blockExplorerUrls: [hideki.blockExplorers.default.url],
      }],
    });
  }
}
