import { useEffect, useState } from "react";

const INDEXER = "https://hideki-dev.smk.somnia.host/v1/graphql";

/**
 *  The live perp markets, from dreamDEX's indexer.
 *
 *  `lotSize` and the decimals come from the market row rather than any
 *  assumption. That matters more here than it looks: baseDecimals across the
 *  venue range from 6 to 24 — nine markets are 18, but BTC is 8, XRP is 6 and
 *  NEAR is 24 — so anything that assumes 18 is wrong for most of the board.
 */
const QUERY = `query PerpMarkets {
  Market(where: { perpRegistered: { _eq: true } }, order_by: { cumulativeQuoteVolume: desc }) {
    baseSymbol quoteSymbol poolAddress stopRegistry
    baseDecimals quoteDecimals lotSize tickSize initialMarginBps
  }
}`;

export interface PerpMarket {
  symbol: string;
  quoteSymbol: string;
  pool: `0x${string}`;
  baseDecimals: number;
  quoteDecimals: number;
  lotSize: bigint;
  tickSize: bigint;
  initialMarginBps: number;
}

export function useMarkets() {
  const [markets, setMarkets] = useState<PerpMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(INDEXER, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: QUERY }),
          signal: AbortSignal.timeout(12_000),
        });
        const json = (await res.json()) as {
          data?: { Market?: Array<Record<string, string | number>> };
          errors?: Array<{ message: string }>;
        };
        if (!alive) return;
        if (json.errors?.length) throw new Error(json.errors[0].message);
        setMarkets(
          (json.data?.Market ?? []).map((m) => ({
            symbol: String(m.baseSymbol),
            quoteSymbol: String(m.quoteSymbol),
            pool: String(m.poolAddress) as `0x${string}`,
            baseDecimals: Number(m.baseDecimals),
            quoteDecimals: Number(m.quoteDecimals),
            lotSize: BigInt(String(m.lotSize)),
            tickSize: BigInt(String(m.tickSize)),
            initialMarginBps: Number(m.initialMarginBps),
          })),
        );
        setLoading(false);
      } catch (err) {
        if (!alive) return;
        setError((err as Error)?.message ?? "Could not read markets");
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return { markets, loading, error };
}
