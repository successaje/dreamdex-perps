import { Hoop, rungColour, rungName } from "./components/Hoop";
import { useWallet } from "./lib/useWallet";
import { useVenue } from "./lib/useVenue";
import { DREAMCATCHER, hideki } from "./lib/chain";

export default function App() {
  const wallet = useWallet();
  const ready = Boolean(wallet.account) && wallet.onRightChain;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <Mark />
          <span>
            Dreamcatcher
            <small>somnia · dreamdex perps</small>
          </span>
        </div>
        <button className="chip" onClick={ready ? undefined : wallet.connect}>
          <span className={`dot ${ready ? "on" : ""}`} />
          {ready
            ? `${wallet.account!.slice(0, 6)}…${wallet.account!.slice(-4)}`
            : wallet.available
              ? wallet.connecting ? "Connecting…" : "Connect"
              : hideki.name}
        </button>
      </header>

      {ready ? <Watching account={wallet.account!} /> : <Landing />}

      <p className="foot">
        Liquidation takes your position at whatever the book offers, plus a penalty.
        Dreamcatcher takes a slice earlier, at a price you set, and stops there.
        It never holds your position or your collateral.
      </p>
    </main>
  );
}

/* ------------------------------------------------------------------ landing */

function Landing() {
  const venue = useVenue();

  // The headline is the last 24 hours, not a count since arrival. Liquidations
  // come in bursts: a venue doing several hundred a day can still go twenty
  // quiet minutes, and a counter sitting at zero argues against the product.
  const headline = venue.last24h;

  return (
    <div className="deck">
      <div className="col">
        <section className="card">
          <div className="label" style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span className={`dot ${venue.error ? "warn" : venue.loading ? "" : "bad"}`} />
            {venue.error ? "indexer unreachable" : `live on ${hideki.name}`}
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 14 }}>
            <span className="num" style={{ fontSize: 62, lineHeight: 0.9, color: "var(--heading)", letterSpacing: "-0.04em" }}>
              {venue.loading ? "—" : headline}
            </span>
            <span style={{ fontSize: 16, fontWeight: 600, color: "var(--muted)" }}>
              {headline === 1 ? "liquidation" : "liquidations"}
            </span>
          </div>
          <p className="num" style={{ fontSize: 12, color: "var(--subtle)", margin: "6px 0 0" }}>
            in the last 24 hours
            {venue.accounts > 0 && <> · {venue.accounts} accounts caught</>}
          </p>

          <p className="sub" style={{ marginTop: 14 }}>
            Every one of those was a position taken at whatever the book offered, plus a
            penalty. <strong style={{ color: "var(--heading)" }}>Dreamcatcher cuts a slice
            earlier, at a price you choose.</strong>
          </p>

          <WalletCta />
        </section>

        <section className="card">
          <h2>How it holds</h2>
          <ol className="sub" style={{ paddingLeft: 18, margin: "10px 0 0", lineHeight: 1.9 }}>
            <li>Grant one permission on one market — <code className="num">placeOrderFor</code>.</li>
            <li>Set the rung it wakes at, the slice it cuts, and your limit price.</li>
            <li>It cuts before the engine does. Revoke any time, instantly.</li>
          </ol>
        </section>
      </div>

      <div className="col">
        <section className="card">
          <div className="hoop-wrap">
            <Hoop status={0} cutsMade={0} cutsTotal={0} dormant centre="—" centreLabel="no watch" />
          </div>
          <div className="hoop-status">
            <div className="rung" style={{ color: "var(--subtle)" }}>Nothing watched</div>
            <div className="note">Connect a wallet to string the web.</div>
          </div>
        </section>

        <section className="card">
          <h2 style={{ marginBottom: 4 }}>Caught by the engine</h2>
          <p className="sub" style={{ marginBottom: 8 }}>Most recent, from the dreamDEX indexer.</p>
          {venue.recent.length === 0 ? (
            <p className="empty">{venue.loading ? "Reading the indexer…" : "Nothing indexed yet."}</p>
          ) : (
            <div className="feed">
              {venue.recent.map((e) => (
                <div className="ev" key={e.id}>
                  <time>{ago(e.at)}</time>
                  <span className={`tag ${e.kind === "AccountLiquidated" ? "bad" : "skip"}`}>
                    {e.kind.replace(/([A-Z])/g, " $1").trim().split(" ")[0]}
                  </span>
                  <span className="num" style={{ color: "var(--muted)" }}>
                    {e.account.slice(0, 6)}…{e.account.slice(-4)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function WalletCta() {
  const wallet = useWallet();
  if (!wallet.available) {
    return (
      <p className="sub" style={{ marginTop: 16, color: "var(--subtle)" }}>
        No wallet detected here. Open this in a browser with MetaMask and it will add{" "}
        {hideki.name} for you.
      </p>
    );
  }
  if (wallet.account && !wallet.onRightChain) {
    return <button className="cta" onClick={wallet.switchChain}>Switch to {hideki.name}</button>;
  }
  return (
    <button className="cta" onClick={wallet.connect} disabled={wallet.connecting}>
      {wallet.connecting ? "Check your wallet…" : "String a web"}
    </button>
  );
}

/* ----------------------------------------------------------------- watching */

function Watching({ account }: { account: `0x${string}` }) {
  if (!DREAMCATCHER) {
    return (
      <section className="card">
        <h2>Not deployed yet</h2>
        <p className="sub" style={{ marginTop: 8 }}>
          The contract is written and tested against the live perps contracts, but it is not
          deployed to {hideki.name} yet. Set <code className="num">VITE_DREAMCATCHER</code> and
          this screen becomes the watch.
        </p>
        <div className="hoop-wrap" style={{ marginTop: 12 }}>
          <Hoop status={0} cutsMade={0} cutsTotal={0} dormant centre="—" centreLabel="awaiting deploy" />
        </div>
        <p className="num" style={{ fontSize: 11, color: "var(--subtle)", textAlign: "center" }}>
          {account.slice(0, 10)}…{account.slice(-6)}
        </p>
      </section>
    );
  }
  return <Live />;
}

/** Placeholder until the deployed address exists; the hoop below is the shape
 *  the armed screen takes. */
function Live() {
  const status = 1;
  return (
    <div className="deck">
      <div className="col">
        <section className="card">
          <div className="hoop-wrap">
            <Hoop status={status} cutsMade={1} cutsTotal={4} centre="0.42" centreLabel="btc long" />
          </div>
          <div className="hoop-status">
            <div className="rung" style={{ color: rungColour(status) }}>{rungName(status)}</div>
            <div className="note">Three strands left. Cuts at 95,000.</div>
          </div>
        </section>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- bits */

function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="13" cy="12" r="9" fill="none" stroke="var(--accent)" strokeWidth="1.7" />
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const b = ((i + 2) / 6) * Math.PI * 2 - Math.PI / 2;
        return (
          <line key={i}
            x1={13 + 9 * Math.cos(a)} y1={12 + 9 * Math.sin(a)}
            x2={13 + 9 * Math.cos(b)} y2={12 + 9 * Math.sin(b)}
            stroke="var(--accent-text)" strokeOpacity="0.5" strokeWidth="0.8" />
        );
      })}
      <circle cx="13" cy="24" r="1.4" fill="var(--accent-text)" fillOpacity="0.8" />
    </svg>
  );
}

function ago(ms: number) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 172800) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
