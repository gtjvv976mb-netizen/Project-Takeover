"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Caveat } from "next/font/google";
import { Logo } from "@/components/Logo";
import { SlotHeight } from "@/components/SlotHeight";
import { formatSol, shortKey, type Listing } from "@/lib/types";

/**
 * A third skin, asked for after /v2 came back too cold: keep the warmth of the original,
 * lose the template.
 *
 * The original was warm in the way a SaaS dashboard is warm — soft shadows, pastel mesh,
 * rounded corners. Warmth bolted onto a corporate frame, which is exactly why it read as
 * generic. This one is warm because of what it *is*: a board somebody pinned things to.
 * Paper rather than glass, tape rather than drop shadows, cards knocked slightly out of
 * square, prices ringed by hand. Indie devs posting what they made, which is the actual
 * story of the product.
 */

/** The handwriting is an accent only — annotations, never anything load-bearing. */
const hand = Caveat({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-hand", display: "swap" });

const TAGS: Record<string, { label: string; tint: string }> = {
  token_authority: { label: "token controls", tint: "var(--w-grape)" },
  pump_creator: { label: "pump.fun coin", tint: "var(--w-clay)" },
  offchain: { label: "whole project", tint: "var(--w-sage)" },
};

/** Deterministic wobble, so a card sits at the same angle every visit. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const tilt = (s: string) => ((hash(s) % 400) / 100 - 2).toFixed(2); // -2deg … +2deg

export default function V3() {
  const [rows, setRows] = useState<Listing[] | null>(null);
  useEffect(() => {
    let dead = false;
    fetch("/api/listings").then((r) => r.json())
      .then((d) => { if (!dead) setRows(d); })
      .catch(() => { if (!dead) setRows([]); });
    return () => { dead = true; };
  }, []);

  return (
    <div className={`w3 ${hand.variable}`}>
      <Hero />
      <Board rows={rows} />
      <style>{CSS}</style>
    </div>
  );
}

function Hero() {
  return (
    <section className="w3-hero">
      <div className="w3-wrap w3-hero-grid">
        <div>
          <p className="w3-eyebrow">
            <span className="w3-dot" /> a board for things people actually finished
          </p>

          <h1 className="w3-h1">
            Think you&rsquo;d run it better?
            <span className="w3-ring">
              Buy it.
              <svg className="w3-ring-svg" viewBox="0 0 260 96" aria-hidden preserveAspectRatio="none">
                {/* two passes, like someone circled it twice with a marker */}
                <path d="M28 52C28 26 84 12 132 12c46 0 100 12 100 34 0 24-56 38-104 38C82 84 28 72 28 52Z" />
                <path d="M34 56C34 32 88 18 134 18c44 0 96 12 96 32 0 22-54 36-100 36C86 86 34 76 34 56Z" />
              </svg>
            </span>
          </h1>

          <p className="w3-lede">
            Somebody built a memecoin, a pump.fun coin, a site, a whole little community — and
            they&rsquo;re done with it. Take the whole thing off their hands. The chain does the
            handover, so neither of you has to trust the other.
          </p>

          <div className="w3-cta">
            <a href="#board" className="w3-btn w3-btn-go">See what&rsquo;s pinned up</a>
            <Link href="/sell" className="w3-btn">Built something? Sell it</Link>
          </div>

          <p className="w3-note">
            <svg className="w3-arrow" viewBox="0 0 70 40" aria-hidden>
              <path d="M4 4c14 22 34 30 60 28" />
              <path d="M52 26l12 6-9 8" />
            </svg>
            nobody holds your money — not even us
          </p>
        </div>

        <div className="w3-ghost-card" style={{ ["--tilt" as string]: "2.4deg" }}>
          <Tape />
          <Logo size={92} fill={0.44} />
          <p className="w3-ghost-name">Project: Takeover</p>
          <ul className="w3-facts">
            <li><span>fee</span><b>5%</b></li>
            <li><span>held by</span><b>a program</b></li>
            <li><span>slot</span><b><SlotHeight /></b></li>
          </ul>
        </div>
      </div>
    </section>
  );
}

