import { useEffect, useState } from "react";

const INDEXER = "https://hideki-dev.smk.somnia.host/v1/graphql";

/**
 *  How many liquidations a day this hook is willing to count.
 *
 *  It has to guess, because the indexer cannot count. Hasura aggregates are
 *  enabled on exactly one table — `Market_aggregate` works, every other
 *  `X_aggregate` fails validation — so there is no `count` to ask for and the
 *  only way to a total is to fetch the rows and measure the array. Filed as
 *  `feedback/011`.
 *
 *  So this is a ceiling, and a ceiling reached is reported as a ceiling rather
 *  than as a measurement. 1,330 came back in a 24h window on 2026-10-29, so
 *  5,000 is a little under 4x headroom. If the venue ever outruns it the
 *  headline says `5,000+` instead of quietly printing the limit, which is the
 *  bug this constant replaced: the query asked for 1,000, there were 1,330, and
 *  the screen showed `1000` in 62px type with nothing to suggest it was really
 *  the bound of a query.
 */
const WINDOW = 5_000;

/** Liquidations shown in the recent list. The rest are only ever counted. */
const RECENT = 8;

/**
 *  Liquidations on dreamDEX perps, straight from the indexer.
 *
 *  Raw `eth_getLogs` is the wrong source because liquidations are BURSTY: an
 *  eighteen-minute window returned nothing on a venue doing over a thousand a
 *  day, and a headline sitting at zero argues against the product. The indexer
 *  carries the whole history, so the number is both true and alive.
 *
 *  A direct GraphQL query rather than the SDK is a size choice, not a
 *  correctness one. The SDK resolves this call in a browser in about 1.5s —
 *  measured, after an earlier read of mine blamed it for a hang that turned out
 *  to be a StrictMode deadlock in this very hook. One query needs one fetch.
 */
// Two root fields in one request, because they want different things and asking
// for one shape costs ten times what it needs to.
//
// `counted` is the total and the distinct-account set, so it needs `account`
// and nothing else — at ~56 bytes a row that is ~280KB at the ceiling, against
// ~940KB if it carried the other three fields it would then discard. It is also
// deliberately unordered: nothing reads the sequence, and sorting 5,000 rows to
// take their length is work with no reader.
//
// `recent` is the only part that renders per-row, and it is eight of them.
//
// `timestamp` is a Hasura `numeric` column, not a string. Declaring $cut as
// String! is accepted by the parser and rejected at validation, which reads
// as "indexer unreachable" rather than as a type error.
const QUERY = `query Liquidations($cut: numeric!, $window: Int!, $recent: Int!) {
  counted: LiquidationEvent(
    where: { timestamp: { _gt: $cut } }
    limit: $window
  ) { account }
  recent: LiquidationEvent(
    where: { timestamp: { _gt: $cut } }
    order_by: { timestamp: desc }
    limit: $recent
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
  /**
   *  The query hit {@link WINDOW}, so `last24h` and `accounts` are floors and
   *  not counts. Render them with a `+`; they are the most misleading when they
   *  look most exact.
   */
  truncated: boolean;
  loading: boolean;
  error: string | null;
}

export function useVenue(): Venue {
  const [state, setState] = useState<Venue>({
    last24h: 0, accounts: 0, recent: [], truncated: false, loading: true, error: null,
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
     *  A thirty-second interval against a twelve-second timeout cannot
     *  meaningfully overlap, so the guard bought nothing and cost everything.
     */
    async function load() {
      try {
        const cut = Math.floor(Date.now() / 1000) - 86_400;
        const res = await fetch(INDEXER, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: QUERY, variables: { cut, window: WINDOW, recent: RECENT } }),
          signal: AbortSignal.timeout(12_000),
        });
        const json = (await res.json()) as {
          data?: {
            counted?: Array<{ account: string }>;
            recent?: Array<{ id: string; account: string; kind: string; timestamp: string }>;
          };
          errors?: Array<{ message: string }>;
        };
        if (!alive) return;
        if (json.errors?.length) throw new Error(json.errors[0].message);

        const counted = json.data?.counted ?? [];
        const recent = json.data?.recent ?? [];
        setState({
          last24h: counted.length,
          accounts: new Set(counted.map((r) => r.account)).size,
          recent: recent.map((r) => ({
            id: r.id,
            account: r.account,
            kind: r.kind,
            at: Number(r.timestamp) * 1000,
          })),
          truncated: counted.length >= WINDOW,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (!alive) return;
        setState((s) => ({ ...s, loading: false, error: (err as Error)?.message ?? "Indexer unreachable" }));
      }
    }

    void load();
    // A 24-hour count does not need four-second freshness, and at ~280KB a poll
    // the old twenty seconds spent 840KB a minute to move a number that moves
    // about once a minute anyway.
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return state;
}
