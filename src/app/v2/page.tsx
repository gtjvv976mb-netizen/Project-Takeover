"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Guilloche } from "@/components/Guilloche";
import { Logo } from "@/components/Logo";
import { SlotHeight } from "@/components/SlotHeight";
import { formatSol, shortKey, type Listing } from "@/lib/types";

/**
 * A second skin for the market, proposed against the complaint that the first one looked
 * like every other site.
 *
 * The old one wore the standard template: centred hero, pill badges over the headline,
 * gradient on the second line, rounded cards with soft shadows, pastel mesh artwork. All
 * of that is decoration that would sit equally well on a project-management tool.
 *
 * This one is built on what the product actually is — a registry of title. Auction lots,
 * hard rules instead of shadows, monospace for anything the chain can prove, an engraved
 * rosette per asset, and a rubber stamp for status. Nothing here is ornament: the lot
 * number, the seal and the stamp all carry information.
 */

const TINT: Record<string, string> = {
  token_authority: "var(--color-violet)",
  pump_creator: "var(--color-tangerine)",
  offchain: "var(--color-teal)",
};
const KIND: Record<string, string> = {
  token_authority: "TOKEN CONTROLS",
  pump_creator: "PUMP.FUN COIN",
  offchain: "WHOLE PROJECT",
};
const CONVEYS: Record<string, string> = {
  mint: "MINT",
  freeze: "FREEZE",
  metadata_update: "METADATA",
};

