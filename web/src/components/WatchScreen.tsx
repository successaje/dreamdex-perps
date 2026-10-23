import { formatUnits } from "viem";
import { Hoop, rungColour, rungName } from "./Hoop";
import type { PerpMarket } from "../lib/useMarkets";
import type { WatchState } from "../lib/useWatch";
import { DREAMCATCHER, OPERATOR_REGISTRY, publicClient, walletClient } from "../lib/chain";
import { dreamcatcherAbi, operatorRegistryAbi, PLACE_ORDER_FOR } from "../lib/abi";
import { useState } from "react";

/**
 *  The live watch.
 *
 *  Every number here is the contract's own: `quote` is asked what a cut would
 *  do rather than the arithmetic being reimplemented in TypeScript, because the
 *  answer the user cares about is the one that will actually run.
 */
export function WatchScreen({
  account, market, watch, armedCuts, onChanged, readOnly,
}: {
  account: `0x${string}`;
  market: PerpMarket;
  watch: WatchState;
  armedCuts: number;
  onChanged: () => void;
  readOnly?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const long = watch.size > 0n;
  const magnitude = watch.size < 0n ? -watch.size : watch.size;
  const spent = Math.max(0, armedCuts - watch.cutsLeft);

  async function disarm() {
    if (!DREAMCATCHER) return;
    setBusy("disarm");
    try {
      const hash = await walletClient(account).writeContract({
        address: DREAMCATCHER, abi: dreamcatcherAbi, functionName: "disarm", args: [market.pool],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      onChanged();
    } catch { /* declined */ } finally { setBusy(null); }
  }

  async function revoke() {
    if (!DREAMCATCHER) return;
    setBusy("revoke");
    try {
      const hash = await walletClient(account).writeContract({
        address: OPERATOR_REGISTRY, abi: operatorRegistryAbi,
        functionName: "setOperatorApprovalForPool",
        args: [market.pool, DREAMCATCHER, [PLACE_ORDER_FOR], false],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      onChanged();
    } catch { /* declined */ } finally { setBusy(null); }
  }

  return (
    <div className="deck">
      <div className="col">
        <section className="card">
          <div className="hoop-wrap">
            <Hoop
              status={watch.status}
              cutsMade={spent}
              cutsTotal={armedCuts}
              centre={magnitude === 0n ? "flat" : trim(formatUnits(magnitude, market.baseDecimals))}
              centreLabel={magnitude === 0n ? market.symbol : `${market.symbol} ${long ? "long" : "short"}`}
              dormant={!watch.armed}
            />
          </div>
          <div className="hoop-status">
            <div className="rung" style={{ color: watch.armed ? rungColour(watch.status) : "var(--subtle)" }}>
              {watch.armed ? rungName(watch.status) : "Not armed"}
            </div>
            <div className="note">
              {!watch.armed
                ? "No web over this market."
                : watch.wouldCut
                  ? `Would cut ${trim(formatUnits(watch.quantity, market.baseDecimals))} ${market.symbol} now`
                  : reason(watch.blockedBy)}
            </div>
          </div>

          <div className="stats">
            <div>
              <div className="label">strands left</div>
              <div className="v">{watch.cutsLeft}<span style={{ color: "var(--subtle)", fontSize: 13 }}>/{armedCuts}</span></div>
            </div>
            <div>
              <div className="label">cuts at</div>
              <div className="v">{trim(formatUnits(watch.limitPrice, market.quoteDecimals))}</div>
            </div>
            <div>
              <div className="label">slice</div>
              <div className="v">{watch.reduceBps / 100}%</div>
            </div>
          </div>
        </section>
      </div>

      <div className="col">
        <section className="card">
          <h2>What holds it</h2>
          <ul className="sub" style={{ paddingLeft: 17, margin: "10px 0 0", lineHeight: 1.95 }}>
            <li>
              Permission:{" "}
              <strong style={{ color: watch.granted ? "var(--buy)" : "var(--sell)" }}>
                {watch.granted ? "granted" : "revoked"}
              </strong>{" "}
              on <code className="num">{market.symbol}</code>
            </li>
            <li>Wakes at <strong style={{ color: "var(--heading)" }}>{rungName(watch.triggerStatus)}</strong></li>
            <li>Waits <span className="num">{watch.cooldown}s</span> between cuts</li>
          </ul>

          <p className="sub" style={{ marginTop: 14, fontSize: 12.5 }}>
            Revoking the permission stops Dreamcatcher whatever the watch says. It is the
            stronger of the two switches, and it is dreamDEX's, not ours.
          </p>

          {readOnly ? (
            <p className="sub" style={{ marginTop: 14, color: "var(--subtle)" }}>
              Watching read-only. Connect the owning wallet to change anything.
            </p>
          ) : (
          <>
          <button className="cta ghost" onClick={revoke} disabled={!watch.granted || busy !== null}>
            {busy === "revoke" ? "Check your wallet…" : "Revoke permission"}
          </button>
          <button className="cta ghost" onClick={disarm} disabled={!watch.armed || busy !== null}
                  style={{ marginTop: 8 }}>
            {busy === "disarm" ? "Check your wallet…" : "Take down the web"}
          </button>
          </>
          )}
        </section>
      </div>
    </div>
  );
}

/** The contract's own words, in the user's. */
function reason(blockedBy: string) {
  switch (blockedBy) {
    case "": return "Watching.";
    case "above trigger": return "Healthy enough. Watching.";
    case "cooling down": return "Just cut. Cooling down.";
    case "no cuts left": return "Every strand spent.";
    case "flat": return "No position to catch.";
    case "below one lot": return "A cut would be under one lot.";
    case "operator grant missing": return "Permission revoked — nothing can be cut.";
    case "not armed": return "No web over this market.";
    default: return blockedBy;
  }
}

function trim(v: string) {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (n === 0) return "0";
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return String(Number(n.toPrecision(4)));
}
