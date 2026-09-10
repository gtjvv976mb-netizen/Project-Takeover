"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Guilloche } from "@/components/Guilloche";
import { SlotHeight } from "@/components/SlotHeight";
import { formatSol, shortKey, type Listing, type ListingType } from "@/lib/types";

/**
 * The one that keeps its hands steady.
 *
 * Three attempts got us here. The original was warm but wore the standard template. /v2
 * was distinctive but cold. /v3 was warm and distinctive but too handmade — tape, tilted
 * cards and handwriting are charming for about a minute and then you notice you are being
 * asked to send real money to a page that looks like a scrapbook.
 *
 * So: the warm paper ground from /v3, the engraved seal from /v2, and the straight
 * alignment of the original. Nothing wobbles, nothing is hand-lettered, and the character
 * comes from three deliberate choices instead of from decoration —
 *
 *   1. Warm paper under crisp white cards, where every other marketplace puts cool grey.
 *   2. A hard offset edge instead of a blurred shadow, so cards sit on the page rather
 *      than float above it.
 *   3. A guilloche struck from the asset's own mint, which is real artwork carrying real
 *      information, rather than a pastel gradient carrying none.
 */

const TYPES: { key: ListingType; label: string; short: string; tint: string }[] = [
  { key: "token_authority", label: "Token controls", short: "Controls", tint: "var(--p-grape)" },
  { key: "pump_creator", label: "pump.fun coin", short: "pump.fun", tint: "var(--p-clay)" },
  { key: "offchain", label: "Whole project", short: "Projects", tint: "var(--p-sage)" },
];
const byKey = Object.fromEntries(TYPES.map((t) => [t.key, t]));

const CONVEYS: Record<string, string> = { mint: "Mint", freeze: "Freeze", metadata_update: "Metadata" };

export default function V4() {
  const [rows, setRows] = useState<Listing[] | null>(null);
  const [filter, setFilter] = useState<ListingType | "all">("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    let dead = false;
    fetch("/api/listings").then((r) => r.json())
      .then((d) => { if (!dead) setRows(d); })
      .catch(() => { if (!dead) setRows([]); });
    return () => { dead = true; };
  }, []);

  const shown = useMemo(() => {
    if (!rows) return null;
    const needle = q.trim().toLowerCase();
    return rows.filter((l) =>
      (filter === "all" || l.type === filter) &&
      (!needle || l.title.toLowerCase().includes(needle) || (l.description ?? "").toLowerCase().includes(needle)));
  }, [rows, filter, q]);

  return (
    <div className="p4">
      <Hero count={rows?.length ?? 0} q={q} setQ={setQ} />
      <Market rows={shown} total={rows?.length ?? 0} filter={filter} setFilter={setFilter} />
      <style>{CSS}</style>
    </div>
  );
}

/* ------------------------------------------------------------------- hero */