export default function V2() {
  const [rows, setRows] = useState<Listing[] | null>(null);
  useEffect(() => {
    let dead = false;
    fetch("/api/listings")
      .then((r) => r.json())
      .then((d) => { if (!dead) setRows(d); })
      .catch(() => { if (!dead) setRows([]); });
    return () => { dead = true; };
  }, []);

  return (
    <div className="v2">
      <Masthead count={rows?.length ?? 0} />
      <Catalogue rows={rows} />
      <style>{CSS}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ masthead */

function Masthead({ count }: { count: number }) {
  return (
    <header className="v2-mast">
      <div className="v2-wrap">
        <div className="v2-rule-top" />
        <div className="v2-mast-grid">
          <div>
            <div className="v2-kicker">
              Registry of title &nbsp;·&nbsp; Solana devnet &nbsp;·&nbsp; est. 2026
            </div>
            <h1 className="v2-display">
              Think you&rsquo;d<br />run it better?
              <span className="v2-answer">Buy it.</span>
            </h1>
            <p className="v2-lede">
              Independent developers put up what they built — a memecoin&rsquo;s controls, a pump.fun
              coin, a whole site — and hand it over through a program on Solana. Not a trade. A
              change of owner, recorded on chain.
            </p>
            <div className="v2-actions">
              <a href="#catalogue" className="v2-btn v2-btn-solid">View the catalogue</a>
              <Link href="/sell" className="v2-btn">Built something? Sell it →</Link>
            </div>
          </div>

          <aside className="v2-plate">
            <Logo size={44} fill={0.44} />
            <dl>
              <div><dt>Lots open</dt><dd>{String(count).padStart(3, "0")}</dd></div>
              <div><dt>Fee</dt><dd>5.00%</dd></div>
              <div><dt>Custody</dt><dd>NONE</dd></div>
              <div><dt>Slot</dt><dd><SlotHeight /></dd></div>
            </dl>
            <p className="v2-plate-note">
              The escrow program holds every asset in this catalogue. No person, this site
              included, can move them.
            </p>
          </aside>
        </div>
      </div>
    </header>
  );
}

/* ----------------------------------------------------------------- catalogue */

function Catalogue({ rows }: { rows: Listing[] | null }) {
  return (
    <section id="catalogue" className="v2-wrap">
      <div className="v2-sec-head">
        <h2>The catalogue</h2>
        <span className="v2-kicker">{rows ? `${rows.length} lots` : "loading"}</span>
      </div>

      {rows === null && <p className="v2-empty">Reading the chain…</p>}
      {rows?.length === 0 && <p className="v2-empty">No lots open. Be the first to put one up.</p>}

      <ol className="v2-lots">
        {rows?.map((l, i) => <Lot key={l.id} l={l} n={i + 1} />)}
      </ol>
    </section>
  );
}

function Lot({ l, n }: { l: Listing; n: number }) {
  const tint = TINT[l.type] ?? "var(--color-brand)";
  const conveys =
    l.type === "token_authority"
      ? ((l.asset as { authorities?: string[] }).authorities ?? []).map((a) => CONVEYS[a] ?? a)
      : l.type === "pump_creator"
        ? ["CREATOR ROLE", "CREATOR FEES"]
        : ["REPO", "DOMAIN", "ACCOUNTS"];

  return (
    <li className="v2-lot" style={{ ["--tint" as string]: tint }}>
      <Link href={`/listings/${l.id}`} className="v2-lot-link">
        <div className="v2-seal">
          <Guilloche seed={l.mint ?? l.id} tint={tint} />
          <span className="v2-lot-no">LOT {String(n).padStart(3, "0")}</span>
        </div>

        <div className="v2-lot-body">
          <div className="v2-lot-kind">{KIND[l.type]}</div>
          <h3 className="v2-lot-title">{l.title}</h3>
          <p className="v2-lot-desc">{l.description || "No description provided."}</p>

          <dl className="v2-conveys">
            <dt>Conveys</dt>
            <dd>{conveys.map((c) => <span key={c} className="v2-chip">{c}</span>)}</dd>
          </dl>

          <div className="v2-lot-foot">
            <span className="v2-mono v2-dim">
              {l.mint ? `mint ${shortKey(l.mint)}` : `seller ${shortKey(l.seller)}`}
            </span>
          </div>
        </div>

        <div className="v2-lot-price">
          <span className="v2-stamp" data-status={l.status}>{l.status === "active" ? "OPEN" : l.status.toUpperCase()}</span>
          <div className="v2-amount">{formatSol(l.priceLamports)}<em>SOL</em></div>
          <span className="v2-take">Take it over →</span>
        </div>
      </Link>
    </li>
  );
}

/* --------------------------------------------------------------------- style */

const CSS = `
.v2 { --edge: var(--color-line-2); }
.v2-wrap { max-width: 1180px; margin-inline: auto; padding-inline: 24px; }

/* ---- masthead: left-aligned and asymmetric, against the centred template ---- */
.v2-rule-top { height: 3px; background: var(--color-ink); margin-bottom: 0; }
.v2-mast { padding-block: 0 72px; }
.v2-mast-grid { display: grid; gap: 48px; padding-top: 44px; }
@media (min-width: 900px) { .v2-mast-grid { grid-template-columns: 1.55fr .95fr; gap: 64px; } }

.v2-kicker {
  font: 500 11px/1 var(--font-mono); letter-spacing: .18em; text-transform: uppercase;
  color: var(--color-muted);
}
.v2-display {
  font: 800 clamp(46px, 7.4vw, 92px)/0.94 var(--font-display);
  letter-spacing: -.045em; color: var(--color-ink); margin-top: 20px; text-wrap: balance;
}
/* The answer is set apart rather than gradient-filled — a stamped verdict, not a highlight. */
.v2-answer {
  display: block; margin-top: 14px; padding-top: 14px;
  border-top: 3px solid var(--color-ink);
  width: max-content; max-width: 100%;
  color: var(--color-brand);
}
.v2-lede {
  margin-top: 26px; max-width: 54ch; font-size: 17px; line-height: 1.62; color: var(--color-body);
}
.v2-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
.v2-btn {
  display: inline-flex; align-items: center; border: 1.5px solid var(--color-ink);
  padding: 13px 22px; font: 600 13px/1 var(--font-mono); letter-spacing: .1em;
  text-transform: uppercase; color: var(--color-ink);
  transition: background-color 140ms, color 140ms;
}
.v2-btn:hover { background: var(--color-ink); color: var(--color-bg); }
.v2-btn-solid { background: var(--color-ink); color: var(--color-bg); }
.v2-btn-solid:hover { background: var(--color-brand); border-color: var(--color-brand); color: #fff; }

/* ---- the plate: a specification block, the way a catalogue prints its terms ---- */
.v2-plate { border: 1.5px solid var(--edge); padding: 22px; align-self: start; }
.v2-plate dl { margin-top: 18px; border-top: 1px solid var(--edge); }
.v2-plate dl > div {
  display: flex; justify-content: space-between; align-items: baseline; gap: 16px;
  padding: 9px 0; border-bottom: 1px solid var(--edge);
}
.v2-plate dt { font: 500 11px/1 var(--font-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--color-muted); }
.v2-plate dd { font: 700 15px/1 var(--font-mono); color: var(--color-ink); font-variant-numeric: tabular-nums; }
.v2-plate-note { margin-top: 16px; font-size: 12.5px; line-height: 1.55; color: var(--color-muted); }

/* ---- catalogue ---- */
.v2-sec-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 20px;
  border-bottom: 3px solid var(--color-ink); padding-bottom: 12px;
}
.v2-sec-head h2 { font: 800 clamp(26px,3vw,38px)/1 var(--font-display); letter-spacing: -.03em; color: var(--color-ink); }
.v2-empty { padding: 48px 0; color: var(--color-muted); font-family: var(--font-mono); font-size: 13px; }

.v2-lots { list-style: none; margin: 0; padding: 0 0 90px; }
.v2-lot { border-bottom: 1px solid var(--edge); }
.v2-lot-link {
  display: grid; gap: 22px; padding: 26px 0; align-items: start;
  grid-template-columns: 1fr; transition: background-color 160ms;
}
@media (min-width: 820px) { .v2-lot-link { grid-template-columns: 128px 1fr 190px; gap: 30px; } }
.v2-lot-link:hover { background: var(--color-bg-2); }

.v2-seal { position: relative; width: 128px; }
.v2-seal svg { display: block; width: 100%; height: auto; }
.v2-lot-no {
  position: absolute; inset-inline: 0; bottom: 6px; text-align: center;
  font: 600 10px/1 var(--font-mono); letter-spacing: .16em; color: var(--color-muted);
}

.v2-lot-kind { font: 600 10.5px/1 var(--font-mono); letter-spacing: .17em; color: var(--tint); }
.v2-lot-title { margin-top: 9px; font: 700 clamp(21px,2.4vw,27px)/1.12 var(--font-display); letter-spacing: -.025em; color: var(--color-ink); }
.v2-lot-desc {
  margin-top: 8px; max-width: 62ch; font-size: 14.5px; line-height: 1.58; color: var(--color-muted);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.v2-conveys { display: flex; align-items: center; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
.v2-conveys dt { font: 500 10px/1 var(--font-mono); letter-spacing: .15em; text-transform: uppercase; color: var(--color-faint); }
.v2-conveys dd { display: flex; gap: 6px; flex-wrap: wrap; margin: 0; }
.v2-chip {
  border: 1px solid color-mix(in srgb, var(--tint) 42%, transparent);
  color: color-mix(in srgb, var(--tint) 68%, var(--color-ink));
  padding: 3px 8px; font: 600 10.5px/1.35 var(--font-mono); letter-spacing: .08em;
}
.v2-lot-foot { margin-top: 12px; }
.v2-mono { font-family: var(--font-mono); font-size: 11.5px; letter-spacing: .04em; }
.v2-dim { color: var(--color-faint); }

.v2-lot-price { text-align: left; }
@media (min-width: 820px) { .v2-lot-price { text-align: right; } }
/* A rubber stamp, struck slightly off-square the way a real one lands. */
.v2-stamp {
  display: inline-block; transform: rotate(-3.5deg);
  border: 2px solid var(--color-green); color: var(--color-green);
  padding: 3px 9px; font: 700 10px/1 var(--font-mono); letter-spacing: .18em;
  opacity: .9;
}
.v2-stamp[data-status="sold"] { border-color: var(--color-faint); color: var(--color-faint); }
.v2-stamp[data-status="paid"] { border-color: var(--color-amber); color: var(--color-amber); }
.v2-amount {
  margin-top: 12px; font: 800 clamp(26px,3vw,34px)/1 var(--font-display);
  letter-spacing: -.03em; color: var(--color-ink); font-variant-numeric: tabular-nums;
}
.v2-amount em { font: 600 12px/1 var(--font-mono); font-style: normal; color: var(--color-muted); margin-left: 7px; letter-spacing: .1em; }
.v2-take {
  display: inline-block; margin-top: 10px;
  font: 600 11.5px/1 var(--font-mono); letter-spacing: .1em; text-transform: uppercase;
  color: var(--tint); opacity: 0; transform: translateX(-4px);
  transition: opacity 160ms, transform 160ms;
}
.v2-lot-link:hover .v2-take { opacity: 1; transform: none; }
@media (max-width: 819px) { .v2-take { opacity: 1; transform: none; } }
`;
