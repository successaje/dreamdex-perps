import { useCallback, useEffect, useState } from "react";
import { DREAMCATCHER, MARGIN_BANK, OPERATOR_REGISTRY, publicClient } from "./chain";
import { dreamcatcherAbi, marginBankAbi, operatorRegistryAbi, PLACE_ORDER_FOR } from "./abi";

export interface WatchState {
  armed: boolean;
  limitPrice: bigint;
  reduceBps: number;
  lotSize: bigint;
  triggerStatus: number;
  cooldown: number;
  cutsLeft: number;
  /** Attempts made, filled or not — kept apart from cuts spent. */
  attempts: number;
  /** Cuts already spent, derived from what the user originally armed. */
  granted: boolean;
  /** Live from the contract: what a cut right now would do, and why not. */
  wouldCut: boolean;
  isBid: boolean;
  quantity: bigint;
  status: number;
  blockedBy: string;
  /** Signed position size straight off the MarginBank. */
  size: bigint;
  loading: boolean;
  error: string | null;
}

const EMPTY: WatchState = {
  armed: false, limitPrice: 0n, reduceBps: 0, lotSize: 0n, triggerStatus: 0,
  cooldown: 0, cutsLeft: 0, attempts: 0, granted: false, wouldCut: false, isBid: false,
  quantity: 0n, status: 0, blockedBy: "", size: 0n, loading: true, error: null,
};

/**
 *  Everything the watch screen shows, read from chain every few seconds.
 *
 *  `quote` is the contract's own view rather than a reimplementation of its
 *  arithmetic in TypeScript — the two could drift, and the one the user cares
 *  about is the one that will actually run.
 */
export function useWatch(account: `0x${string}` | null, pool: `0x${string}` | null) {
  const [state, setState] = useState<WatchState>(EMPTY);

  const refresh = useCallback(async () => {
    if (!account || !pool || !DREAMCATCHER) {
      setState({ ...EMPTY, loading: false });
      return;
    }
    try {
      const [watch, granted, size] = await Promise.all([
        publicClient.readContract({
          address: DREAMCATCHER, abi: dreamcatcherAbi, functionName: "watches", args: [account, pool],
        }),
        publicClient.readContract({
          address: OPERATOR_REGISTRY, abi: operatorRegistryAbi, functionName: "isApprovedForPool",
          args: [pool, account, DREAMCATCHER, PLACE_ORDER_FOR],
        }),
        publicClient.readContract({
          address: MARGIN_BANK, abi: marginBankAbi, functionName: "getPosition", args: [account, pool],
        }),
      ]);

      const [limitPrice, reduceBps, lotSize, triggerStatus, attempts, cooldown, , cutsLeft, armed] = watch;

      // `quote` reverts on an unarmed watch in some paths; treat that as "nothing to say".
      let q: readonly [boolean, boolean, bigint, number, string] = [false, false, 0n, 0, "not armed"];
      try {
        q = await publicClient.readContract({
          address: DREAMCATCHER, abi: dreamcatcherAbi, functionName: "quote", args: [account, pool],
        });
      } catch { /* leave the default */ }

      setState({
        armed, limitPrice, reduceBps, lotSize, triggerStatus,
        cooldown, cutsLeft, attempts: Number(attempts), granted: granted as boolean,
        wouldCut: q[0], isBid: q[1], quantity: q[2], status: q[3], blockedBy: q[4],
        size: size[0],
        loading: false, error: null,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error)?.message ?? "Could not read the watch" }));
    }
  }, [account, pool]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5_000);
    return () => clearInterval(t);
  }, [refresh]);

  return { ...state, refresh };
}
