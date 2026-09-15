"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { useCountUp, useReveal } from "@/lib/motion";
import { formatSol, REQUEST_CATEGORY_LABELS, shortKey, type BuildRequest, type BuilderCard, type Listing, type ListingType } from "@/lib/types";
import { Button, Chip, ListingCard, Sigil, TYPE_TINT } from "@/components/ui";
import { Stars } from "@/components/Reputation";
import { SlotHeight } from "@/components/SlotHeight";
import { useConfig } from "@/components/ConfigContext";

/**
 * The front page, laid out for the two people who arrive at it.
 *
 * Half of them build things and want to sell one, answer a request, or be found. The
 * other half need something built — an app, a site, a game, a coin — and have never
 * seen a wallet do anything but hold tokens. The old page spoke to the first group and
 * hoped the second would work it out. This one gives each a door with their own name on
 * it, then shows both the same three things: work waiting for a builder, projects for
 * sale, and the people who ship.
 */

type Activity = { kind: string; at: number; id: string; title: string; priceLamports: number; type: Listing["type"] };
const VERB: Record<string, string> = { created: "listed", escrowed: "went live", paid: "funded", settled: "sold", released: "sold" };

/* --------------------------------------------------------------------- hero */

function Hero({ live, open, builders }: { live: number; open: number; builders: number }) {
  return (
    <section className="relative overflow-hidden border-b border-line">
      <div className="blueprint" aria-hidden />

      <div className="wrap relative z-10 py-14 md:py-20">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_.95fr]">
          {/* ---- the pitch ---- */}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="pill" style={{ ["--tint" as string]: "var(--color-green)" }}>
                <span className="live-dot" /> Escrow on Solana
              </span>
              {(live > 0 || open > 0) && (
                <span className="text-[13.5px] text-muted">
                  {open > 0 && <>{open} {open === 1 ? "request" : "requests"} open</>}
                  {open > 0 && live > 0 && " · "}
                  {live > 0 && <>{live} {live === 1 ? "project" : "projects"} for sale</>}
                </span>
              )}
            </div>

            <h1 className="display mt-5">
              You dream it.{" "}
              <span style={{ background: "linear-gradient(96deg, var(--color-brand), var(--color-brand-2))", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
                Devs build it.
              </span>
            </h1>

            <p className="lead mt-5">
              A workshop for Solana. Hire a developer to build your app, site, game or coin —
              or sell the one you already shipped. The money sits in escrow until the work
              lands, so two strangers can do business on day one.
            </p>

            {/* The three guarantees, in the order a nervous buyer asks about them. Each
                one is a mechanism, not a promise — see the facts strip for the detail. */}
            <ul className="mt-6 space-y-2 text-[14.5px] text-body">
              {[
                ["Your SOL is held by a program, not by us.", "Nobody has a key to it — including this site."],
                ["Not delivered? You get it back.", "After the deadline the refund needs nobody's permission."],
                ["Reputation you can't buy.", "A review exists only where a settled deal does."],
              ].map(([lead, rest]) => (
                <li key={lead} className="flex gap-2.5">
                  <span className="mt-[3px] grid h-[18px] w-[18px] flex-none place-items-center rounded-full text-[11px] font-bold"
                    style={{ background: "color-mix(in srgb, var(--color-green) 16%, var(--color-tint-base))", color: "var(--color-green)" }} aria-hidden>✓</span>
                  <span><strong className="font-semibold text-ink">{lead}</strong> {rest}</span>
                </li>
              ))}
            </ul>

            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-muted">
              {builders > 0 && <span><strong className="text-ink">{builders}</strong> {builders === 1 ? "builder" : "builders"} on the board</span>}
              <span className="inline-flex items-center gap-1.5"><span className="live-dot" /> Solana slot <SlotHeight /></span>
            </div>
          </div>

          {/* ---- the two doors ---- */}
          <div className="grid gap-4">
            <Door
              accent="var(--color-teal)"
              icon="🧰"
              title="I need something built"
              blurb="Describe it, set a budget, and let developers come to you. You only put money in escrow once you've picked someone."
              links={[
                ["Post a request", "/requests#post"],
                ["Find a builder", "/builders"],
                ["Buy a finished project", "#market"],
              ]}
            />
            <Door
              accent="var(--color-brand)"
              icon="🛠️"
              title="I build things"
              blurb="Sell what you shipped, or pick up paid work. Your wallet is your CV — every settled deal adds to it."
              links={[
                ["List a project for sale", "/sell"],
                ["Browse open requests", "/requests"],
                ["Set up your builder profile", "/builders"],
              ]}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function Door({ accent, icon, title, blurb, links }: {
  accent: string; icon: string; title: string; blurb: string; links: [string, string][];
}) {
  return (
    <div className="door" style={{ ["--accent" as string]: accent }}>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl text-[19px]"
          style={{ background: `color-mix(in srgb, ${accent} 14%, var(--color-tint-base))` }} aria-hidden>{icon}</span>
        <h2 className="title-md">{title}</h2>
      </div>
      <p className="text-[14.5px] leading-relaxed text-muted">{blurb}</p>
      <div className="grid gap-1.5">
        {links.map(([label, href]) => (
          href.startsWith("#")
            ? <a key={label} href={href} className="door-link"><span>{label}</span><span aria-hidden>→</span></a>
            : <Link key={label} href={href} className="door-link"><span>{label}</span><span aria-hidden>→</span></Link>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ facts */

/**
 * Dense, checkable, and deliberately unglamorous. A developer reads these and decides
 * whether the site is serious; a buyer reads them and decides whether their money is
 * safe. Every line names a mechanism rather than a feeling.
 */
function Facts({ feeBps, programId }: { feeBps: number; programId: string }) {
  const ref = useReveal<HTMLDivElement>(0.1);
  const facts: { icon: string; tint: string; head: string; body: string }[] = [
    { icon: "🔐", tint: "var(--color-green)", head: "Money waits in code",
      body: "A buyer's SOL goes to an account the escrow program owns. No person — not the seller, not us — holds a key to it." },
    { icon: "↩️", tint: "var(--color-blue)", head: "Refunds need no permission",
      body: "Past the delivery deadline, anyone can trigger the refund. You never have to ask the seller, or us." },
    { icon: "⚖️", tint: "var(--color-violet)", head: "Disputes can only go two ways",
      body: "An arbitrator picks the buyer or the seller. It cannot pay itself. If it stays silent 14 days, the buyer takes their money back." },
    { icon: "🧾", tint: "var(--color-amber)", head: `${feeBps / 100}% fee, seller side, capped on chain`,
      body: "Taken only when a deal settles. The program refuses anything above 5%, whoever asks." },
  ];
  return (
    <section className="border-b border-line bg-bg-2/60">
      <div className="wrap py-8">
        <div ref={ref} data-reveal className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {facts.map((f, i) => (
            <div key={f.head} className="fact" style={{ ["--i" as string]: i, ["--tint" as string]: f.tint }}>
              <span className="fact-icon" aria-hidden>{f.icon}</span>
              <span>
                <span className="block text-[14.5px] font-bold text-ink">{f.head}</span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">{f.body}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-faint">
          Escrow program <span className="mono text-muted">{programId}</span> — check it yourself.
        </p>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- requests */

const REQ_TINT: Record<BuildRequest["status"], string> = {
  open: "var(--color-green)", awarded: "var(--color-blue)", cancelled: "var(--color-faint)",
};

/**
 * The buyer-side heartbeat, which the front page never showed before. A developer
 * arriving sees there is paid work here; a buyer sees what other people ask for and
 * what they offer, which is the guidance most of them wanted before posting.
 */
function OpenRequests({ requests, loading }: { requests: BuildRequest[]; loading: boolean }) {
  const ref = useReveal<HTMLDivElement>(0.1);
  const shown = requests.slice(0, 4);
  return (
    <section className="wrap py-14">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="kicker">For builders</div>
          <h2 className="title-lg mt-1">Work waiting for someone</h2>
          <p className="mt-1.5 max-w-xl text-[15px] text-muted">
            People post what they need and what they&rsquo;d pay. Send a proposal; if they pick you,
            the escrow opens and you build.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/requests"><Button variant="secondary">See all requests</Button></Link>
          <Link href="/requests#post"><Button>Post a request</Button></Link>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-44" />)}</div>
      ) : shown.length === 0 ? (
        <div className="note flex flex-wrap items-center justify-between gap-4" style={{ ["--tint" as string]: "var(--color-teal)" }}>
          <div>
            <div className="text-[16px] font-bold text-ink">Nobody has asked for anything yet.</div>
            <div className="text-[14px] text-muted">The first request gets every builder&rsquo;s attention. Posting is free and moves no money.</div>
          </div>
          <Link href="/requests#post"><Button>Be the first</Button></Link>
        </div>
      ) : (
        <div ref={ref} data-reveal className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {shown.map((r, i) => (
            <Link key={r.id} href={`/requests/${r.id}`} style={{ ["--i" as string]: i, ["--accent" as string]: "var(--color-teal)" }}
              className="card card-hover flex flex-col gap-3 p-5">
              <div className="flex flex-wrap gap-1.5">
                <Chip tint="var(--color-teal)">{REQUEST_CATEGORY_LABELS[r.category]}</Chip>
                <Chip tint={REQ_TINT[r.status]}>{r.status === "open" ? "Taking proposals" : r.status === "awarded" ? "Awarded" : "Withdrawn"}</Chip>
              </div>
              <h3 className="text-[17px] font-bold leading-snug text-ink">{r.title}</h3>
              <p className="clamp-2 text-[13.5px] leading-relaxed text-muted">{r.brief}</p>
              <div className="mt-auto flex items-end justify-between border-t border-line pt-3">
                <div>
                  <div className="kicker mb-0.5">Budget</div>
                  <div className="price">{formatSol(r.budgetLamports)} <span className="text-[13px] font-semibold text-muted">SOL</span></div>
                </div>
                <div className="text-right text-[12.5px] text-muted">
                  <div>{r.proposalCount} {r.proposalCount === 1 ? "proposal" : "proposals"}</div>
                  <div className="text-faint">in {r.deliveryDays}d</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------- market */

function Market({ listings, type, setType, status, setStatus, loading }: {
  listings: Listing[];
  type: ListingType | ""; setType: (t: ListingType | "") => void;
  status: "active" | "sold" | "all"; setStatus: (s: "active" | "sold" | "all") => void;
  loading: boolean;
}) {
  const [query, setQuery] = useState("");
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
    <section id="market" className="scroll-mt-20 border-y border-line bg-surface">
      <div className="wrap py-14">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="kicker">For buyers</div>
            <h2 className="title-lg mt-1">Projects for sale</h2>
            <p className="mt-1.5 max-w-xl text-[15px] text-muted">
              Finished things looking for their next owner: tokens, pump.fun coins, whole sites.
              The keys and the money change hands together.
            </p>
          </div>
          <Link href="/sell"><Button variant="secondary">List yours</Button></Link>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="seg">
            {([["", "All"], ["token_authority", "Tokens"], ["pump_creator", "pump.fun"], ["offchain", "Projects & sites"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setType(v as ListingType | "")} aria-pressed={type === v}>{label}</button>
            ))}
          </div>
          <div className="seg">
            {([["active", "For sale"], ["sold", "Sold"], ["all", "Everything"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setStatus(v)} aria-pressed={status === v}>{label}</button>
            ))}
          </div>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, ticker or builder…"
            aria-label="Search projects" className="input !w-auto min-w-[240px] flex-1 !py-2 text-[14px] sm:flex-none" />
          <span className="kicker ml-auto">{shown.length} {shown.length === 1 ? "result" : "results"}</span>
        </div>

        {loading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card overflow-hidden">
                <div className="skeleton aspect-[16/10] !rounded-none" />
                <div className="space-y-3 p-4">
                  <div className="skeleton h-4 w-24" /><div className="skeleton h-5 w-3/4" /><div className="skeleton h-4 w-full" /><div className="skeleton h-8 w-28" />
                </div>
              </div>
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="note grid place-items-center px-6 py-16 text-center">
            <div className="text-4xl" aria-hidden>🗂️</div>
            <h3 className="mt-3 text-[19px] font-bold text-ink">Nothing here yet</h3>
            <p className="mt-1.5 max-w-sm text-[15px] text-muted">
              {query || type ? "Try a different search, or clear the filters." : "Be the first to put a project up for sale."}
            </p>
            <Link href="/sell" className="mt-4"><Button>List your project</Button></Link>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map((l) => <ListingCard key={l.id} l={l} />)}
          </div>
        )}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- builders */

function Builders({ builders }: { builders: BuilderCard[] }) {
  const ref = useReveal<HTMLDivElement>(0.12);
  if (!builders.length) return null;
  return (
    <section className="wrap py-14">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="kicker">For buyers</div>
          <h2 className="title-lg mt-1">People who ship</h2>
          <p className="mt-1.5 max-w-xl text-[15px] text-muted">
            Nobody signs up here. You appear by doing things — listing, delivering, answering — and
            a rating exists only where a settled deal does.
          </p>
        </div>
        <Link href="/builders"><Button variant="secondary">Browse all builders</Button></Link>
      </div>
      <div ref={ref} data-reveal className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {builders.slice(0, 8).map((b, i) => (
          <Link key={b.wallet} href={`/builders/${b.wallet}`} style={{ ["--i" as string]: i }} className="card card-hover flex flex-col gap-3 p-4">
            <div className="flex items-center gap-3">
              <Sigil wallet={b.wallet} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold text-ink">{b.profile?.name || shortKey(b.wallet, 4)}</span>
                {b.reputation?.averageRating != null ? (
                  <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
                    <Stars rating={b.reputation.averageRating} size={12} /> {b.reputation.averageRating.toFixed(1)}
                  </span>
                ) : b.profile?.openToWork ? (
                  <span className="text-[12.5px] font-semibold" style={{ color: "var(--color-green)" }}>Open to work</span>
                ) : (
                  <span className="text-[12.5px] text-faint">{shortKey(b.wallet, 4)}</span>
                )}
              </span>
            </div>
            {(b.profile?.skills ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {b.profile!.skills.slice(0, 3).map((s) => <Chip key={s}>{s}</Chip>)}
              </div>
            )}
            <div className="mt-auto text-[13px] text-muted">
              {b.stats.sold} sold{b.commissions > 0 && ` · ${b.commissions} commissioned`}
              {b.stats.earnedLamports > 0 && ` · ${formatSol(b.stats.earnedLamports, 1)} SOL`}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- how it works */

type Step = { title: string; body: string; note?: string };

/**
 * Written from the reader's chair: what you click, what your wallet asks you to sign,
 * what you get. Three journeys now, because commissioning is half the site and the
 * old two tabs left it out.
 */
const JOURNEYS: { key: string; tab: string; who: string; tint: string; steps: Step[]; safety: string[] }[] = [
  {
    key: "commission",
    tab: "I need something built",
    who: "Posting takes two minutes and moves no money.",
    tint: "var(--color-teal)",
    steps: [
      { title: "Say what you need", body: "A title, a brief, a budget and a deadline. Say what done looks like — the clearer the brief, the better the proposals and the fewer the arguments." },
      { title: "Developers propose", body: "Each one says how they would build it, what they would charge and how long it would take. You can see their track record on their builder page." },
      { title: "Pick one and fund the escrow", body: "The developer you choose opens an escrow for the agreed price. You pay into it — an account the program owns, that nobody holds a key to.", note: "Until you fund it, nothing has happened. Until you release it, the developer has not been paid." },
      { title: "They deliver, you release", body: "Once you have what you asked for, you release the SOL. That last step is yours alone." },
    ],
    safety: [
      "Delivery deadline passed and nothing arrived? The refund is permissionless — you take your money back without asking anyone.",
      "Something off? Open a dispute. The funds freeze, an arbitrator picks between the two of you, and if it goes quiet for 14 days you get your money back regardless.",
    ],
  },
  {
    key: "sell",
    tab: "I built something to sell",
    who: "Listing takes about five minutes.",
    tint: "var(--color-brand)",
    steps: [
      { title: "Connect your wallet", body: "No sign-up and no password. Your wallet is your account, and it is also your proof — the site reads the chain to see what you actually control." },
      { title: "Say what you are selling", body: "Paste a mint address, or describe the project, site or community. Add pictures, a description and a price in SOL.", note: "For a token the chain is checked right then. If your wallet does not hold those controls, the listing is refused." },
      { title: "Open the escrow", body: "One signature creates the on-chain account a buyer's money goes into. For a token sale, each control you are selling moves into the program's custody too." },
      { title: "Get paid", body: "For a token, the SOL lands the moment someone buys. For anything else, you hand it over, the buyer confirms, and you are paid." },
    ],
    safety: [
      "Changed your mind? Cancel any time before it sells and every control comes straight back to you.",
      "You are never left having handed something over with no payment. The buyer's money is locked before you deliver.",
    ],
  },
  {
    key: "buy",
    tab: "I want to buy a project",
    who: "Buying is one click and one signature.",
    tint: "var(--color-violet)",
    steps: [
      { title: "Check the proof", body: "Every listing shows what the chain says, not what the seller claims: supply, which controls exist, who holds them, holder concentration." },
      { title: "Buy", body: "The price is fixed and shown up front. Your wallet shows exactly what you are approving before you sign." },
      { title: "Get the keys", body: "For a token, the same transaction that takes your SOL puts the controls in your wallet. You own it before the transaction finishes.", note: "For a pump.fun coin or a whole project, your SOL goes into escrow instead, and the seller hands over ownership, the repo, the domain." },
      { title: "Release", body: "Once you have it, you release the funds. Tokens skip this — there is nothing to release, you already have it." },
    ],
    safety: [
      "If a seller takes your money and vanishes, you get it back after the deadline. You do not need the seller, or us, to cooperate.",
      "Freeze the deal in dispute at any point. The arbitrator can only pick you or the seller — it cannot redirect your money anywhere else.",
    ],
  },
];

function HowItWorks() {
  const [key, setKey] = useState(JOURNEYS[0].key);
  const ref = useReveal<HTMLDivElement>(0.06);
  const j = JOURNEYS.find((x) => x.key === key) ?? JOURNEYS[0];

  return (
    <section id="how" className="scroll-mt-20 border-y border-line bg-surface">
      <div className="wrap py-14">
        <div className="mx-auto max-w-2xl text-center">
          <div className="kicker">Step by step</div>
          <h2 className="title-lg mt-2">What actually happens</h2>
        </div>

        <div className="mt-6 flex justify-center">
          <div className="seg flex-wrap justify-center">
            {JOURNEYS.map((x) => (
              <button key={x.key} onClick={() => setKey(x.key)} aria-pressed={x.key === key}>{x.tab}</button>
            ))}
          </div>
        </div>
        <p className="mt-4 text-center text-[15px] text-muted">{j.who}</p>

        <div key={j.key} ref={ref} data-reveal className="mx-auto mt-8 grid max-w-5xl gap-4 md:grid-cols-2">
          {j.steps.map((step, i) => (
            <div key={step.title} style={{ ["--i" as string]: i }} className="flex gap-4 rounded-2xl border border-line bg-bg p-5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[15px] font-bold"
                style={{ background: `color-mix(in srgb, ${j.tint} 16%, var(--color-tint-base))`, color: j.tint }} aria-hidden>
                {i + 1}
              </span>
              <div className="min-w-0">
                <h3 className="text-[17px] font-bold leading-snug text-ink">{step.title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{step.body}</p>
                {step.note && (
                  <p className="mt-2.5 border-l-2 pl-3 text-[13px] leading-relaxed text-faint" style={{ borderColor: j.tint }}>{step.note}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-6 max-w-5xl rounded-2xl border border-line bg-bg p-6">
          <div className="kicker mb-3">If it goes wrong</div>
          <ul className="grid gap-2.5 md:grid-cols-2">
            {j.safety.map((line) => (
              <li key={line} className="flex gap-2.5 text-[14px] leading-relaxed text-muted">
                <span aria-hidden style={{ color: "var(--color-green)" }}>✓</span><span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 text-center">
          <Link href="/how-it-works"><Button variant="secondary">The long version, including what you are still trusting</Button></Link>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------- page */

export default function Home() {
  const cfg = useConfig();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [requests, setRequests] = useState<BuildRequest[] | null>(null);
  const [builders, setBuilders] = useState<BuilderCard[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [type, setType] = useState<ListingType | "">("");
  const [status, setStatus] = useState<"active" | "sold" | "all">("active");

  useEffect(() => {
    let off = false;
    api.listings({ status: "all" }).then((l) => !off && setListings(l)).catch(() => !off && setListings([]));
    api.requests({ status: "open" }).then((r) => !off && setRequests(r)).catch(() => !off && setRequests([]));
    fetch("/api/builders").then((r) => r.json()).then((b) => !off && setBuilders(Array.isArray(b) ? b : [])).catch(() => {});
    fetch("/api/activity").then((r) => r.json()).then((a) => !off && setActivity(Array.isArray(a) ? a : [])).catch(() => {});
    return () => { off = true; };
  }, []);

  const all = useMemo(() => listings ?? [], [listings]);
  const live = all.filter((l) => l.status === "active").length;
  const liveCount = Math.round(useCountUp(live, 700));

  return (
    <>
      <Hero live={liveCount} open={requests?.length ?? 0} builders={builders.length} />

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

      <Facts feeBps={cfg.feeBps} programId={cfg.programId} />
      <OpenRequests requests={requests ?? []} loading={requests === null} />
      <Market listings={all} type={type} setType={setType} status={status} setStatus={setStatus} loading={listings === null} />
      <Builders builders={builders} />
      <HowItWorks />
    </>
  );
}