function Hero({ count, q, setQ }: { count: number; q: string; setQ: (v: string) => void }) {
  return (
    <section className="p4-hero">
      <div className="p4-wrap p4-hero-grid">
        <div className="p4-hero-copy">
          <p className="p4-kicker">Solana&rsquo;s first trustless handover</p>

          <h1 className="p4-h1">
            Think you&rsquo;d run it better?
            <span className="p4-punch">Buy it.</span>
          </h1>

          <p className="p4-lede">
            Somebody built a memecoin, a pump.fun coin, a whole site — and they&rsquo;re done with
            it. Take the entire thing off their hands. A program on Solana does the handover, so
            neither of you has to trust the other.
          </p>

          <form className="p4-search" onSubmit={(e) => e.preventDefault()} role="search">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search projects, tokens, builders…"
              aria-label="Search projects"
            />
            <a href="#market" className="p4-btn p4-btn-primary">Browse {count} projects</a>
          </form>

          <Link href="/sell" className="p4-seller">
            Built something? <b>Sell it</b> <span aria-hidden>→</span>
          </Link>
        </div>

        {/* A specimen: what a certificate of title looks like here. */}
        <aside className="p4-specimen" aria-label="What a listing carries">
          <div className="p4-specimen-art">
            <Guilloche seed="Project:Takeover-specimen" tint="var(--p-grape)" />
          </div>
          <dl className="p4-specimen-facts">
            <div><dt>Platform fee</dt><dd>5.00%</dd></div>
            <div><dt>Held by</dt><dd>A program</dd></div>
            <div><dt>Keys we hold</dt><dd>None</dd></div>
            <div><dt>Solana slot</dt><dd><SlotHeight /></dd></div>
          </dl>
          <p className="p4-specimen-note">
            Every asset in this market sits in the escrow program&rsquo;s own custody. No person,
            this site included, can move it.
          </p>
        </aside>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- market */

function Market({ rows, total, filter, setFilter }: {
  rows: Listing[] | null; total: number;
  filter: ListingType | "all"; setFilter: (t: ListingType | "all") => void;
}) {
  return (
    <section id="market" className="p4-market">
      <div className="p4-wrap">
        <div className="p4-market-head">
          <h2>For sale</h2>
          <div className="p4-tabs" role="tablist" aria-label="Filter by kind">
            <button role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}
              className={filter === "all" ? "on" : ""}>All</button>
            {TYPES.map((t) => (
              <button key={t.key} role="tab" aria-selected={filter === t.key}
                onClick={() => setFilter(t.key)} className={filter === t.key ? "on" : ""}
                style={{ ["--tint" as string]: t.tint }}>
                {t.short}
              </button>
            ))}
          </div>
          <span className="p4-count">{rows ? `${rows.length} of ${total}` : "—"}</span>
        </div>

        {rows === null && <p className="p4-empty">Reading the chain…</p>}
        {rows?.length === 0 && <p className="p4-empty">Nothing matches. Try another filter.</p>}

        <div className="p4-grid">
          {rows?.map((l) => <Card key={l.id} l={l} />)}
        </div>
      </div>
    </section>
  );
}

function Card({ l }: { l: Listing }) {
  const t = byKey[l.type] ?? TYPES[2];
  const seed = l.mint ?? l.id;
  const conveys =
    l.type === "token_authority"
      ? ((l.asset as { authorities?: string[] }).authorities ?? []).map((a) => CONVEYS[a] ?? a)
      : l.type === "pump_creator" ? ["Creator role", "Creator fees"] : ["Repo", "Domain", "Accounts"];

  return (
    <Link href={`/listings/${l.id}`} className="p4-card" style={{ ["--tint" as string]: t.tint }}>
      <div className="p4-card-art">
        <Guilloche seed={seed} tint={t.tint} />
        <span className="p4-card-kind">{t.label}</span>
      </div>

      <div className="p4-card-body">
        <h3>{l.title}</h3>
        <p>{l.description || "No description provided."}</p>

        <ul className="p4-conveys" aria-label="What this conveys">
          {conveys.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>

      <div className="p4-card-foot">
        <span className="p4-price">{formatSol(l.priceLamports)}<em>SOL</em></span>
        <span className="p4-ref">{l.mint ? shortKey(l.mint) : shortKey(l.seller)}</span>
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ style */

const CSS = `
/* The shared nav and footer come from the layout, so retint them for as long as this
   page is the one on screen rather than letting cool chrome sit over a warm page. */
:root:has(.p4) {
  --color-bg: #FAF6EF; --color-bg-2: #F2EDE3; --color-surface: #FFFFFF;
  --color-line: #E9E1D4; --color-line-2: #D8CEBC;
  --color-ink: #241F1A; --color-body: #564E44; --color-muted: #7C7368; --color-faint: #9A9084;
}
:root[data-theme="dark"]:has(.p4) {
  --color-bg: #17130F; --color-bg-2: #201A15; --color-surface: #221C16;
  --color-line: #352C23; --color-line-2: #483C30;
  --color-ink: #F7F1E7; --color-body: #D5CBBD; --color-muted: #B4A997; --color-faint: #8A8073;
}

.p4 {
  /* Warm paper under crisp white cards. Every other marketplace puts cool grey here;
     this one keeps the original's friendliness without borrowing its template. */
  --p-bg:     #FAF6EF;
  --p-card:   #FFFFFF;
  --p-ink:    #241F1A;
  --p-body:   #564E44;
  --p-muted:  #7C7368;
  --p-faint:  #9A9084;
  --p-line:   #E9E1D4;
  --p-edge:   #EFE7D9;   /* the solid offset under a card */
  --p-grape:  #6C4BF5;
  --p-clay:   #D65B2E;
  --p-sage:   #2F8F62;
  --p-honey:  #D99420;
  background: var(--p-bg); color: var(--p-body); min-height: 100vh;
}
:root[data-theme="dark"] .p4 {
  --p-bg: #17130F; --p-card: #221C16; --p-ink: #F7F1E7; --p-body: #D5CBBD;
  --p-muted: #B4A997; --p-faint: #8A8073; --p-line: #352C23; --p-edge: #100D0A;
  --p-grape: #9A80FF; --p-clay: #EF8052; --p-sage: #58BE8D; --p-honey: #EDB44E;
}
.p4-wrap { max-width: 1200px; margin-inline: auto; padding-inline: 24px; }

/* --------------------------------------------------------------- hero --- */
.p4-hero { padding-block: 60px 20px; }
.p4-hero-grid { display: grid; gap: 44px; align-items: start; }
@media (min-width: 980px) { .p4-hero-grid { grid-template-columns: 1.5fr .82fr; gap: 60px; } }

.p4-kicker {
  font: 600 11px/1 var(--font-mono); letter-spacing: .19em; text-transform: uppercase;
  color: var(--p-clay);
}
.p4-h1 {
  margin-top: 16px; font: 800 clamp(42px,6.1vw,72px)/1.02 var(--font-display);
  letter-spacing: -.038em; color: var(--p-ink); text-wrap: balance;
}
/* Set apart with a solid rule instead of a gradient fill or a drawn scribble: the
   punchline is answered, not decorated. */
.p4-punch {
  display: block; width: max-content; max-width: 100%;
  margin-top: 10px; padding-top: 10px;
  border-top: 5px solid var(--p-grape); color: var(--p-grape);
}
.p4-lede { margin-top: 24px; max-width: 53ch; font-size: 17.5px; line-height: 1.64; color: var(--p-body); }

.p4-search { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; max-width: 620px; }
.p4-search input {
  flex: 1 1 260px; min-width: 0;
  background: var(--p-card); border: 1.5px solid var(--p-line); border-radius: 12px;
  padding: 14px 16px; font-size: 15px; color: var(--p-ink);
  box-shadow: 3px 3px 0 var(--p-edge);
  transition: border-color 140ms, box-shadow 140ms;
}
.p4-search input::placeholder { color: var(--p-faint); }
.p4-search input:focus { outline: none; border-color: var(--p-grape); box-shadow: 3px 3px 0 color-mix(in srgb, var(--p-grape) 22%, transparent); }

.p4-btn {
  display: inline-flex; align-items: center; justify-content: center; white-space: nowrap;
  border-radius: 12px; padding: 14px 22px; font-weight: 700; font-size: 15px;
  border: 1.5px solid var(--p-ink); color: var(--p-ink); background: var(--p-card);
  box-shadow: 3px 3px 0 var(--p-ink);
  transition: transform 120ms ease, box-shadow 120ms ease, background-color 120ms;
}
.p4-btn:hover { transform: translate(1.5px,1.5px); box-shadow: 1.5px 1.5px 0 var(--p-ink); }
.p4-btn-primary { background: var(--p-grape); border-color: var(--p-grape); color: #fff; box-shadow: 3px 3px 0 color-mix(in srgb, var(--p-grape) 34%, transparent); }
.p4-btn-primary:hover { box-shadow: 1.5px 1.5px 0 color-mix(in srgb, var(--p-grape) 34%, transparent); }

.p4-seller {
  display: inline-flex; align-items: center; gap: 7px; margin-top: 18px;
  font-size: 15px; color: var(--p-muted);
  transition: color 140ms;
}
.p4-seller b { color: var(--p-sage); text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 4px; }
.p4-seller:hover { color: var(--p-ink); }

/* the specimen plate */
.p4-specimen {
  background: var(--p-card); border: 1.5px solid var(--p-line); border-radius: 16px;
  padding: 22px; box-shadow: 5px 5px 0 var(--p-edge); align-self: start;
}
.p4-specimen-art {
  display: grid; place-items: center; padding: 4px 0 14px;
  border-bottom: 1.5px solid var(--p-line);
}
.p4-specimen-art svg { width: 132px; height: 132px; }
.p4-specimen-facts { margin-top: 4px; }
.p4-specimen-facts > div {
  display: flex; justify-content: space-between; align-items: baseline; gap: 14px;
  padding: 9px 0; border-bottom: 1px solid var(--p-line);
}
.p4-specimen-facts dt { font-size: 13px; color: var(--p-muted); }
.p4-specimen-facts dd { font: 600 13px/1 var(--font-mono); color: var(--p-ink); font-variant-numeric: tabular-nums; }
.p4-specimen-note { margin-top: 15px; font-size: 12.5px; line-height: 1.55; color: var(--p-muted); }

/* ------------------------------------------------------------- market --- */
.p4-market { padding-block: 46px 90px; }
.p4-market-head {
  display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
  padding-bottom: 16px; border-bottom: 2px solid var(--p-ink); margin-bottom: 30px;
}
.p4-market-head h2 { font: 800 clamp(26px,3vw,36px)/1 var(--font-display); letter-spacing: -.03em; color: var(--p-ink); }
.p4-count { margin-left: auto; font: 500 12px/1 var(--font-mono); color: var(--p-faint); letter-spacing: .06em; }

.p4-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.p4-tabs button {
  border: 1.5px solid var(--p-line); border-radius: 99px; padding: 7px 15px;
  font-weight: 600; font-size: 13.5px; color: var(--p-muted); background: var(--p-card);
  transition: color 140ms, border-color 140ms, background-color 140ms;
}
.p4-tabs button:hover { color: var(--p-ink); border-color: var(--p-line-2, var(--p-muted)); }
.p4-tabs button.on {
  color: var(--tint, var(--p-ink)); border-color: var(--tint, var(--p-ink));
  background: color-mix(in srgb, var(--tint, var(--p-ink)) 9%, var(--p-card));
}

.p4-empty { padding: 44px 0; color: var(--p-muted); font-size: 15px; }
.p4-grid { display: grid; gap: 22px; grid-template-columns: repeat(auto-fill, minmax(282px, 1fr)); }

/* Cards sit on the page: a hard offset edge, no blur, and no tilt. */
.p4-card {
  display: flex; flex-direction: column;
  background: var(--p-card); border: 1.5px solid var(--p-line); border-radius: 16px;
  box-shadow: 4px 4px 0 var(--p-edge); overflow: hidden;
  transition: transform 170ms cubic-bezier(.2,.9,.3,1), box-shadow 170ms, border-color 170ms;
}
.p4-card:hover, .p4-card:focus-visible {
  transform: translate(-2px,-3px);
  box-shadow: 8px 9px 0 color-mix(in srgb, var(--tint) 20%, var(--p-edge));
  border-color: color-mix(in srgb, var(--tint) 42%, var(--p-line));
}

.p4-card-art {
  position: relative; display: grid; place-items: center; padding: 18px 0 14px;
  background: color-mix(in srgb, var(--tint) 7%, var(--p-card));
  border-bottom: 1.5px solid color-mix(in srgb, var(--tint) 16%, var(--p-line));
}
.p4-card-art svg { width: 120px; height: 120px; }
.p4-card-kind {
  position: absolute; left: 12px; top: 12px;
  font: 600 10px/1 var(--font-mono); letter-spacing: .13em; text-transform: uppercase;
  color: var(--tint);
}

.p4-card-body { padding: 16px 16px 0; flex: 1; }
.p4-card-body h3 { font: 700 19px/1.22 var(--font-display); letter-spacing: -.022em; color: var(--p-ink); }
.p4-card-body p {
  margin-top: 6px; font-size: 14px; line-height: 1.55; color: var(--p-muted);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.p4-conveys { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 12px; list-style: none; padding: 0; }
.p4-conveys li {
  border: 1px solid color-mix(in srgb, var(--tint) 34%, transparent);
  border-radius: 6px; padding: 2.5px 7px;
  font: 600 11px/1.4 var(--font-mono); letter-spacing: .03em;
  color: color-mix(in srgb, var(--tint) 74%, var(--p-ink));
}

.p4-card-foot {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  padding: 14px 16px 15px; margin-top: 14px;
  border-top: 1.5px solid var(--p-line);
}
.p4-price { font: 800 22px/1 var(--font-display); letter-spacing: -.025em; color: var(--p-ink); font-variant-numeric: tabular-nums; }
.p4-price em { font: 600 11px/1 var(--font-mono); font-style: normal; color: var(--p-faint); margin-left: 6px; letter-spacing: .09em; }
.p4-ref { font: 500 11px/1 var(--font-mono); color: var(--p-faint); }

@media (prefers-reduced-motion: reduce) { .p4-card, .p4-btn { transition: none; } }
`;