/** A strip of masking tape. Slightly translucent so the card shows through. */
function Tape({ side = "top" }: { side?: "top" | "corner" }) {
  return <span className={`w3-tape w3-tape-${side}`} aria-hidden />;
}

function Board({ rows }: { rows: Listing[] | null }) {
  return (
    <section id="board" className="w3-board">
      <div className="w3-wrap">
        <div className="w3-board-head">
          <h2>Up for grabs</h2>
          <span className="w3-hand-note">{rows ? `${rows.length} pinned right now` : "having a look…"}</span>
        </div>

        {rows === null && <p className="w3-empty">reading the chain…</p>}
        {rows?.length === 0 && <p className="w3-empty">nothing pinned yet — go on, be the first</p>}

        <div className="w3-grid">
          {rows?.map((l) => <Card key={l.id} l={l} />)}
        </div>
      </div>
    </section>
  );
}

function Card({ l }: { l: Listing }) {
  const tag = TAGS[l.type] ?? TAGS.offchain;
  const seed = l.mint ?? l.id;
  return (
    <Link
      href={`/listings/${l.id}`}
      className="w3-card"
      style={{ ["--tilt" as string]: `${tilt(seed)}deg`, ["--tint" as string]: tag.tint }}
    >
      <Tape />
      <div className="w3-swatch" style={{ ["--a" as string]: `${hash(seed) % 360}deg` }} aria-hidden>
        <span className="w3-swatch-mark">{(l.title[0] ?? "?").toUpperCase()}</span>
      </div>

      <span className="w3-tag">{tag.label}</span>
      <h3 className="w3-card-title">{l.title}</h3>
      <p className="w3-card-desc">{l.description || "No description — ask them."}</p>

      <div className="w3-card-foot">
        <span className="w3-price">
          {formatSol(l.priceLamports)} <em>SOL</em>
          <svg className="w3-underline" viewBox="0 0 120 10" aria-hidden preserveAspectRatio="none">
            <path d="M2 6c22-4 46-5 74-2 16 2 28 1 42-2" />
          </svg>
        </span>
        <span className="w3-by">{l.mint ? shortKey(l.mint) : shortKey(l.seller)}</span>
      </div>
    </Link>
  );
}

