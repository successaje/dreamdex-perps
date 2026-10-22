import { useState } from "react";
import { formatUnits, parseUnits } from "viem";
import type { PerpMarket } from "../lib/useMarkets";
import { DREAMCATCHER, OPERATOR_REGISTRY, walletClient, publicClient } from "../lib/chain";
import { dreamcatcherAbi, operatorRegistryAbi, PLACE_ORDER_FOR } from "../lib/abi";

/**
 *  Stringing a web is two transactions and the form says so.
 *
 *  The grant is the one that matters: it is dreamDEX's own permission, scoped
 *  to one pool and one selector, and revoking it disables Dreamcatcher whatever
 *  this contract's storage says. Hiding that behind a single button would be
 *  the wrong kind of convenient.
 */
export function ArmForm({
  account, market, granted, onDone,
}: {
  account: `0x${string}`;
  market: PerpMarket;
  granted: boolean;
  onDone: () => void;
}) {
  const [limit, setLimit] = useState("");
  const [reducePct, setReducePct] = useState(25);
  const [trigger, setTrigger] = useState(1);
  const [cuts, setCuts] = useState(4);
  const [cooldown, setCooldown] = useState(300);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const limitOk = limit.trim() !== "" && Number(limit) > 0;

  async function grant() {
    if (!DREAMCATCHER) return;
    setBusy("Granting…"); setError(null);
    try {
      const hash = await walletClient(account).writeContract({
        address: OPERATOR_REGISTRY, abi: operatorRegistryAbi,
        functionName: "setOperatorApprovalForPool",
        args: [market.pool, DREAMCATCHER, [PLACE_ORDER_FOR], true],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      onDone();
    } catch (err) {
      const code = (err as { code?: number })?.code;
      if (code !== 4001) setError(short(err));
    } finally { setBusy(null); }
  }

  async function arm() {
    if (!DREAMCATCHER) return;
    setBusy("Arming…"); setError(null);
    try {
      const hash = await walletClient(account).writeContract({
        address: DREAMCATCHER, abi: dreamcatcherAbi, functionName: "arm",
        args: [
          market.pool,
          parseUnits(limit, market.quoteDecimals),
          reducePct * 100,
          market.lotSize,
          trigger,
          0, // orderType: the venue's default; the contract passes it through
          cooldown,
          cuts,
        ],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      onDone();
    } catch (err) {
      const code = (err as { code?: number })?.code;
      if (code !== 4001) setError(short(err));
    } finally { setBusy(null); }
  }

  return (
    <section className="card">
      <h2>String a web over {market.symbol}</h2>
      <p className="sub" style={{ marginTop: 6 }}>
        Two transactions. The first is dreamDEX's own permission, scoped to this one
        market and one function. It is also the off switch.
      </p>

      <div className="field">
        <span className="label">1 · permission</span>
        <button className="cta ghost" onClick={grant} disabled={granted || busy !== null}>
          {granted ? "Granted ✓" : busy === "Granting…" ? "Check your wallet…" : `Grant placeOrderFor on ${market.symbol}`}
        </button>
      </div>

      <div className="field">
        <span className="label">2 · limit price — the worst price a cut may take</span>
        <input
          inputMode="decimal" placeholder={`e.g. 95000 ${market.quoteSymbol}`}
          value={limit} onChange={(e) => setLimit(e.target.value)}
        />
      </div>

      <div className="row">
        <div className="field">
          <span className="label">wake at</span>
          <select value={trigger} onChange={(e) => setTrigger(Number(e.target.value))}>
            <option value={1}>Margin call</option>
            <option value={2}>Partial liquidation</option>
            <option value={3}>Close out</option>
          </select>
        </div>
        <div className="field">
          <span className="label">cut each time</span>
          <select value={reducePct} onChange={(e) => setReducePct(Number(e.target.value))}>
            {[10, 25, 33, 50, 100].map((p) => <option key={p} value={p}>{p}%</option>)}
          </select>
        </div>
      </div>

      <div className="row">
        <div className="field">
          <span className="label">strands (max cuts)</span>
          <select value={cuts} onChange={(e) => setCuts(Number(e.target.value))}>
            {[1, 2, 4, 6, 8].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="label">cooldown</span>
          <select value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))}>
            <option value={60}>1 min</option>
            <option value={300}>5 min</option>
            <option value={900}>15 min</option>
          </select>
        </div>
      </div>

      <p className="sub" style={{ marginTop: 12, fontSize: 12.5 }}>
        Lot size for {market.symbol} is{" "}
        <span className="num">{formatUnits(market.lotSize, market.baseDecimals)}</span>{" "}
        — a cut rounds down onto it, and below one lot it does nothing.
      </p>

      {error && <p className="sub" style={{ color: "var(--sell)", marginTop: 10 }}>{error}</p>}

      <button className="cta" onClick={arm} disabled={!granted || !limitOk || busy !== null}>
        {busy === "Arming…" ? "Check your wallet…" : !granted ? "Grant permission first" : "String the web"}
      </button>
    </section>
  );
}

const short = (err: unknown) =>
  ((err as { shortMessage?: string })?.shortMessage ?? (err as Error)?.message ?? "Transaction failed").split("\n")[0];
