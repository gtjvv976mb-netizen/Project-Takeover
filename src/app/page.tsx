"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { useCountUp, useCycle, useReveal } from "@/lib/motion";
import { formatSol, shortKey, TYPE_LABELS, type BuilderProfile, type BuilderStats, type Listing, type ListingType } from "@/lib/types";
import { Button, Chip, ListingRow, Sigil, Stat } from "@/components/ui";
import { Tape } from "@/components/press/Tape";
import { SlotHeight, Vital } from "@/components/press/Vitals";

type Activity = { kind: string; at: number; id: string; title: string; priceLamports: number; type: Listing["type"] };
const VERB: Record<string, string> = { created: "listed", escrowed: "went live", paid: "funded", settled: "taken over", released: "taken over" };

const SELLS = ["a token you launched", "a pump.fun coin you created", "a site you built", "a community you grew", "the whole project"];

/* ------------------------------------------------------------------ hero */

function Masthead({ listings, builders }: { listings: Listing[]; builders: number }) {
  const ref = useReveal<HTMLDivElement>(0.05);
  const n = useCycle(SELLS.length, 2400);
  const live = listings.filter((l) => l.status === "active").length;
  const settled = listings.filter((l) => l.status === "sold").reduce((a, l) => a + l.priceLamports, 0);
  const liveCount = Math.round(useCountUp(live, 900));
  const settledSol = useCountUp(settled / 1e9, 1100);

  return (
    <section ref={ref} data-reveal className="border-b border-rule px-4 pb-10 pt-12 sm:px-6 sm:pt-16">
      <div className="mx-auto max-w-[1400px]">
        <div className="kicker flex items-center gap-2" style={{ ["--i" as string]: 0 }}>
          <span className="live-sq" /> Independent builders · verified on chain · escrowed handovers
        </div>

        <h1 className="h1 mt-5" style={{ ["--i" as string]: 1 }}>
          <span className="line"><span style={{ ["--i" as string]: 0 }}>Somebody built it.</span></span>
          <span className="line"><span style={{ ["--i" as string]: 1 }}>Now <span className="text-flare">take it over.</span></span></span>
        </h1>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1.5fr_1fr]" style={{ ["--i" as string]: 2 }}>
          <div>
            <div className="lead">
              A market for the projects independent developers actually made on Solana.
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                <span>Sell</span>
                <span className="roll font-medium text-ink">
                  <span className="roll-track" style={{ ["--n" as string]: n }}>
                    {SELLS.map((s) => <span key={s}>{s}</span>)}
                  </span>
                </span>
              </div>
              <div className="mt-1">The chain proves you own it. Escrow makes sure nobody gets robbed.</div>
            </div>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/sell"><Button>List your work</Button></Link>
              <a href="#market"><Button variant="secondary">See what&apos;s for sale</Button></a>
            </div>
          </div>

          <div className="border border-rule p-4">
            <Vital label="Solana slot" i={0}><SlotHeight /></Vital>
            <Vital label="For sale now" i={1}><span className="mono">{liveCount}</span></Vital>
            <Vital label="Settled volume" i={2}><span className="mono">{settledSol.toFixed(2)} SOL</span></Vital>
            <Vital label="Builders" i={3}><span className="mono">{builders}</span></Vital>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------- what's on the table */

const COLUMNS: { type: ListingType; n: string; blurb: string; proof: string }[] = [
  { type: "token_authority", n: "01", blurb: "Mint, freeze and metadata authority over an SPL token. The buyer's payment and the handover settle in one transaction, so neither side can be left holding nothing.", proof: "Atomic on-chain settlement" },
  { type: "pump_creator", n: "02", blurb: "The creator role on a pump.fun coin: creator fees and who receives them. Verified against the bonding curve before it can be listed, and again before the money moves.", proof: "Verified against the curve" },
  { type: "offchain", n: "03", blurb: "The whole thing. Code, domain, site, X account, Telegram, the community you grew. Funds sit in escrow until the buyer confirms delivery, and a dispute goes to a human.", proof: "Escrowed until delivered" },
];

function Table({ counts }: { counts: Record<ListingType, number> }) {
  const ref = useReveal<HTMLDivElement>(0.12);
  return (
    <section ref={ref} data-reveal className="border-b border-rule bg-ink text-paper">
      <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6">
        <h2 className="h2 text-paper" style={{ ["--i" as string]: 0 }}>What&apos;s on the table</h2>
        <div className="mt-10 grid gap-px bg-paper/15 md:grid-cols-3">
          {COLUMNS.map((c, i) => (
            <Link
              key={c.type}
              href={`/?type=${c.type}#market`}
              className="takeover takeover-flare group bg-ink p-6"
              style={{ ["--i" as string]: i + 1 }}
            >
              <div className="flex items-baseline justify-between">
                <span className="t-rank font-display text-[52px] leading-none text-paper/25">{c.n}</span>
                <span className="t-arrow font-display text-[26px]">→</span>
              </div>
              <h3 className="t-title mt-4 font-display text-[26px] uppercase leading-[0.95]">{TYPE_LABELS[c.type]}</h3>
              <p className="t-body mt-3 text-[14px] leading-relaxed text-paper/65">{c.blurb}</p>
              <div className="mt-5 flex items-center gap-2 border-t border-paper/15 pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-paper/50">
                <span className="text-ultra-lit">✓</span> {c.proof}
                <span className="ml-auto">{counts[c.type]} listed</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- market */

function Market({ listings }: { listings: Listing[] }) {
  const [type, setType] = useState<ListingType | "">("");
  const [status, setStatus] = useState<"active" | "sold" | "all">("active");
  const shown = useMemo(
    () => listings.filter((l) => (status === "all" || l.status === status) && (!type || l.type === type)),
    [listings, type, status],
  );
  return (
    <section id="market" className="scroll-mt-16 border-b border-rule">
      <div className="mx-auto max-w-[1400px] px-4 pb-16 pt-14 sm:px-6">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-rule pb-4">
          <h2 className="h2">The market</h2>
          <span className="kicker mb-2">{shown.length} {shown.length === 1 ? "entry" : "entries"}</span>
          <div className="mb-1 ml-auto flex flex-wrap gap-2">
            <select value={type} onChange={(e) => setType(e.target.value as ListingType | "")}
              className="border border-rule bg-paper px-2.5 py-2 font-mono text-[11px] uppercase tracking-[0.12em]">
              <option value="">All types</option>
              {(Object.keys(TYPE_LABELS) as ListingType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}
              className="border border-rule bg-paper px-2.5 py-2 font-mono text-[11px] uppercase tracking-[0.12em]">
              <option value="active">For sale</option>
              <option value="sold">Taken over</option>
              <option value="all">Everything</option>
            </select>
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="border-b border-rule py-16 text-center">
            <div className="numeral">00</div>
            <p className="lead mx-auto mt-4">Nothing listed under that filter yet.</p>
            <Link href="/sell" className="mt-6 inline-block"><Button>Be the first entry</Button></Link>
          </div>
        ) : (
          <div className="border-t border-rule">
            {shown.map((l, i) => <ListingRow key={l.id} l={l} rank={i + 1} />)}
          </div>
        )}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- builders */

function Builders({ builders }: { builders: { wallet: string; profile: BuilderProfile | null; stats: BuilderStats }[] }) {
  const ref = useReveal<HTMLDivElement>(0.12);
  if (!builders.length) return null;
  return (
    <section ref={ref} data-reveal className="border-b border-rule">
      <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6">
        <h2 className="h2" style={{ ["--i" as string]: 0 }}>Builders on record</h2>
        <p className="lead mt-3" style={{ ["--i" as string]: 1 }}>
          A wallet is a résumé you cannot fake. Every listing is tied to the wallet the chain says owns it.
        </p>
        <div className="mt-8 grid gap-px bg-rule-soft sm:grid-cols-2 lg:grid-cols-4" style={{ ["--i" as string]: 2 }}>
          {builders.slice(0, 8).map((b) => (
            <Link key={b.wallet} href={`/builders/${b.wallet}`} className="takeover bg-paper p-5">
              <div className="flex items-center gap-3">
                <Sigil wallet={b.wallet} />
                <span className="t-title min-w-0 truncate font-display text-[19px] uppercase">
                  {b.profile?.name || shortKey(b.wallet, 4)}
                </span>
              </div>
              <div className="t-kicker mt-4 flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
                <span>{b.stats.listed} made</span>
                <span>{b.stats.sold} sold</span>
                <span className="t-price ml-auto font-display text-[20px] normal-case tracking-normal text-ink">
                  {formatSol(b.stats.earnedLamports, 1)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- closer */

function Closer({ total }: { total: number }) {
  const ref = useReveal<HTMLDivElement>(0.15);
  return (
    <section ref={ref} data-reveal className="bg-flare text-ink">
      <div className="mx-auto max-w-[1400px] px-4 py-16 sm:px-6">
        <h2 className="h1" style={{ ["--i" as string]: 0 }}>
          <span className="line"><span>You made it.</span></span>
          <span className="line"><span>Somebody wants it.</span></span>
        </h2>
        <div className="mt-10 grid gap-8 md:grid-cols-[1fr_auto] md:items-end" style={{ ["--i" as string]: 1 }}>
          <p className="max-w-[52ch] text-[17px] leading-relaxed">
            Put a price on the work instead of abandoning it. Escrow protects both sides, the chain does the
            verifying, and the platform takes 2% only when a deal actually settles.
          </p>
          <Link href="/sell" className="hard inline-flex shrink-0 items-center border border-ink bg-paper px-7 py-4 font-mono text-[12px] uppercase tracking-[0.16em]">
            List your work →
          </Link>
        </div>
        <div className="mt-12 grid grid-cols-2 gap-6 border-t border-ink/25 pt-6 sm:grid-cols-4" style={{ ["--i" as string]: 2 }}>
          <Stat value={total} label="Entries all time" on="flare" />
          <Stat value="2%" label="Platform fee" on="flare" />
          <Stat value="0" label="Private keys sold" on="flare" />
          <Stat value="1 tx" label="Token handover" on="flare" />
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------- page */

export default function Home() {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [builders, setBuilders] = useState<{ wallet: string; profile: BuilderProfile | null; stats: BuilderStats }[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);

  useEffect(() => {
    let off = false;
    api.listings({ status: "all" }).then((l) => !off && setListings(l)).catch(() => !off && setListings([]));
    fetch("/api/builders").then((r) => r.json()).then((b) => !off && setBuilders(b)).catch(() => {});
    fetch("/api/activity").then((r) => r.json()).then((a) => !off && setActivity(a)).catch(() => {});
    return () => { off = true; };
  }, []);

  const all = listings ?? [];
  const counts = useMemo(() => {
    const c: Record<ListingType, number> = { token_authority: 0, pump_creator: 0, offchain: 0 };
    for (const l of all) if (l.status === "active") c[l.type]++;
    return c;
  }, [all]);

  const tapeItems = activity.length
    ? activity.map((a) => `${a.title} ${VERB[a.kind] ?? a.kind} · ${formatSol(a.priceLamports)} SOL`)
    : ["The market is open", "Escrow is live", "List the work you already built", "The chain does the verifying"];

  return (
    <>
      <Masthead listings={all} builders={builders.length} />

      <div className="border-b border-rule bg-paper-2 py-2.5">
        <Tape speed={44}>
          {tapeItems.map((t, i) => (
            <span key={i} className="flex items-center gap-3 whitespace-nowrap px-5 font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
              <span className="live-sq" style={{ ["--i" as string]: i }} />{t}
            </span>
          ))}
        </Tape>
      </div>

      <Table counts={counts} />

      {listings === null ? (
        <section className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6">
          <div className="border-t border-rule">
            {[0, 1, 2, 3].map((i) => <div key={i} className="ghost my-4 h-14 w-full" />)}
          </div>
        </section>
      ) : (
        <Market listings={all} />
      )}

      <Builders builders={builders} />
      <Closer total={all.length} />
    </>
  );
}