const CSS = `
/* Warm the shared chrome (nav, footer) while this page is the one on screen, so the
   header does not sit in cool lavender above a cream page. */
:root:has(.w3) {
  --color-bg: #FBF6EC; --color-bg-2: #F4EBDA; --color-surface: #FFFCF6;
  --color-line: #E4D9C6; --color-line-2: #D6C8AF;
  --color-ink: #2C2418; --color-body: #4A4032; --color-muted: #6B5F4E; --color-faint: #9C907C;
}
:root[data-theme="dark"]:has(.w3) {
  --color-bg: #191510; --color-bg-2: #221C15; --color-surface: #221C15;
  --color-line: #372E23; --color-line-2: #4A3E30;
  --color-ink: #F6EFE2; --color-body: #D8CDBB; --color-muted: #C3B7A3; --color-faint: #8B8071;
}

.w3 {
  /* Warm paper, not the cool lavender of the original. The brand violet stays; what
     changes is everything it sits on. */
  --w-paper:  #FBF6EC;
  --w-card:   #FFFCF6;
  --w-ink:    #2C2418;
  --w-soft:   #6B5F4E;
  --w-faint:  #9C907C;
  --w-line:   #E4D9C6;
  --w-grape:  #7C5CFF;
  --w-clay:   #E0663C;
  --w-sage:   #5D9E77;
  --w-honey:  #E7A93B;
  background: var(--w-paper);
  color: var(--w-ink);
  /* a faint tooth, so it reads as stock rather than screen */
  background-image:
    radial-gradient(circle at 18% 22%, rgba(224,102,60,.055), transparent 42%),
    radial-gradient(circle at 82% 12%, rgba(124,92,255,.06), transparent 45%),
    radial-gradient(circle at 62% 88%, rgba(93,158,119,.055), transparent 45%);
  min-height: 100vh;
}
:root[data-theme="dark"] .w3 {
  --w-paper: #191510; --w-card: #221C15; --w-ink: #F6EFE2; --w-soft: #C3B7A3;
  --w-faint: #8B8071; --w-line: #372E23;
  --w-clay: #F0855C; --w-sage: #7CBE96; --w-honey: #F2BE5C; --w-grape: #9B80FF;
}
.w3-wrap { max-width: 1160px; margin-inline: auto; padding-inline: 22px; }

/* ---------------------------------------------------------------- hero ---- */
.w3-hero { padding-block: 54px 30px; }
.w3-hero-grid { display: grid; gap: 44px; align-items: start; }
@media (min-width: 940px) { .w3-hero-grid { grid-template-columns: 1.5fr .9fr; gap: 56px; } }

.w3-eyebrow {
  display: inline-flex; align-items: center; gap: 9px;
  font-family: var(--font-hand), ui-rounded, cursive; font-size: 21px; color: var(--w-clay);
  transform: rotate(-1.2deg);
}
.w3-dot { width: 8px; height: 8px; border-radius: 99px; background: var(--w-clay); }

.w3-h1 {
  margin-top: 12px;
  font: 800 clamp(40px, 6.2vw, 74px)/1.02 var(--font-display);
  letter-spacing: -.035em; color: var(--w-ink); text-wrap: balance;
}
/* The punchline is ringed by hand instead of gradient-filled. */
.w3-ring { position: relative; display: inline-block; margin-left: .3em; white-space: nowrap; }
.w3-ring-svg {
  position: absolute; left: -17%; top: -40%; width: 134%; height: 182%;
  fill: none; stroke: var(--w-clay); stroke-width: 2.2; stroke-linecap: round;
  opacity: .85; pointer-events: none;
}
.w3-ring-svg path:nth-child(2) { opacity: .5; stroke-width: 1.6; }

.w3-lede { margin-top: 24px; max-width: 52ch; font-size: 17.5px; line-height: 1.66; color: var(--w-soft); }

.w3-cta { display: flex; flex-wrap: wrap; gap: 13px; margin-top: 28px; }
/* Chunky and tactile: a hard offset edge, the way a sticker sits on paper. No blur. */
.w3-btn {
  display: inline-flex; align-items: center; border: 2px solid var(--w-ink);
  border-radius: 13px; padding: 13px 22px; font-weight: 700; font-size: 15px;
  background: var(--w-card); color: var(--w-ink);
  box-shadow: 3px 3px 0 var(--w-ink);
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.w3-btn:hover { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--w-ink); }
.w3-btn-go { background: var(--w-honey); color: #2C2418; }

.w3-note {
  display: flex; align-items: center; gap: 10px; margin-top: 26px;
  font-family: var(--font-hand), cursive; font-size: 20px; color: var(--w-soft);
  transform: rotate(-.8deg);
}
.w3-arrow { width: 56px; height: 32px; fill: none; stroke: var(--w-sage); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }

/* the pinned intro card */
.w3-ghost-card {
  position: relative; background: var(--w-card); border: 2px solid var(--w-ink);
  border-radius: 16px; padding: 26px 22px 20px; text-align: center;
  box-shadow: 5px 5px 0 var(--w-ink); transform: rotate(var(--tilt));
}
.w3-ghost-name { margin-top: 10px; font: 800 21px/1.2 var(--font-display); letter-spacing: -.02em; }
.w3-facts { list-style: none; margin: 16px 0 0; padding: 0; border-top: 2px dashed var(--w-line); }
.w3-facts li { display: flex; justify-content: space-between; align-items: baseline; padding: 8px 2px; border-bottom: 2px dashed var(--w-line); }
.w3-facts span { font-family: var(--font-hand), cursive; font-size: 18px; color: var(--w-faint); }
.w3-facts b { font-family: var(--font-mono); font-size: 13px; color: var(--w-ink); }

/* ---------------------------------------------------------------- tape ---- */
.w3-tape {
  position: absolute; z-index: 2; background: rgba(231, 169, 59, .42);
  border-left: 1px solid rgba(255,255,255,.35); border-right: 1px solid rgba(0,0,0,.05);
}
.w3-tape-top {
  width: 92px; height: 26px; top: -13px; left: 50%;
  transform: translateX(-50%) rotate(-2.4deg);
}
:root[data-theme="dark"] .w3-tape { background: rgba(242,190,92,.24); }

/* --------------------------------------------------------------- board ---- */
.w3-board { padding-block: 26px 90px; }
.w3-board-head { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; margin-bottom: 34px; }
.w3-board-head h2 { font: 800 clamp(28px,3.4vw,42px)/1 var(--font-display); letter-spacing: -.03em; }
.w3-hand-note { font-family: var(--font-hand), cursive; font-size: 21px; color: var(--w-clay); transform: rotate(-1deg); }
.w3-empty { font-family: var(--font-hand), cursive; font-size: 22px; color: var(--w-faint); padding: 30px 0; }

.w3-grid { display: grid; gap: 30px 24px; grid-template-columns: repeat(auto-fill, minmax(268px, 1fr)); }

.w3-card {
  position: relative; display: block; background: var(--w-card);
  border: 2px solid var(--w-ink); border-radius: 15px; padding: 22px 18px 18px;
  box-shadow: 4px 4px 0 var(--w-ink);
  transform: rotate(var(--tilt));
  transition: transform 180ms cubic-bezier(.2,.9,.3,1), box-shadow 180ms;
}
/* Straightens up when you look at it, which is the whole gag. */
.w3-card:hover, .w3-card:focus-visible {
  transform: rotate(0deg) translateY(-4px); box-shadow: 7px 8px 0 var(--w-ink); z-index: 3;
}

.w3-swatch {
  height: 118px; border-radius: 10px; border: 2px solid var(--w-ink);
  display: grid; place-items: center; overflow: hidden;
  background: linear-gradient(var(--a), var(--tint), var(--w-honey));
}
.w3-swatch-mark {
  font: 800 46px/1 var(--font-display); color: var(--w-card);
  text-shadow: 2px 2px 0 rgba(0,0,0,.18);
}

.w3-tag {
  display: inline-block; margin-top: 14px; padding: 3px 10px;
  border: 2px solid var(--tint); border-radius: 99px;
  font-family: var(--font-hand), cursive; font-size: 17px; line-height: 1.3; color: var(--tint);
  transform: rotate(-1.4deg);
}
.w3-card-title { margin-top: 9px; font: 800 21px/1.18 var(--font-display); letter-spacing: -.02em; color: var(--w-ink); }
.w3-card-desc {
  margin-top: 6px; font-size: 14.5px; line-height: 1.55; color: var(--w-soft);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.w3-card-foot { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-top: 16px; }
.w3-price { position: relative; font: 800 25px/1 var(--font-display); letter-spacing: -.02em; color: var(--w-ink); }
.w3-price em { font: 700 12px/1 var(--font-mono); font-style: normal; color: var(--w-faint); }
.w3-underline {
  position: absolute; left: -4%; bottom: -11px; width: 108%; height: 9px;
  fill: none; stroke: var(--w-honey); stroke-width: 2.6; stroke-linecap: round;
}
.w3-by { font-family: var(--font-mono); font-size: 11px; color: var(--w-faint); }

@media (prefers-reduced-motion: reduce) {
  .w3-card, .w3-ghost-card, .w3-tape, .w3-tag, .w3-eyebrow, .w3-note, .w3-hand-note { transform: none !important; }
}
`;
