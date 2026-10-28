import { useEffect, useState } from "react";
import { decodeEventLog } from "viem";
import { DREAMCATCHER, publicClient } from "./chain";
import { dreamcatcherAbi } from "./abi";

export interface Check {
  id: string;
  kind: "Cut" | "CutNoFill" | "CutSkipped" | "CutFailed";
  detail: string;
  block: bigint;
  txHash: `0x${string}`;
}

/**
 *  Recent checks, from the contract's own events.
 *
 *  Deliberately shallow. Somnia caps `eth_getLogs` at 1000 blocks, which at
 *  100ms blocks is **under two minutes** of history — so this is a live tail,
 *  not an archive, and the UI has to say so rather than imply the list is
 *  everything that ever happened. Filled reductions are read from the indexer
 *  instead, which does keep the whole history.
 */
export function useChecks(account: `0x${string}` | null, pool: `0x${string}` | null) {
  const [checks, setChecks] = useState<Check[]>([]);
  const [span, setSpan] = useState(0);

  useEffect(() => {
    if (!account || !pool || !DREAMCATCHER) return;
    let alive = true;

    async function load() {
      try {
        const head = await publicClient.getBlockNumber();
        const from = head > 900n ? head - 900n : 0n;
        const logs = await publicClient.getLogs({ address: DREAMCATCHER!, fromBlock: from, toBlock: head });
        if (!alive) return;
        setSpan(Number(head - from));

        const out: Check[] = [];
        for (const l of logs) {
          try {
            const d = decodeEventLog({ abi: dreamcatcherAbi, data: l.data, topics: l.topics });
            const a = d.args as Record<string, unknown>;
            if (String(a.account).toLowerCase() !== account!.toLowerCase()) continue;
            if (String(a.pool).toLowerCase() !== pool!.toLowerCase()) continue;

            const name = d.eventName;
            if (name !== "Cut" && name !== "CutNoFill" && name !== "CutSkipped" && name !== "CutFailed") continue;

            out.push({
              id: `${l.transactionHash}-${l.logIndex}`,
              kind: name,
              detail:
                name === "Cut" ? `filled ${a.filled}`
                : name === "CutNoFill" ? "nothing crossed at the limit"
                : name === "CutSkipped" ? String(a.reason)
                : `failed ${String(a.selector)}`,
              block: l.blockNumber,
              txHash: l.transactionHash,
            });
          } catch { /* not one of ours */ }
        }
        setChecks(out.reverse());
      } catch { /* a dropped poll retries */ }
    }

    void load();
    const t = setInterval(load, 8_000);
    return () => { alive = false; clearInterval(t); };
  }, [account, pool]);

  return { checks, span };
}
