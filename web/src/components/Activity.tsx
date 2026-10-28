import { fmtQty } from "./Rules";
import type { PerpMarket } from "../lib/useMarkets";
import type { WatchState } from "../lib/useWatch";
import { useReductions } from "../lib/useReductions";
import { useChecks } from "../lib/useChecks";
import { hideki } from "../lib/chain";

/**
 *  Everything this watch has done, and declined to do.
 *
 *  Two sources on purpose, because they have different reach: reductions come
 *  from the indexer and go back as far as the account does; checks come from
 *  contract logs, which Somnia caps at 1000 blocks — under two minutes. The
 *  page says which is which rather than presenting one list and implying it is
 *  complete.
 */
export function Activity({
  account, market, watch,
}: {
  account: `0x${string}`;
  market: PerpMarket;
  watch: WatchState;
}) {
  const { reductions, loading } = useReductions(account, market.pool);
  const { checks, span } = useChecks(account, market.pool);
  const spent = Math.max(0, watch.armedCuts - watch.cutsLeft);

  return (
    <>
      <div className="stats" style={{ marginTop: 0 }}>
        <div>
          <div className="label">Filled cuts</div>
          <div className="v">{spent}</div>
        </div>
        <div>
          <div className="label">Attempts</div>
          <div className="v">{watch.attempts}</div>
        </div>
        <div>
          <div className="label">Cuts remaining</div>
          <div className="v">{watch.cutsLeft} <span className="of">/ {watch.armedCuts}</span></div>
        </div>
      </div>

      <section className="card">
        <header className="card-head">
          <h2>Reductions</h2>
          <span className="card-note">Full history, from the dreamDEX indexer</span>
        </header>

        {loading ? (
          <p className="empty">Reading the indexer…</p>
        ) : reductions.length === 0 ? (
          <p className="empty">
            Nothing reduced yet. While the account stays above the trigger, a check
            correctly does nothing.
          </p>
        ) : (
          <div className="rows">
            {reductions.map((r) => (
              <div className="row-item" key={r.id}>
                <div>
                  <div className="receipt-line">
                    <span className="num">{fmtQty(r.sizeBefore, market.baseDecimals)}</span>
                    <span className="arrow">→</span>
                    <span className="num">{fmtQty(r.sizeAfter, market.baseDecimals)}</span>
                    <span className="unit">{market.symbol}</span>
                  </div>
                  <div className="row-sub">
                    reduced <b>{fmtQty(r.closedSize, market.baseDecimals)}</b> · {new Date(r.at).toLocaleString()}
                  </div>
                </div>
                <a className="cta ghost" target="_blank" rel="noreferrer"
                   href={`${hideki.blockExplorers.default.url}/tx/${r.txHash}`}>
                  View ↗
                </a>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <header className="card-head">
          <h2>Recent checks</h2>
          <span className="card-note">
            Contract logs, last {span.toLocaleString()} blocks — about{" "}
            {Math.round(span / 10)} seconds
          </span>
        </header>

        <p className="sub" style={{ marginBottom: 10, fontSize: 12.5 }}>
          A check that declines to act is evidence too. Somnia caps log queries at
          1000 blocks, so this is a live tail rather than an archive — older checks
          are gone from here even though their reductions remain above.
        </p>

        {checks.length === 0 ? (
          <p className="empty">No checks in the window.</p>
        ) : (
          <div className="rows">
            {checks.map((c) => (
              <div className="row-item" key={c.id}>
                <div>
                  <span className={`tag ${c.kind === "Cut" ? "cut" : c.kind === "CutFailed" ? "bad" : "skip"}`}>
                    {c.kind === "Cut" ? "REDUCED" : c.kind === "CutNoFill" ? "NO FILL"
                      : c.kind === "CutFailed" ? "FAILED" : "SKIPPED"}
                  </span>
                  <span className="row-sub" style={{ marginLeft: 10 }}>{c.detail}</span>
                </div>
                <a className="cta ghost" target="_blank" rel="noreferrer"
                   href={`${hideki.blockExplorers.default.url}/tx/${c.txHash}`}>
                  View ↗
                </a>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
