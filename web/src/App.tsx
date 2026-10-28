import { useState } from "react";
import { Hoop, rungName } from "./components/Hoop";
import { ArmForm } from "./components/ArmForm";
import { WatchScreen } from "./components/WatchScreen";
import { Activity } from "./components/Activity";
import { useMarkets } from "./lib/useMarkets";
import { useWatch } from "./lib/useWatch";
import { useWallet } from "./lib/useWallet";
import { useVenue } from "./lib/useVenue";
import { DREAMCATCHER, hideki } from "./lib/chain";

/**
 *  `?watch=0x…` opens somebody's watch read-only, with no wallet at all.
 *
 *  A live web is the interesting thing to show someone, and making them
 *  install a wallet before they can look at it is a bad trade — especially for
 *  anyone reviewing this who will not connect one to a stranger's app.
 */
type Tab = "watch" | "activity";

function tabParam(): Tab {
  return new URLSearchParams(window.location.search).get("tab") === "activity" ? "activity" : "watch";
}

/** Keeps every other parameter, so switching tabs never drops ?watch=. */
function tabHref(tab: Tab): string {
  const q = new URLSearchParams(window.location.search);
  if (tab === "watch") q.delete("tab"); else q.set("tab", tab);
  const s = q.toString();
  return s ? `?${s}` : "./";
}

function watchParam(): `0x${string}` | null {
  const v = new URLSearchParams(window.location.search).get("watch");
  return v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as `0x${string}`) : null;
}

export default function App() {
  const wallet = useWallet();
  const spectating = watchParam();
  const ready = Boolean(wallet.account) && wallet.onRightChain;
  const viewing = ready ? wallet.account! : spectating;
  const tab = tabParam();

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
        {viewing && (
          <nav className="tabs" aria-label="Sections">
            {(["watch", "activity"] as const).map((t) => (
              <a key={t} className={`tab${tab === t ? " on" : ""}`} href={tabHref(t)}
                 aria-current={tab === t ? "page" : undefined}>
                {t === "watch" ? "Watch" : "Activity"}
              </a>
            ))}
          </nav>
        )}
        <button className="chip" onClick={ready ? undefined : wallet.connect}>
          <span className={`dot ${ready ? "on" : ""}`} />
          {ready
            ? `${wallet.account!.slice(0, 6)}…${wallet.account!.slice(-4)}`
            : spectating
              ? `watching ${spectating.slice(0, 6)}…${spectating.slice(-4)}`
            : wallet.available
              ? wallet.connecting ? "Connecting…" : "Connect"
              : hideki.name}
        </button>
      </header>

      {viewing ? <Watching account={viewing} readOnly={!ready} tab={tab} /> : <Landing />}

      <p className="foot">
        Liquidation takes your position at whatever the book offers, plus a penalty.
        Dreamcatcher takes a slice earlier, at a price you set, and stops there.
        It never holds your position or your collateral.
      </p>
    </main>
  );
}

/* ------------------------------------------------------------------ landing */

/** The watch this README documents — a real armed position with a real cut.
 *  Linked from the landing so a reviewer can see the product working without
 *  installing a wallet, which is how most of them will arrive. */
