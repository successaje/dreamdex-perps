import { formatUnits } from "viem";
import type { PerpMarket } from "../lib/useMarkets";
import { DREAMCATCHER, hideki } from "../lib/chain";
import { rungName } from "./Hoop";
import { fmtSeconds } from "./Rules";

export interface Draft {
  limitPrice: string;
  reducePct: number;
  trigger: number;
  cuts: number;
  cooldown: number;
}

/**
 *  What is actually being authorised, before a signature is requested.
 *
 *  The arm flow used to go straight from a form to `writeContract`. A user
 *  signing a permission over their own position should see the authority, the
 *  network, the contract and the limits first — and in particular should see
 *  what this CANNOT do, which is the part that makes the grant safe to give.
 */
export function Review({
  market, draft, granted, size, onBack, onConfirm, busy,
}: {
  market: PerpMarket;
  draft: Draft;
  granted: boolean;
  size: bigint;
  onBack: () => void;
  onConfirm: () => void;
  busy: string | null;
}) {
  const long = size > 0n;
  const magnitude = size < 0n ? -size : size;
  const sliceNow = (magnitude * BigInt(draft.reducePct)) / 100n;

  return (
    <section className="card">
      <header className="card-head">
        <h2>Review before signing</h2>
        <span className="card-note">Nothing is sent until you confirm</span>
      </header>

      <div className="rules">
        <div className="rule"><span className="rule-label">Network</span>
          <span className="rule-value">{hideki.name} · {hideki.id}</span></div>
        <div className="rule"><span className="rule-label">Contract</span>
          <span className="rule-value num">{DREAMCATCHER?.slice(0, 10)}…{DREAMCATCHER?.slice(-6)}</span></div>
        <div className="rule"><span className="rule-label">Market</span>
          <span className="rule-value">{market.symbol} / {market.quoteSymbol}</span></div>
        <div className="rule"><span className="rule-label">Wakes at</span>
          <span className="rule-value">{rungName(draft.trigger)}</span></div>
        <div className="rule"><span className="rule-label">Each cut</span>
          <span className="rule-value">{draft.reducePct}% of the position remaining then</span></div>
        <div className="rule"><span className="rule-label">Never worse than</span>
          <span className="rule-value num">{draft.limitPrice} {market.quoteSymbol}</span></div>
        <div className="rule"><span className="rule-label">At most</span>
          <span className="rule-value">{draft.cuts} cuts, {fmtSeconds(draft.cooldown)} apart</span></div>
      </div>

      {/* The concrete version of the policy, against the position as it stands
          right now. A percentage is abstract; this is not. */}
      {magnitude > 0n && (
        <p className="sub example">
          On today's position of{" "}
          <b className="num">{formatUnits(magnitude, market.baseDecimals)} {market.symbol}</b>{" "}
          {long ? "long" : "short"}, the first cut would{" "}
          <b>{long ? "sell" : "buy"} about{" "}
          <span className="num">{formatUnits(sliceNow, market.baseDecimals)}</span></b>{" "}
          — and each later cut takes {draft.reducePct}% of whatever is left, not of
          this starting size.
        </p>
      )}

      <div className="authority">
        <div className="authority-head">What you are granting</div>
        <ul>
          <li><b>One function on one market.</b> <code className="num">placeOrderFor</code> on {market.symbol},
            through dreamDEX's own operator registry.</li>
          <li><b>Reduce only, by construction.</b> Orders are immediate-or-cancel, sized against the
            live position and unwound if they would increase or flip it.</li>
          <li><b>It cannot</b> open a position, increase one, withdraw anything, or touch a market
            you did not grant.</li>
          <li><b>Revocable at any time</b>, and revoking stops it whatever the watch says.</li>
        </ul>
      </div>

      <div className="authority warn">
        <div className="authority-head">What this does not promise</div>
        <ul>
          <li>An immediate-or-cancel order <b>may not fill</b> if nothing crosses your limit. That
            costs an attempt and the cooldown, not a cut.</li>
          <li>A reduction <b>does not guarantee</b> you avoid liquidation.</li>
          <li>Automatic execution is <b>not running</b> — no reactive subscription exists, so a check
            happens when someone runs one.</li>
        </ul>
      </div>

      <div className="actions">
        <button className="cta" onClick={onConfirm} disabled={busy !== null}>
          {busy === "grant" ? "Granting — check your wallet…"
            : busy === "arm" ? "Arming — check your wallet…"
            : granted ? "Sign and arm the watch" : "Grant permission, then arm"}
        </button>
        <button className="cta ghost" onClick={onBack} disabled={busy !== null}>
          Back to rules
        </button>
      </div>

      <p className="sub" style={{ marginTop: 10, fontSize: 12 }}>
        {granted
          ? "Permission is already granted for this market, so this is one transaction."
          : "Two transactions: the permission first, then the watch."}
      </p>
    </section>
  );
}
