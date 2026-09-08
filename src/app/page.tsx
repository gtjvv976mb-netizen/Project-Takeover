"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { useCountUp, useReveal } from "@/lib/motion";
import { formatSol, shortKey, TYPE_LABELS, type BuilderProfile, type BuilderStats, type Listing, type ListingType } from "@/lib/types";
import { Button, ListingCard, Sigil, TYPE_SHORT, TYPE_TINT } from "@/components/ui";
import { SlotHeight } from "@/components/SlotHeight";

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
      {/* slow-moving field of colour behind everything */}
      <div className="aurora" aria-hidden><span className="a1" /><span className="a2" /><span className="a3" /></div>
      <div className="absolute inset-0 bg-gradient-to-b from-white/40 via-white/70 to-bg" aria-hidden />

      <div className="wrap relative z-10 py-16 md:py-24">
        <div className="mx-auto max-w-4xl text-center">
          <span className="pill mx-auto" style={{ ["--tint" as string]: "var(--color-green)" }}>
            <span className="live-dot" /> {live} projects for sale right now
          </span>

          <h1 className="display mt-6">
            Buy and sell the projects<br className="hidden sm:block" /> people actually built on{" "}
            <span style={{ background: "linear-gradient(90deg, var(--color-brand), var(--color-teal))", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
              Solana
            </span>
          </h1>

          <p className="lead mx-auto mt-5">
            Tokens, pump.fun coins, websites and communities. The blockchain proves who owns it,
            and your money is held safely in escrow until it&apos;s actually handed over.
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
              style={{ background: `color-mix(in srgb, ${TYPE_TINT[t]} 14%, white)` }} aria-hidden>
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

const STEPS = [
  { icon: "📦", title: "List what you built", body: "Connect your wallet. We read the blockchain to confirm you really own it, then you set a price." },
  { icon: "🔒", title: "Buyer pays into escrow", body: "Their SOL is held safely. Nobody can touch it until the handover actually happens." },
  { icon: "🤝", title: "Ownership transfers", body: "For tokens it is one automatic transaction. For everything else, funds release once the buyer confirms." },
];

function HowItWorks() {
  const ref = useReveal<HTMLDivElement>(0.12);
  return (
    <section className="border-y border-line bg-surface">
      <div className="wrap py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="title-lg">Safe for both sides</h2>
          <p className="lead mx-auto mt-3">Three steps, no trust required.</p>
        </div>
        <div ref={ref} data-reveal className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} style={{ ["--i" as string]: i }} className="rounded-2xl bg-bg p-6">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-surface text-[22px] shadow-[var(--shadow-card)]" aria-hidden>{s.icon}</div>
              <h3 className="mt-4 text-[18px] font-bold text-ink">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{s.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Link href="/how-it-works"><Button variant="secondary">Read the details</Button></Link>
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

      <Categories counts={counts} onPick={jumpTo} />
      <Market listings={all} query={query} type={type} setType={setType} status={status} setStatus={setStatus} loading={listings === null} />
      <HowItWorks />
      <Builders builders={builders} />
    </>
  );
}