const LIVE_WATCH = "0x60eF148485C2a5119fa52CA13c52E9fd98F28e87";

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
            <Hoop status={0} cutsMade={1} cutsTotal={4} dormant centre="0.00176" centreLabel="btc long" />
          </div>
          <div className="hoop-status">
            <div className="rung" style={{ color: "var(--subtle)" }}>A web, at rest</div>
            <div className="note">
              The ring is the position. The web tightens as margin degrades, and a cut
              leaves a strand severed — one is, here.
            </div>
            <a className="cta ghost" style={{ marginTop: 14 }} href={`?watch=${LIVE_WATCH}`}>
              Open the live one
            </a>
          </div>
        </section>

        <section className="card">
          <h2 style={{ marginBottom: 4 }}>Caught by the engine</h2>
          <p className="sub" style={{ marginBottom: 8 }}>Most recent, from the dreamDEX indexer.</p>
          {venue.recent.length === 0 ? (
            <p className="empty">{venue.loading ? "Reading the indexer…" : "Nothing indexed yet."}</p>
          ) : (
            <div className="feed">
              {/* Five, not eight: the feed is supporting evidence, and at eight
                  rows it made the right column twice the height of the left. */}
              {venue.recent.slice(0, 5).map((e) => (
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

  // There is ALWAYS something to click. Before this, a visitor without an
  // injected wallet got a sentence explaining they could not proceed and no
  // control at all — on the page most reviewers open first, on a phone.
  const watch = (
    <a className="cta ghost" href={`?watch=${LIVE_WATCH}`}>
      Watch a live position
    </a>
  );

  if (!wallet.available) {
    return (
      <div className="lp-cta">
        {watch}
        <p className="sub" style={{ fontSize: 12.5, marginTop: 2 }}>
          No wallet here — the watch above needs none. To arm your own, open this in a
          browser with MetaMask and it will add {hideki.name} for you.
        </p>
      </div>
    );
  }

  if (wallet.account && !wallet.onRightChain) {
    return (
      <div className="lp-cta">
        <button className="cta" onClick={wallet.switchChain}>Switch to {hideki.name}</button>
        {watch}
      </div>
    );
  }

  return (
    <div className="lp-cta">
      <button className="cta" onClick={wallet.connect} disabled={wallet.connecting}>
        {wallet.connecting ? "Check your wallet…" : "String a web"}
      </button>
      {watch}
    </div>
  );
}

/* ----------------------------------------------------------------- watching */

function Watching({ account, readOnly, tab }: { account: `0x${string}`; readOnly?: boolean; tab: "watch" | "activity" }) {
  const { markets, loading, error } = useMarkets();
  const [poolIdx, setPoolIdx] = useState(0);
  const market = markets[poolIdx] ?? null;
  const watch = useWatch(account, market?.pool ?? null);

  if (!DREAMCATCHER) {
    return (
      <section className="card">
        <h2>Not deployed yet</h2>
        <p className="sub" style={{ marginTop: 8 }}>
          The contract is written and tested against the live perps contracts, but it has no
          address on {hideki.name} yet. Set <code className="num">VITE_DREAMCATCHER</code> and
          this screen becomes the watch.
        </p>
        <div className="hoop-wrap" style={{ marginTop: 12 }}>
          <Hoop status={0} cutsMade={0} cutsTotal={0} dormant centre="—" centreLabel="awaiting deploy" />
        </div>
      </section>
    );
  }

  if (loading) return <section className="card"><p className="empty">Reading markets…</p></section>;
  if (error) return <section className="card"><p className="sub" style={{ color: "var(--sell)" }}>{error}</p></section>;
  if (!market) return <section className="card"><p className="empty">No perp markets found.</p></section>;

  return (
    <>
      <section className="card" style={{ paddingTop: 14, paddingBottom: 14 }}>
        <div className="field" style={{ marginTop: 0 }}>
          <span className="label">market</span>
          <select value={poolIdx} onChange={(e) => setPoolIdx(Number(e.target.value))}>
            {markets.map((m, i) => (
              <option key={m.pool} value={i}>{m.symbol} / {m.quoteSymbol}</option>
            ))}
          </select>
        </div>
      </section>

      {tab === "activity" ? (
        <Activity account={account} market={market} watch={watch} />
      ) : watch.armed ? (
        <WatchScreen
          account={account}
          market={market}
          watch={watch}
          onChanged={watch.refresh}
          readOnly={readOnly}
        />
      ) : (
        <div className="deck">
          <div className="col">
            {readOnly ? (
              <section className="card">
                <h2>No web over {market.symbol}</h2>
                <p className="sub" style={{ marginTop: 8 }}>
                  This address has not armed a watch on this market. Connect the owning
                  wallet to string one.
                </p>
              </section>
            ) : (
            <ArmForm
              account={account}
              market={market}
              granted={watch.granted}
              onDone={() => void watch.refresh()}
            />
            )}
          </div>
          <div className="col">
            <section className="card">
              <div className="hoop-wrap">
                <Hoop
                  status={watch.status}
                  cutsMade={0}
                  cutsTotal={0}
                  dormant
                  centre={watch.size === 0n ? "flat" : "open"}
                  centreLabel={market.symbol}
                />
              </div>
              <div className="hoop-status">
                <div className="rung" style={{ color: "var(--subtle)" }}>No web yet</div>
                <div className="note">
                  {watch.size === 0n
                    ? `No ${market.symbol} position to catch.`
                    : `Margin is ${rungName(watch.status)}.`}
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------- bits */

/** The hoop, small enough for a header: a ring and a few woven chords. */
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
