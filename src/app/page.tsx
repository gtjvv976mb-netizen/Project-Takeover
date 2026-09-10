"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { useCountUp, useReveal } from "@/lib/motion";
import { formatSol, shortKey, TYPE_LABELS, type BuilderProfile, type BuilderStats, type Listing, type ListingType } from "@/lib/types";
import { Button, ListingCard, Sigil, TYPE_SHORT, TYPE_TINT } from "@/components/ui";
import { SlotHeight } from "@/components/SlotHeight";
import { HeroSeal } from "@/components/HeroSeal";
import { useConfig } from "@/components/ConfigContext";

type Activity = { kind: string; at: number; id: string; title: string; priceLamports: number; type: Listing["type"] };
const VERB: Record<string, string> = { created: "listed", escrowed: "went live", paid: "funded", settled: "sold", released: "sold" };

const CATEGORY_BLURB: Record<ListingType, string> = {
  token_authority: "Mint, freeze and metadata control of a token. Handed over in one transaction.",
  pump_creator: "The creator role on a pump.fun coin, including the creator fees it earns.",
  offchain: "A whole project: the code, the site, the domain and the community.",
};

/* --------------------------------------------------------------------- hero */

function Hero({ live, settled, builders, onSearch, query }: {
  live: number; settled: number; builders: number;
  onSearch: (v: string) => void; query: string;
}) {
  const liveCount = Math.round(useCountUp(live, 850));
  const settledSol = useCountUp(settled / 1e9, 1000);
  return (
    <section className="relative overflow-hidden border-b border-line">
      {/* the house seal, struck at wall size and turning slowly */}
      <HeroSeal />
      <div className="absolute inset-0" style={{ background: "var(--hero-scrim)" }} aria-hidden />

      <div className="wrap relative z-10 py-16 md:py-24">
        <div className="mx-auto max-w-4xl text-center">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link href="/how-it-works" className="pill" style={{ ["--tint" as string]: "var(--color-brand)" }}>
              ◆ Solana&apos;s first trustless handover
            </Link>
            <span className="pill" style={{ ["--tint" as string]: "var(--color-green)" }}>
              <span className="live-dot" /> {live} live right now
            </span>
          </div>

          <h1 className="display mt-6">
            Think you&rsquo;d run it better?<br className="hidden sm:block" />{" "}
            <span style={{ background: "linear-gradient(90deg, var(--color-brand), var(--color-teal))", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
              Buy it.
            </span>
          </h1>

          <p className="lead mx-auto mt-5">
            Memecoins, pump.fun coins, sites and communities — bought outright, not traded.
            The chain proves who owns it. Nobody holds the money but the code.
          </p>

          <div className="mx-auto mt-8 flex max-w-xl flex-col gap-3 sm:flex-row">
            <input
              value={query}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search projects, tokens, builders…"
              aria-label="Search projects"
              className="input flex-1 !py-3.5 shadow-[var(--shadow-card)]"
            />
            <a href="#market"><Button className="w-full sm:w-auto !py-3.5">Browse projects</Button></a>
          </div>

          {/* The headline speaks only to buyers. This is the other half of the market
              given the same shape — question, then a two-word instruction — so a dev
              landing here finds their own door instead of reading past the buyer's. */}
          <Link
            href="/sell"
            className="group mt-5 inline-flex items-center gap-2 text-[15px] font-semibold text-muted transition-colors hover:text-ink"
          >
            Built something?
            <span
              className="underline decoration-2 underline-offset-4"
              style={{ color: "var(--color-teal)", textDecorationColor: "color-mix(in srgb, var(--color-teal) 45%, transparent)" }}
            >
              Sell it.
            </span>
            <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
          </Link>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-muted">
            <span><strong className="text-ink">{liveCount}</strong> for sale</span>
            <span><strong className="text-ink">{settledSol.toFixed(1)} SOL</strong> traded</span>
            <span><strong className="text-ink">{builders}</strong> builders</span>
            <span className="hidden items-center gap-1.5 sm:inline-flex">
              <span className="live-dot" /> Solana slot <SlotHeight />
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}


/* ------------------------------------------------------------- the pitch */

/**
 * The three claims, given their own band so they read before anything else.
 *
 * The "first" claim is deliberately aimed at the mechanism rather than the category.
 * Marketplaces that sell Solana projects already exist (Flippa, Acquire.Fi); what none
 * of them do is settle the handover on chain with nobody holding a key. That is the
 * part that is genuinely unoccupied, so that is the part the copy claims.
 */
function Pitch() {
  const ref = useReveal<HTMLDivElement>(0.1);
  return (
    <section className="border-y border-line bg-surface">
      <div className="wrap py-14">
        <div ref={ref} data-reveal className="grid gap-5 md:grid-cols-3">
          <div style={{ ["--i" as string]: 0 }} className="rounded-2xl border border-line bg-bg p-6">
            <div className="text-[26px]" aria-hidden>🛠️</div>
            <h3 className="mt-3 text-[21px] font-bold leading-snug text-ink">
              Built in a bedroom.<br />Sold on-chain.
            </h3>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              The market for indie devs who actually shipped something — and the people who want to run it next.
            </p>
          </div>

          <div style={{ ["--i" as string]: 1, background: "linear-gradient(150deg, color-mix(in srgb, var(--color-brand) 12%, var(--color-tint-base)), color-mix(in srgb, var(--color-teal) 10%, var(--color-tint-base)))" }}
            className="rounded-2xl border border-brand/25 p-6">
            <div className="text-[26px]" aria-hidden>🔐</div>
            <h3 className="mt-3 text-[21px] font-bold leading-snug text-ink">
              Nobody holds the keys.<br />Not even us.
            </h3>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              Solana&apos;s first trustless handover: your money and the token&apos;s controls swap in one
              instruction, held by code no human can unlock.
            </p>
            <Link href="/how-it-works" className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-semibold text-brand hover:gap-2.5">
              See how <span aria-hidden>→</span>
            </Link>
          </div>

          <div style={{ ["--i" as string]: 2 }} className="rounded-2xl border border-line bg-bg p-6">
            <div className="text-[26px]" aria-hidden>🚀</div>
            <h3 className="mt-3 text-[21px] font-bold leading-snug text-ink">
              Stop buying bags.<br />Buy the whole project.
            </h3>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              Buy a memecoin outright and walk away owning it — the mint, the metadata, the creator
              fees, the ticker. Not a position. The whole project.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- categories */

function Categories({ counts, onPick }: { counts: Record<ListingType, number>; onPick: (t: ListingType) => void }) {
  const ref = useReveal<HTMLDivElement>(0.1);
  return (
    <section className="wrap py-12">
      <div ref={ref} data-reveal className="grid gap-4 md:grid-cols-3">
        {(Object.keys(TYPE_LABELS) as ListingType[]).map((t, i) => (
          <button
            key={t}
            onClick={() => onPick(t)}
            style={{ ["--i" as string]: i, ["--accent" as string]: TYPE_TINT[t] }}
            className="card card-hover flex items-start gap-4 p-5 text-left"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[18px]"
              style={{ background: `color-mix(in srgb, ${TYPE_TINT[t]} 14%, var(--color-tint-base))` }} aria-hidden>
              {t === "token_authority" ? "🔑" : t === "pump_creator" ? "🚀" : "🌐"}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="text-[17px] font-bold text-ink">{TYPE_SHORT[t]}</span>
                <span className="kicker">{counts[t]}</span>
              </span>
              <span className="mt-1 block text-[14px] leading-relaxed text-muted">{CATEGORY_BLURB[t]}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- market */

function Market({ listings, query, type, setType, status, setStatus, loading }: {
  listings: Listing[]; query: string;
  type: ListingType | ""; setType: (t: ListingType | "") => void;
  status: "active" | "sold" | "all"; setStatus: (s: "active" | "sold" | "all") => void;
  loading: boolean;
}) {
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return listings.filter((l) => {
      if (status !== "all" && l.status !== status) return false;
      if (type && l.type !== type) return false;
      if (!q) return true;
      return `${l.title} ${l.description} ${l.token?.symbol ?? ""} ${l.token?.name ?? ""} ${l.seller}`.toLowerCase().includes(q);
    });
  }, [listings, query, type, status]);

  return (
    <section id="market" className="wrap scroll-mt-20 pb-16">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h2 className="title-lg">Projects for sale</h2>
        <span className="kicker mt-1">{shown.length} {shown.length === 1 ? "result" : "results"}</span>

        <div className="ml-auto flex flex-wrap gap-2">
          <div className="flex rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-card)]">
            {([["", "All"], ["token_authority", "Tokens"], ["pump_creator", "pump.fun"], ["offchain", "Projects"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setType(v as ListingType | "")}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${type === v ? "bg-brand text-white" : "text-muted hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}
            className="input !w-auto !py-2 text-[13px] font-semibold">
            <option value="active">For sale</option>
            <option value="sold">Sold</option>
            <option value="all">Everything</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="card overflow-hidden">
              <div className="skeleton aspect-[16/10] !rounded-none" />
              <div className="space-y-3 p-4">
                <div className="skeleton h-4 w-24" /><div className="skeleton h-5 w-3/4" /><div className="skeleton h-4 w-full" /><div className="skeleton h-8 w-28" />
              </div>
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="card grid place-items-center px-6 py-20 text-center">
          <div className="text-5xl" aria-hidden>🗂️</div>
          <h3 className="mt-4 text-[20px] font-bold text-ink">Nothing here yet</h3>
          <p className="mt-2 max-w-sm text-[15px] text-muted">
            {query ? "Try a different search, or clear the filters." : "Be the first to put a project up for sale."}
          </p>
          <Link href="/sell" className="mt-5"><Button>List your project</Button></Link>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((l) => <ListingCard key={l.id} l={l} />)}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- how it works */

type Step = { title: string; body: string; note?: string };

/**
 * Written from the user's chair: what you click, what your wallet asks you to sign,
 * and what you get. Where the two asset types genuinely diverge, the step says so
 * rather than papering over it.
 */
const JOURNEYS: {
  key: string;
  tab: string;
  who: string;
  tint: string;
  steps: Step[];
  safety: string[];
}[] = [
  {
    key: "sell",
    tab: "I built something",
    who: "Selling takes about five minutes.",
    tint: "var(--color-tangerine)",
    steps: [
      {
        title: "Connect your wallet",
        body: "Nothing to sign up for and no password. Your wallet is your account, and it is also your proof — the site reads the chain to see what you actually control.",
      },
      {
        title: "Say what you are selling",
        body: "Paste your token's mint address, or describe the project, site or community. Add a name, a short description and links. Set your price in SOL.",
        note: "For a token, the chain is checked right then. If your wallet does not hold those controls, the listing is refused. Nobody can list what they do not own.",
      },
      {
        title: "Hand over the controls",
        body: "Your wallet asks you to approve one transaction for each control you are selling. They move into the escrow program's custody, and your listing goes live.",
        note: "Tokens only. If you are selling a pump.fun coin or a whole project, skip this — your listing is live immediately and you keep everything until someone pays.",
      },
      {
        title: "Get paid",
        body: "For a token, the moment someone buys, the SOL lands in your wallet automatically. For anything else, you hand it over, the buyer confirms, and you are paid.",
      },
    ],
    safety: [
      "Changed your mind? Cancel any time before it sells and every control comes straight back to you.",
      "You are never left having handed something over with no payment. For tokens the swap is one transaction; for everything else the buyer's money is already locked up before you deliver.",
    ],
  },
  {
    key: "buy",
    tab: "I want to take one over",
    who: "Buying is two clicks and one signature.",
    tint: "var(--color-brand)",
    steps: [
      {
        title: "Browse and check the proof",
        body: "Every listing shows what the chain says, not what the seller claims: total supply, which controls exist, who holds them, and how concentrated the top holders are.",
      },
      {
        title: "Connect your wallet and hit buy",
        body: "The price is fixed and shown up front. Your wallet shows you exactly what you are approving before you sign anything.",
      },
      {
        title: "Get the keys",
        body: "For a token, the same transaction that takes your SOL puts the mint, freeze and metadata controls in your wallet. You own it before the transaction finishes.",
        note: "For a pump.fun coin or a project, your SOL goes into the escrow program instead. The seller cannot touch it. They then transfer ownership or hand over the repo, domain and socials.",
      },
      {
        title: "Confirm and release",
        body: "Once you have it, you release the funds to the seller. That last step is yours alone — no one else can do it for you.",
        note: "Tokens skip this entirely. There is nothing to release, because you already have it.",
      },
    ],
    safety: [
      "If a seller takes your money and vanishes, you get it back. After the delivery deadline anyone can trigger the refund — you do not need the seller, or us, to cooperate.",
      "Something off? Freeze the deal in dispute. The arbitrator can only pick you or the seller. It cannot redirect your money anywhere else.",
    ],
  },
];

function HowItWorks({ feeBps }: { feeBps: number }) {
  const [key, setKey] = useState(JOURNEYS[0].key);
  const ref = useReveal<HTMLDivElement>(0.06);
  const j = JOURNEYS.find((x) => x.key === key) ?? JOURNEYS[0];

  return (
    <section id="how" className="scroll-mt-20 border-y border-line bg-surface">
      <div className="wrap py-16">
        <div className="mx-auto max-w-2xl text-center">
          <div className="kicker">Step by step</div>
          <h2 className="title-lg mt-2">What actually happens</h2>
        </div>

        <div className="mt-7 flex justify-center">
          <div className="flex flex-wrap justify-center gap-1 rounded-2xl border border-line bg-bg p-1">
            {JOURNEYS.map((x) => (
              <button
                key={x.key}
                onClick={() => setKey(x.key)}
                aria-pressed={x.key === key}
                className={`rounded-xl px-4 py-2 text-[14px] font-semibold transition-colors ${
                  x.key === key ? "text-on-tint" : "text-muted hover:text-ink"
                }`}
                style={x.key === key ? { background: x.tint } : undefined}
              >
                {x.tab}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-4 text-center text-[15px] text-muted">{j.who}</p>

        <div key={j.key} ref={ref} data-reveal className="mx-auto mt-10 grid max-w-5xl gap-4 md:grid-cols-2">
          {j.steps.map((step, i) => (
            <div
              key={step.title}
              style={{ ["--i" as string]: i }}
              className="flex gap-4 rounded-2xl border border-line bg-bg p-5"
            >
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[15px] font-bold text-on-tint"
                style={{ background: j.tint }}
                aria-hidden
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <h3 className="text-[17px] font-bold leading-snug text-ink">{step.title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{step.body}</p>
                {step.note && (
                  <p className="mt-2.5 border-l-2 pl-3 text-[13px] leading-relaxed text-faint" style={{ borderColor: j.tint }}>
                    {step.note}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-8 max-w-5xl rounded-2xl border border-line bg-bg p-6">
          <div className="kicker mb-3">If it goes wrong</div>
          <ul className="grid gap-2.5 md:grid-cols-2">
            {j.safety.map((line) => (
              <li key={line} className="flex gap-2.5 text-[14px] leading-relaxed text-muted">
                <span aria-hidden style={{ color: "var(--color-green)" }}>✓</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-line pt-4 text-[13px] text-faint">
            The fee is {feeBps / 100}%, taken from the seller only when a sale completes. Buyers pay
            nothing beyond Solana&apos;s own network fee, a fraction of a cent.
          </p>
        </div>

        <div className="mt-8 text-center">
          <Link href="/how-it-works"><Button variant="secondary">The long version</Button></Link>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- builders */

function Builders({ builders }: { builders: { wallet: string; profile: BuilderProfile | null; stats: BuilderStats }[] }) {
  const ref = useReveal<HTMLDivElement>(0.12);
  if (!builders.length) return null;
  return (
    <section className="wrap py-16">
      <h2 className="title-lg">Builders</h2>
      <p className="lead mt-2">A wallet is a track record you cannot fake.</p>
      <div ref={ref} data-reveal className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {builders.slice(0, 8).map((b, i) => (
          <Link key={b.wallet} href={`/builders/${b.wallet}`} style={{ ["--i" as string]: i }} className="card card-hover flex items-center gap-3 p-4">
            <Sigil wallet={b.wallet} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold text-ink">{b.profile?.name || shortKey(b.wallet, 4)}</span>
              <span className="block text-[13px] text-muted">
                {b.stats.listed} listed · {b.stats.sold} sold · {formatSol(b.stats.earnedLamports, 1)} SOL
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------- page */

export default function Home() {
  const cfg = useConfig();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [builders, setBuilders] = useState<{ wallet: string; profile: BuilderProfile | null; stats: BuilderStats }[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<ListingType | "">("");
  const [status, setStatus] = useState<"active" | "sold" | "all">("active");

  useEffect(() => {
    let off = false;
    api.listings({ status: "all" }).then((l) => !off && setListings(l)).catch(() => !off && setListings([]));
    fetch("/api/builders").then((r) => r.json()).then((b) => !off && setBuilders(b)).catch(() => {});
    fetch("/api/activity").then((r) => r.json()).then((a) => !off && setActivity(a)).catch(() => {});
    return () => { off = true; };
  }, []);

  const all = useMemo(() => listings ?? [], [listings]);
  const counts = useMemo(() => {
    const c: Record<ListingType, number> = { token_authority: 0, pump_creator: 0, offchain: 0 };
    for (const l of all) if (l.status === "active") c[l.type]++;
    return c;
  }, [all]);
  const live = all.filter((l) => l.status === "active").length;
  const settled = all.filter((l) => l.status === "sold").reduce((a, l) => a + l.priceLamports, 0);

  const jumpTo = (t: ListingType) => {
    setType(t);
    document.getElementById("market")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <>
      <Hero live={live} settled={settled} builders={builders.length} query={query} onSearch={setQuery} />

      {activity.length > 0 && (
        <div className="border-b border-line bg-surface py-2.5">
          <div className="tape" style={{ ["--speed" as string]: "50s" }} aria-hidden>
            <div className="tape-track">
              {[0, 1].map((dup) => (
                <div key={dup} className="flex shrink-0">
                  {activity.map((a, i) => (
                    <span key={`${dup}-${i}`} className="flex items-center gap-2 whitespace-nowrap px-5 text-[13px] text-muted">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: TYPE_TINT[a.type] }} />
                      <strong className="font-semibold text-ink">{a.title}</strong> {VERB[a.kind] ?? a.kind} · {formatSol(a.priceLamports)} SOL
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <Pitch />
      <Categories counts={counts} onPick={jumpTo} />
      <Market listings={all} query={query} type={type} setType={setType} status={status} setStatus={setStatus} loading={listings === null} />
      <HowItWorks feeBps={cfg.feeBps} />
      <Builders builders={builders} />
    </>
  );
}
