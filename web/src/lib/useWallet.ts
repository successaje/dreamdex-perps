import { useCallback, useEffect, useState } from "react";
import { ensureHideki, getProvider, hideki } from "./chain";

export interface Wallet {
  available: boolean;
  account: `0x${string}` | null;
  onRightChain: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  switchChain: () => Promise<void>;
}

export function useWallet(): Wallet {
  const provider = getProvider();
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!provider) return;
    void provider.request({ method: "eth_accounts" }).then((a) => {
      const list = a as `0x${string}`[];
      if (list.length) setAccount(list[0]);
    });
    void provider.request({ method: "eth_chainId" }).then((c) => setChainId(Number(c as string)));

    const onAccounts = (a: unknown) => setAccount(((a as string[])[0] as `0x${string}`) ?? null);
    const onChain = (c: unknown) => setChainId(Number(c as string));
    const p = provider as unknown as { on?: (e: string, h: (v: unknown) => void) => void; removeListener?: (e: string, h: (v: unknown) => void) => void };
    p.on?.("accountsChanged", onAccounts);
    p.on?.("chainChanged", onChain);
    return () => {
      p.removeListener?.("accountsChanged", onAccounts);
      p.removeListener?.("chainChanged", onChain);
    };
  }, [provider]);

  const connect = useCallback(async () => {
    if (!provider) return;
    setConnecting(true);
    setError(null);
    try {
      const a = (await provider.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
      setAccount(a[0] ?? null);
      await ensureHideki(provider);
      setChainId(hideki.id);
    } catch (err) {
      // 4001 is the user closing the prompt, which is not an error state.
      const code = (err as { code?: number })?.code;
      if (code !== 4001) setError((err as Error)?.message ?? "Could not connect");
    } finally {
      setConnecting(false);
    }
  }, [provider]);

  const switchChain = useCallback(async () => {
    if (!provider) return;
    try {
      await ensureHideki(provider);
      setChainId(hideki.id);
    } catch {
      /* declined */
    }
  }, [provider]);

  return {
    available: Boolean(provider),
    account,
    onRightChain: chainId === hideki.id,
    connecting,
    error,
    connect,
    switchChain,
  };
}
