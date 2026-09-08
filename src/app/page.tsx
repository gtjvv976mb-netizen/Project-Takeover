"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { api } from "@/lib/client/api";
import { formatSol, shortKey, TYPE_LABELS, type BuilderProfile, type BuilderStats, type Listing, type ListingType } from "@/lib/types";
import { ListingCard, Button } from "@/components/ui";

const HomeWorld = dynamic(() => import("@/components/three/HomeWorld"), { ssr: false });

type Activity = { kind: string; at: number; id: string; title: string; priceLamports: number; type: Listing["type"] };
const VERB: Record<string, string> = { created: "listed", escrowed: "went live", paid: "funded", settled: "taken over", released: "taken over" };

function Section({ step, title, body, accent, children }: { step: string; title: string; body: string; accent: string; children?: React.ReactNode }) {
  return (
    <section className="pointer-events-none relative z-10 flex min-h-screen items-center">
      <div className="max-w-md">
        <div className="label mb-3" style={{ color: accent }}>{step}</div>
        <h2 className="text-4xl font-bold tracking-tight md:text-5xl">{title}</h2>
        <p className="mt-4 text-mute">{body}</p>
        {children && <div className="pointer-events-auto mt-6">{children}</div>}
      </div>
    </section>
  );
}

export default function Home() {
  const [type, setType] = useState<ListingType | "">("");
  const [status, setStatus] = useState<"active" | "sold" | "all">("active");
  const [data, setData] = useState<{ key: string; items: Listing[] } | null>(null);
  const [orbit, setOrbit] = useState<Listing[]>([]);
  const [builders, setBuilders] = useState<{ wallet: string; profile: BuilderProfile | null; stats: BuilderStats }[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const key = `${status}|${type}`;
  const listings = data?.key === key ? data.items : null;

  useEffect(() => {
    api.listings({ status: "active" }).then(setOrbit).catch(() => setOrbit([]));
    fetch("/api/builders").then((r) => r.json()).then(setBuilders).catch(() => setBuilders([]));
    fetch("/api/activity").then((r) => r.json()).then(setActivity).catch(() => setActivity([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.listings({ status, ...(type ? { type } : {}) })
      .then((items) => { if (!cancelled) setData({ key, items }); })
      .catch(() => { if (!cancelled) setData({ key, items: [] }); });
    return () => { cancelled = true; };
  }, [type, status, key]);

  return (
    <div className="-mt-8">
      <HomeWorld listings={orbit} />

      {/* 0 · hero over the orbit */}
      <section className="pointer-events-none relative z-10 flex min-h-screen flex-col justify-center">
        <div className="label mb-4 !text-circuit">{"// independent builders · verified on-chain · escrowed takeovers"}</div>
        <h1 className="max-w-2xl text-5xl font-bold tracking-tight md:text-7xl">
          Build on Solana. <span className="text-ember">Have something to show for it.</span>
        </h1>
        <p className="mt-5 max-w-lg text-mute md:text-lg">
          The market where independent developers ship real projects and memecoins, prove them on-chain, and sell them to people who want to run them.
        </p>
        <div className="pointer-events-auto mt-6 flex gap-3">
          <Link href="/sell"><Button>Put your work on the market</Button></Link>
          <a href="#market"><Button variant="secondary">See what&apos;s live</Button></a>
        </div>
        <div className="label mt-16 flex items-center gap-2"><span className="inline-block h-6 w-px animate-pulse bg-bone/40" />scroll to see how it works · tap an orbiting card to open it</div>
      </section>

      <Section step="01 · BUILD" accent="#ff6a3d" title="Ship something real." body="A token, a full project with code and a site, a community. The forge doesn't care how big it is, only that it exists and runs on Solana." />
      <Section step="02 · PROVE" accent="#3ee8ff" title="Let the chain vouch for you." body="Your wallet is verified as the on-chain owner before anything is listed. Supply, authorities, holder concentration and pump.fun status are read from chain and shown to every buyer. Pitch less, prove more." />
      <Section step="03 · GET BOUGHT" accent="#ffc260" title="Escrow. Both sides safe." body="A buyer pays SOL into escrow. Control transfers atomically for token authorities, or on verified handoff for pump.fun ownership and sites. You get paid, they get the keys, the work keeps living.">
        <Link href="/how-it-works"><Button variant="secondary">Read the escrow rules</Button></Link>
      </Section>

      {/* 4 · the market */}
      <section id="market" className="relative z-10 -mx-4 rounded-t-3xl border-t border-line bg-ink/95 px-4 py-12 backdrop-blur">
        {activity.length > 0 && (
          <div className="mb-8 overflow-hidden rounded border border-line bg-ink-2">
            <div className="flex animate-[ticker_40s_linear_infinite] gap-8 whitespace-nowrap px-4 py-2 text-xs text-mute hover:[animation-play-state:paused]">
              {[...activity, ...activity].map((a, i) => (
                <Link key={i} href={`/listings/${a.id}`} className="hover:text-white"><span className="text-lime">▮</span> {a.title} {VERB[a.kind] ?? a.kind} · {formatSol(a.priceLamports)} SOL</Link>
              ))}
            </div>
          </div>
        )}

        {builders.length > 0 && (
          <div className="mb-10">
            <h2 className="label mb-3 !text-bone">Builders on record</h2>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {builders.map((b) => (
                <Link key={b.wallet} href={`/builders/${b.wallet}`} className="min-w-[200px] rounded-md border border-line bg-ink-2 p-4 hover:border-lime/50">
                  <div className="flex items-center gap-2"><span className="h-3 w-3 rotate-45 bg-ember" /><span className="truncate font-semibold">{b.profile?.name || shortKey(b.wallet)}</span></div>
                  <div className="mt-2 text-xs text-white/55">{b.stats.listed} shipped · {b.stats.sold} sold · {formatSol(b.stats.earnedLamports, 1)} SOL</div>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-xl font-bold">On the market</h2>
          <select value={type} onChange={(e) => setType(e.target.value as ListingType | "")} className="rounded border border-line bg-black/30 px-3 py-1.5 text-sm">
            <option value="">All types</option>
            {(Object.keys(TYPE_LABELS) as ListingType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="rounded border border-line bg-black/30 px-3 py-1.5 text-sm">
            <option value="active">For sale</option>
            <option value="sold">Sold</option>
            <option value="all">Everything</option>
          </select>
        </div>
        {listings === null ? (
          <p className="text-white/50">Loading listings…</p>
        ) : listings.length === 0 ? (
          <div className="rounded-md border border-dashed border-line p-10 text-center text-white/50">
            Nothing here yet. <Link href="/sell" className="text-lime underline">Be the first to list.</Link>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">{listings.map((l) => <ListingCard key={l.id} l={l} />)}</div>
        )}
      </section>
    </div>
  );
}
