import type { PerpMarket } from "../lib/useMarkets";
import type { WatchState } from "../lib/useWatch";
import { rungName } from "./Hoop";
import { formatUnits } from "viem";

/** The policy, as the contract holds it. Every row is a stored field. */
export function Rules({ watch, market }: { watch: WatchState; market: PerpMarket }) {
  const rows: Array<[string, string, string]> = [
    ["Trigger", "⌁", rungName(watch.triggerStatus)],
    ["Cut", "◷", `${watch.reduceBps / 100}% of remaining position`],
    ["Cooldown", "◴", fmtSeconds(watch.cooldown)],
    ["Maximum cuts", "≡", String(watch.armedCuts)],
    ["Execution", "⚡", "Immediate-or-cancel"],
  ];
  void market;

  return (
    <div className="rules">
      {rows.map(([label, glyph, value]) => (
        <div className="rule" key={label}>
          <span className="rule-label">{label}</span>
          <span className="rule-value">
            <span className="rule-glyph" aria-hidden="true">{glyph}</span>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PermissionBox({ granted, symbol }: { granted: boolean; symbol: string }) {
  return (
    <div className={`permission${granted ? "" : " off"}`}>
      <span className="permission-icon" aria-hidden="true">⛉</span>
      <div>
        <div className="permission-head">
          {granted ? "Permission enabled" : "Permission revoked"} · {symbol} only
        </div>
        <div className="permission-sub">
          {granted
            ? "Can reduce only. Cannot withdraw."
            : "Nothing can be cut until it is granted again."}
        </div>
      </div>
    </div>
  );
}

export const fmtSeconds = (s: number) =>
  s < 60 ? `${s} sec` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} hr`;

export const fmtQty = (v: bigint, decimals: number) => {
  const n = Number(formatUnits(v, decimals));
  if (n === 0) return "0";
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return String(Number(n.toPrecision(5)));
};
