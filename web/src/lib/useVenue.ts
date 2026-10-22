import { useEffect, useState } from "react";

const INDEXER = "https://hideki-dev.smk.somnia.host/v1/graphql";

/**
 *  Liquidations on dreamDEX perps, straight from the indexer.
 *
 *  Two measurements shaped this. Raw `eth_getLogs` is the wrong source because
 *  liquidations are BURSTY: an eighteen-minute window returned nothing on a
 *  venue doing several hundred a day, and a headline sitting at zero argues
 *  against the product. And the markets SDK, which the scripts in this repo use
 *  happily under Node, never resolves this call in the browser — so the web app
 *  queries the same indexer directly rather than shipping a spinner that never
 *  stops.
 */
// `timestamp` is a Hasura `numeric` column, not a string. Declaring $cut as
// String! is accepted by the parser and rejected at validation, which reads
// as "indexer unreachable" rather than as a type error.
const QUERY = `query Liquidations($cut: numeric!) {
  LiquidationEvent(
    where: { timestamp: { _gt: $cut } }
    order_by: { timestamp: desc }
    limit: 1000
  ) { id account kind timestamp }
}`;

export interface Liquidation {
  id: string;
  account: string;
  kind: string;
  at: number;
}

export interface Venue {
  last24h: number;
  accounts: number;
  recent: Liquidation[];
  loading: boolean;
  error: string | null;
}

export function useVenue(): Venue {
  const [state, setState] = useState<Venue>({
    last24h: 0, accounts: 0, recent: [], loading: true, error: null,
  });
  useEffect(() => {
    let alive = true;

    /**
     *  Deliberately NOT guarded by an in-flight ref.
     *
     *  React's StrictMode mounts, unmounts and remounts in development. With a
     *  shared guard the first mount takes it, the remount bails out, and then
     *  the first request resolves into a closure whose `alive` is already
     *  false — so nothing ever calls setState and the screen loads forever.
     *  A twenty-second interval against a twelve-second timeout cannot
     *  meaningfully overlap, so the guard bought nothing and cost everything.
     */
    async function load() {
      try {
        const cut = Math.floor(Date.now() / 1000) - 86_400;
        const res = await fetch(INDEXER, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: QUERY, variables: { cut } }),
          signal: AbortSignal.timeout(12_000),
        });
        const json = (await res.json()) as {
          data?: { LiquidationEvent?: Array<{ id: string; account: string; kind: string; timestamp: string }> };
          errors?: Array<{ message: string }>;
        };
        if (!alive) return;
        if (json.errors?.length) throw new Error(json.errors[0].message);

        const rows = json.data?.LiquidationEvent ?? [];
        setState({
          last24h: rows.length,
          accounts: new Set(rows.map((r) => r.account)).size,
          recent: rows.slice(0, 8).map((r) => ({
            id: r.id,
            account: r.account,
            kind: r.kind,
            at: Number(r.timestamp) * 1000,
          })),
          loading: false,
          error: null,
        });
      } catch (err) {
        if (!alive) return;
        setState((s) => ({ ...s, loading: false, error: (err as Error)?.message ?? "Indexer unreachable" }));
      }
    }

    void load();
    const t = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return state;
}
