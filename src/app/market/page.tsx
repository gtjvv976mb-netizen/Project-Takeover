"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { formatSol, shortKey, TYPE_LABELS, type BuilderProfile, type BuilderStats, type Listing, type ListingType } from "@/lib/types";
import { ListingCard, Button } from "@/components/ui";

type Activity = { kind: string; at: number; id: string; title: string; priceLamports: number; type: Listing["type"] };
const VERB: Record<string, string> = { created: "listed", escrowed: "moored", paid: "in the lock", settled: "taken over", released: "taken over" };

/** The plain list, for anyone who would rather read a table than walk the quay. */
export default function Market() {
  const [type, setType] = useState<ListingType | "">("");
  const [status, setStatus] = useState<"active" | "sold" | "all">("active");
  const [data, setData] = useState<{ key: string; items: Listing[] } | null>(null);
  const [builders, setBuilders] = useState<{ wallet: string; profile: BuilderProfile | null; stats: BuilderStats }[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const key = `${status}|${type}`;
  const listings = data?.key === key ? data.items : null;

  useEffect(() => {
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
    <div className="space-y-8">
      <header className="flex flex-wrap items-end gap-3">
        <div>
          <div className="label !text-amber">the register</div>
          <h1 className="mt-1 text-3xl font-bold">Every vessel in the harbour</h1>
        </div>
        <Link href="/" className="ml-auto"><Button variant="secondary">Walk the quay instead →</Button></Link>
      </header>

      {activity.length > 0 && (
        <div className="overflow-hidden rounded-sm border border-line bg-ink-2">
          <div className="flex animate-[ticker_40s_linear_infinite] gap-8 whitespace-nowrap px-4 py-2 text-xs text-mute hover:[animation-play-state:paused]">
            {[...activity, ...activity].map((a, i) => (
              <Link key={i} href={`/listings/${a.id}`} className="hover:text-bone"><span className="text-lime">▮</span> {a.title} {VERB[a.kind] ?? a.kind} · {formatSol(a.priceLamports)} SOL</Link>
            ))}
          </div>
        </div>
      )}

      {builders.length > 0 && (
        <section>
          <h2 className="label mb-3 !text-bone">Builders on record</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {builders.map((b) => (
              <Link key={b.wallet} href={`/builders/${b.wallet}`} className="hud min-w-[200px] rounded-sm border border-line bg-ink-2 p-4 hover:border-amber/50">
                <div className="flex items-center gap-2"><span className="h-3 w-3 rotate-45 bg-ember" /><span className="truncate font-semibold">{b.profile?.name || shortKey(b.wallet)}</span></div>
                <div className="mt-2 text-xs text-mute">{b.stats.listed} shipped · {b.stats.sold} sold · {formatSol(b.stats.earnedLamports, 1)} SOL</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-bold">On the market</h2>
        <select value={type} onChange={(e) => setType(e.target.value as ListingType | "")} className="rounded-sm border border-line bg-ink px-3 py-1.5 text-sm">
          <option value="">All piers</option>
          {(Object.keys(TYPE_LABELS) as ListingType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="rounded-sm border border-line bg-ink px-3 py-1.5 text-sm">
          <option value="active">Moored, for sale</option>
          <option value="sold">Taken over</option>
          <option value="all">Everything</option>
        </select>
      </div>

      {listings === null ? (
        <p className="text-mute">Reading the register…</p>
      ) : listings.length === 0 ? (
        <div className="rounded-sm border border-dashed border-line p-10 text-center text-mute">
          No vessels here yet. <Link href="/sell" className="text-lime underline">Launch the first one.</Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">{listings.map((l) => <ListingCard key={l.id} l={l} />)}</div>
      )}
    </div>
  );
}
