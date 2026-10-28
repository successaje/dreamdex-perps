import { useEffect, useState } from "react";

const INDEXER = "https://hideki-dev.smk.somnia.host/v1/graphql";

/**
 *  Reductions on this account, from the indexer.
 *
 *  Not from logs: Somnia caps `eth_getLogs` at 1000 blocks, about 100 seconds,
 *  and a reduction worth showing is usually older than that. The indexer keeps
 *  the whole history, with the size either side of the change — which is the
 *  receipt, rather than a number we derive.
 */
const QUERY = `query Reductions($account: String!, $pool: String!) {
  PerpPositionChange(
    where: { account: { _eq: $account }, pool: { _eq: $pool }, kind: { _eq: "REDUCE" } }
    order_by: { timestamp: desc }
    limit: 10
  ) { id sizeBefore sizeAfter closedSize timestamp txHash }
}`;

export interface Reduction {
  id: string;
  sizeBefore: bigint;
  sizeAfter: bigint;
  closedSize: bigint;
  at: number;
  txHash: `0x${string}`;
}

export function useReductions(account: `0x${string}` | null, pool: `0x${string}` | null) {
  const [rows, setRows] = useState<Reduction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!account || !pool) { setRows([]); setLoading(false); return; }
    let alive = true;

    async function load() {
      try {
        const res = await fetch(INDEXER, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: QUERY,
            variables: { account: account!.toLowerCase(), pool: pool!.toLowerCase() },
          }),
          signal: AbortSignal.timeout(12_000),
        });
        const json = (await res.json()) as {
          data?: { PerpPositionChange?: Array<Record<string, string>> };
        };
        if (!alive) return;
        setRows(
          (json.data?.PerpPositionChange ?? []).map((r) => ({
            id: r.id,
            sizeBefore: BigInt(r.sizeBefore ?? "0"),
            sizeAfter: BigInt(r.sizeAfter ?? "0"),
            closedSize: BigInt(r.closedSize ?? "0"),
            at: Number(r.timestamp) * 1000,
            txHash: r.txHash as `0x${string}`,
          })),
        );
        setLoading(false);
      } catch {
        if (alive) setLoading(false);
      }
    }

    void load();
    const t = setInterval(load, 20_000);
    return () => { alive = false; clearInterval(t); };
  }, [account, pool]);

  return { reductions: rows, loading };
}
