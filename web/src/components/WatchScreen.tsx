import { useState } from "react";
import { Hoop, rungColour, rungName } from "./Hoop";
import { Ladder } from "./Ladder";
import { PermissionBox, Rules, fmtQty } from "./Rules";
import type { PerpMarket } from "../lib/useMarkets";
import type { WatchState } from "../lib/useWatch";
import { useReductions } from "../lib/useReductions";
import { DREAMCATCHER, OPERATOR_REGISTRY, hideki, publicClient, walletClient } from "../lib/chain";
import { dreamcatcherAbi, operatorRegistryAbi, PLACE_ORDER_FOR } from "../lib/abi";

/**
 *  The live watch.
 *
 *  Every figure is the contract's own. `quote` is asked what a cut would do
 *  rather than the arithmetic being reimplemented here, where the two could
 *  drift — the answer that matters is the one that will actually run.
 */
export function WatchScreen({
  account, market, watch, onChanged, readOnly,
}: {
  account: `0x${string}`;
  market: PerpMarket;
  watch: WatchState;
  onChanged: () => void;
  readOnly?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const { reductions } = useReductions(account, market.pool);
  const latest = reductions[0];

  const long = watch.size > 0n;
  const magnitude = watch.size < 0n ? -watch.size : watch.size;
  const spent = Math.max(0, watch.armedCuts - watch.cutsLeft);

  async function write(label: string, fn: () => Promise<`0x${string}`>) {
    setBusy(label);
    try {
      const hash = await fn();
      await publicClient.waitForTransactionReceipt({ hash });
      onChanged();
    } catch { /* user declined, or the chain refused */ } finally { setBusy(null); }
  }

  const runCheck = () => write("check", () =>
    walletClient(account).writeContract({
      address: DREAMCATCHER!, abi: dreamcatcherAbi, functionName: "cut",
      args: [account, market.pool], gas: 60_000_000n,
    }));

  const disarm = () => write("disarm", () =>
    walletClient(account).writeContract({
      address: DREAMCATCHER!, abi: dreamcatcherAbi, functionName: "disarm", args: [market.pool],
    }));

  const revoke = () => write("revoke", () =>
    walletClient(account).writeContract({
      address: OPERATOR_REGISTRY, abi: operatorRegistryAbi,
      functionName: "setOperatorApprovalForPool",
      args: [market.pool, DREAMCATCHER!, [PLACE_ORDER_FOR], false],
    }));

  return (
    <>
      {/* Never let an old reading pass as current - a dead RPC otherwise
          renders as a healthy account, which is the one lie this screen
          cannot afford. */}
      {watch.stale && (
        <div className="strip stale">
          <span className="strip-icon" aria-hidden="true">◴</span>
          <div className="strip-text">
            <b>Showing the last known reading</b>
            <span>
              {watch.asOf
                ? `Taken ${Math.round((Date.now() - watch.asOf) / 1000)}s ago. The chain has not answered since.`
                : "The chain has not answered."}
              {" "}Status, position and the quote below may all have moved.
            </span>
          </div>
          <button className="cta ghost" onClick={onChanged}>Retry</button>
        </div>
      )}

      <div className="market-bar">
        <span className="market-name">{market.symbol} / {market.quoteSymbol}</span>
        <span className={`side ${long ? "long" : "short"}`}>{magnitude === 0n ? "Flat" : long ? "Long" : "Short"}</span>
        <span className="bar-sep" />
        <span className="armed">
          <span className={`dot ${watch.armed ? "on" : ""}`} />
          {watch.armed ? "Watch armed" : "No watch"}
        </span>
      </div>

      <div className="deck">
        <div className="col">
          <section className="card">
            <header className="card-head">
              <h2>Account health</h2>
              <span className="pill" style={{ color: rungColour(watch.status), borderColor: rungColour(watch.status) }}>
                <span className="dot" style={{ background: rungColour(watch.status) }} />
                {rungName(watch.status)}
              </span>
              <span className="card-note">Trigger uses account margin status</span>
            </header>

            <div className="hoop-wrap">
              <Hoop
                status={watch.status}
                cutsMade={spent}
                cutsTotal={watch.armedCuts}
                centre={magnitude === 0n ? "flat" : fmtQty(magnitude, market.baseDecimals)}
                centreLabel={magnitude === 0n ? market.symbol : `${market.symbol} ${long ? "long" : "short"}`}
                dormant={!watch.armed}
              />
            </div>

            <Ladder status={watch.status} />

            <div className="stats">
              <div>
                <div className="label">Cuts remaining</div>
                <div className="v">{watch.cutsLeft} <span className="of">/ {watch.armedCuts}</span></div>
              </div>
              <div>
                <div className="label">Reduction size</div>
                <div className="v">{watch.reduceBps / 100}%</div>
              </div>
              <div>
                <div className="label">Sell limit</div>
                <div className="v">{fmtQty(watch.limitPrice, market.quoteDecimals)}</div>
              </div>
            </div>
          </section>
        </div>

        <div className="col">
          <section className="card">
            <header className="card-head"><h2>Watch rules</h2></header>
            <Rules watch={watch} market={market} />
            <PermissionBox granted={watch.granted} symbol={market.symbol} />

            {readOnly ? (
              <p className="sub readonly-note">
                Watching read-only. Connect the owning wallet to change anything.
              </p>
            ) : (
              <div className="actions">
                <button className="cta ghost danger" onClick={revoke}
                        disabled={!watch.granted || busy !== null}>
                  {busy === "revoke" ? "Check your wallet…" : "Revoke permission"}
                </button>
                <button className="cta ghost" onClick={disarm}
                        disabled={!watch.armed || busy !== null}>
                  {busy === "disarm" ? "Check your wallet…" : "Disarm watch"}
                </button>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Honest about what is actually driving execution. No subscription has
          been created, so nothing fires on its own — and saying otherwise would
          be the single most misleading thing this screen could do. */}
      <section className="strip">
        <span className="strip-icon" aria-hidden="true">⚠</span>
        <div className="strip-text">
          <b>Automatic execution off</b>
          <span>Reactive subscription inactive. Anyone can run a check.</span>
        </div>
        {!readOnly && (
          <button className="cta" onClick={runCheck} disabled={busy !== null}>
            {busy === "check" ? "Check your wallet…" : "▶  Run check"}
          </button>
        )}
      </section>

      <section className="card receipt">
        <header className="card-head"><h2>Latest reduction</h2></header>
        {!latest ? (
          <p className="empty">
            No reduction yet. While the account stays above the trigger, a check
            correctly does nothing.
          </p>
        ) : (
          <div className="receipt-body">
            <div>
              <div className="receipt-line">
                <span className="num big">{fmtQty(latest.sizeBefore, market.baseDecimals)}</span>
                <span className="arrow">→</span>
                <span className="num big">{fmtQty(latest.sizeAfter, market.baseDecimals)}</span>
                <span className="unit">{market.symbol}</span>
              </div>
              <div className="label" style={{ marginTop: 8 }}>Filled reduction</div>
              <div className="num" style={{ fontSize: 15 }}>
                {fmtQty(latest.closedSize, market.baseDecimals)} {market.symbol}
              </div>
            </div>
            <div className="receipt-meta">
              <div>{watch.attempts} attempt{watch.attempts === 1 ? "" : "s"} · {spent} filled cut{spent === 1 ? "" : "s"}</div>
              <div className="num">{new Date(latest.at).toLocaleString()}</div>
              <a className="cta ghost" target="_blank" rel="noreferrer"
                 href={`${hideki.blockExplorers.default.url}/tx/${latest.txHash}`}>
                View transaction ↗
              </a>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
