"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { api, removeListingImage, signedPost, uploadListingImage, type DomainProofResult, type Handover } from "@/lib/client/api";
import { buyTokenOnChain, cancelOnChain, createListingOnChain, disputeOnChain, fundOnChain, refundOnChain, releaseOnChain } from "@/lib/client/program";
import { explorerUrl, useConfig } from "@/components/ConfigContext";
import { Alert, Button, Chip, inputCls, StatusBadge, TokenAvatar, TypeBadge } from "@/components/ui";
import { CoverArt } from "@/components/CoverArt";
import { CoverPicker } from "@/components/CoverPicker";
import { prepareImage } from "@/lib/client/image";
import { ACCEPT_ATTR } from "@/lib/uploads-shared";
import { formatSol, OFFCHAIN_CATEGORY_LABELS, shortKey, type Listing, type ListingEvent, type OffchainAsset, type PumpCreatorAsset, type Review, type TokenAuthorityAsset } from "@/lib/types";
import { BuilderChip } from "@/components/Builder";

/**
 * A listing, laid out as the deal it is.
 *
 * The page used to be a long left column of facts beside a sidebar that had become a
 * junk drawer: the price, a review form, an escrow warning, a buy button, a banner
 * uploader, a cancel button and a report box, all stacked at the same weight with no
 * indication of which one this particular reader wanted. Nobody could tell at a glance
 * where a deal had got to or whose turn it was.
 *
 * So the page now answers three questions in order, and everything else is subordinate to
 * them: what is this (cover and title), where has it got to (the rail), and what do I do
 * about it (one action panel, addressed to whoever is reading). Seller housekeeping is
 * real but rarely wanted, so it is folded away rather than mixed in with the deal.
 */

/* ------------------------------------------------------------ small pieces */

function Section({ title, tint, children }: { title: string; tint?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="kicker mb-3" style={tint ? { color: tint } : undefined}>{title}</h2>
      {children}
    </section>
  );
}

type Step = { label: string; state: "done" | "current" | "todo" | "failed" };

/**
 * Where the deal has got to. Only states the chain or the index can actually prove are
 * steps — "the seller has delivered" is not one of them, because nothing observable says
 * so until the buyer releases.
 */
function Rail({ steps }: { steps: Step[] }) {
  const tint = (s: Step["state"]) =>
    s === "failed" ? "var(--color-rose)" : s === "done" ? "var(--color-green)" : s === "current" ? "var(--color-brand)" : "var(--color-line)";
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-3">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-2">
          <span className="flex items-center gap-2 whitespace-nowrap">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold"
              style={{
                background: s.state === "todo" ? "transparent" : tint(s.state),
                border: `1.5px solid ${tint(s.state)}`,
                color: s.state === "todo" ? "var(--color-faint)" : "var(--color-bg)",
              }}>
              {s.state === "done" ? "✓" : s.state === "failed" ? "!" : i + 1}
            </span>
            <span className="text-[13.5px] font-semibold"
              style={{ color: s.state === "todo" ? "var(--color-faint)" : s.state === "current" ? "var(--color-ink)" : "var(--color-muted)" }}>
              {s.label}
            </span>
          </span>
          {i < steps.length - 1 && <span className="h-px w-6 shrink-0" style={{ background: "var(--color-line)" }} aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

/** How long is left on the delivery window, in the largest unit that still says something. */
function remaining(seconds: number): string {
  if (seconds <= 0) return "passed";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

/* --------------------------------------------------------------- the page */

export default function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const wallet = useWallet();
  const { connection } = useConnection();
  const cfg = useConfig();
  const me = wallet.publicKey?.toBase58();
  const [l, setL] = useState<Listing | null>(null);
  const [events, setEvents] = useState<ListingEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [note, setNote] = useState("");
  /** For pump.fun listings: who holds the creator role right now, read live and resolved through any fee split. */
  const [handover, setHandover] = useState<Handover | null>(null);
  /** For off-chain listings: whether the seller has proven control of a domain they link to. */
  const [proof, setProof] = useState<DomainProofResult | null>(null);
  const [reports, setReports] = useState<number>(0);
  const [reportReason, setReportReason] = useState("");
  /** Deadline comes from the chain, not the index, so a stale row cannot hide a refund. */
  const [deadline, setDeadline] = useState<number | null>(null);
  /**
   * Whether the program actually has this listing. Null until the first sync answers.
   * An absent account means one of two things — never opened, or opened and later closed
   * to reclaim its rent — so it only means "not open" while the deal is still live.
   */
  const [onChain, setOnChain] = useState<boolean | null>(null);
  /** Ticks so the refund button appears the moment the window closes. */
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);
  const [reason, setReason] = useState("");
  /** Set once the deal has settled and this wallet was one of its two parties. */
  const [myReview, setMyReview] = useState<Review | null>(null);
  const [rating, setRating] = useState(0);
  const [reviewBody, setReviewBody] = useState("");
  /** Kept apart from `error`, which lives in the sidebar: a cover problem belongs at the cover. */
  const [coverError, setCoverError] = useState<string | null>(null);
  const [coverNote, setCoverNote] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await api.listing(id);
    setL(r.listing);
    setEvents(r.events);
    if (r.listing.type === "pump_creator") api.handover(id).then(setHandover).catch(() => setHandover(null));
    if (r.listing.type === "offchain") api.domainProof(id).then(setProof).catch(() => setProof(null));
    api.reports(id).then((x) => setReports(x.reports)).catch(() => {});
    // Only ask for the reviewer's own row once there is a settled deal to have one on.
    if (me && (r.listing.status === "sold" || r.listing.status === "refunded")) {
      fetch(`/api/listings/${id}/review`).then((x) => x.json())
        .then((rows: Review[]) => {
          const mine = Array.isArray(rows) ? rows.find((v) => v.reviewer === me) ?? null : null;
          setMyReview(mine);
          if (mine) { setRating(mine.rating); setReviewBody(mine.body); }
        })
        .catch(() => {});
    }
    // refresh the authoritative state from the program itself
    try {
      const chain = await fetch(`/api/listings/${id}/sync`, { method: "POST" }).then((x) => x.json());
      setOnChain(chain?.onChain === true);
      if (chain?.onChain) {
        setDeadline(chain.deadline || null);
        if (chain.listing) setL(chain.listing);
      }
    } catch { /* index still renders without it */ }
    // `me` is read above, so it belongs here: without it, connecting a wallet after the
    // page loaded would keep using the empty string it closed over.
  }, [id, me]);
  useEffect(() => {
    let cancelled = false;
    // reload() awaits the network before it touches state, so nothing is set during
    // this effect's synchronous body; the rule cannot see through the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload().catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [reload]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setError(null); setNotice(null); setBusy(label);
    try { await fn(); await reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  if (!l) return <p className="wrap py-10 text-muted">{error ?? "Loading…"}</p>;
  const isSeller = me === l.seller;
  const isBuyer = me === l.buyer;
  const fee = Math.floor((l.priceLamports * cfg.feeBps) / 10_000);
  const tx = (sig: string | null) => sig && <a className="font-mono text-blue underline" href={explorerUrl(cfg, "tx", sig)} target="_blank" rel="noreferrer">{shortKey(sig, 6)}</a>;

  const includesMetadata = l.type === "token_authority" && (l.asset as TokenAuthorityAsset).authorities.includes("metadata_update");
  const parties = { id: l.id, seller: l.seller, buyer: l.buyer ?? l.seller, treasury: cfg.treasury };
  const sync = () => fetch(`/api/listings/${l.id}/sync`, { method: "POST" });

  /**
   * Every one of these is signed by the user and executed by the program. The server
   * is told afterwards only so the search index stays current.
   */
  const act = (label: string, fn: () => Promise<string>) =>
    run(label, async () => { await fn(); setBusy("Confirming on chain…"); await sync(); });

  /** Pays the seller and moves the authorities in a single instruction. */
  const buy = () => act("Approve the purchase in your wallet…", () =>
    buyTokenOnChain(connection, wallet, { id: l.id, seller: l.seller, treasury: cfg.treasury, mint: l.mint!, includesMetadata }));

  const fund = () => act("Approve the deposit in your wallet…", () =>
    fundOnChain(connection, wallet, { id: l.id, seller: l.seller }));

  const release = () => act("Releasing the funds…", () => releaseOnChain(connection, wallet, parties));

  const claimRefund = () => act("Reclaiming your deposit…", () => refundOnChain(connection, wallet, parties));

  const openDispute = () => act("Freezing the funds…", async () => {
    const sig = await disputeOnChain(connection, wallet, { id: l.id, seller: l.seller });
    if (reason.trim()) await signedPost(wallet, `/api/listings/${l.id}/dispute`, "dispute", l.id, { reason });
    return sig;
  });

  const cancel = () => act("Cancelling…", () =>
    cancelOnChain(connection, wallet, { id: l.id, mint: l.mint, includesMetadata }));

  /** A delivery note is descriptive text, so it stays off chain in the index. */
  const saveNote = () => run("Saving…", () =>
    signedPost(wallet, `/api/listings/${l.id}/note`, "note", l.id, { note }));

  /**
   * Put a picture on the listing. Shrunk in the browser first, so a photo straight off a
   * phone goes up instead of coming back as a size complaint the seller never sees.
   */
  async function setCover(file: File, slot: "banner" | "thumb" = "banner") {
    setCoverError(null); setCoverNote(null); setError(null); setNotice(null);
    setBusy(slot === "thumb" ? "Uploading the card image…" : "Uploading the cover…");
    try {
      const { file: ready, note: how } = await prepareImage(file);
      await uploadListingImage(wallet, l!.id, ready, slot);
      setCoverNote(how);
      await reload();
    } catch (e) {
      setCoverError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const secondsLeft = deadline === null ? null : deadline - nowSec;
  const pastDeadline = secondsLeft !== null && secondsLeft <= 0;
  // A review needs a finished deal and a counterparty. Cancelled listings had neither.
  const settled = l.status === "sold" || l.status === "refunded";
  const canReview = !!me && settled && !!l.buyer && (isSeller || isBuyer);
  /** Only while the deal is still open: a settled listing is closed on purpose. */
  const notOpened = onChain === false && (l.status === "draft" || l.status === "active");
  const atomic = l.type === "token_authority";
  const cover = l.image ? `/api/uploads/${l.image}` : null;
  /** The card in the market has its own picture; an older listing falls back to the banner. */
  const card = l.thumb ? `/api/uploads/${l.thumb}` : null;

  /* ---- where the deal has got to ---- */
  const live = !notOpened && (l.status === "active" || l.status === "paid" || l.status === "disputed" || settled);
  const funded = l.status === "paid" || l.status === "disputed" || settled;
  const steps: Step[] = [
    { label: "Created", state: "done" },
    { label: atomic ? "Controls escrowed" : "Open for sale", state: live ? "done" : "current" },
    ...(atomic ? [] : [{ label: "Buyer funds", state: (funded ? "done" : live ? "current" : "todo") as Step["state"] }]),
    {
      label: l.status === "refunded" ? "Refunded" : l.status === "cancelled" ? "Cancelled" : l.status === "disputed" ? "In dispute" : "Settled",
      state: l.status === "sold" ? "done"
        : l.status === "disputed" || l.status === "refunded" || l.status === "cancelled" ? "failed"
          : funded ? "current" : "todo",
    },
  ];

  /* ---- whose turn is it, and to do what ---- */
  const next: { tone: "info" | "warn" | "success" | "error"; text: string } = (() => {
    if (l.status === "cancelled") return { tone: "info", text: "This listing was cancelled. Nothing is held and nothing is owed." };
    if (l.status === "refunded") return { tone: "info", text: "The delivery window ran out and the buyer took their SOL back." };
    if (l.status === "sold") return { tone: "success", text: "Done. The money and the thing itself have both changed hands." };
    if (l.status === "disputed") return { tone: "error", text: "The funds are frozen while this is arbitrated. Neither side can move them." };
    if (notOpened) {
      return isSeller
        ? { tone: "warn", text: "Nobody can buy this yet. One signature opens the escrow account a buyer's SOL goes into — until you sign it there is nothing on chain to pay." }
        : { tone: "warn", text: "Not open for purchase yet. The seller still has to open this listing's escrow on chain." };
    }
    if (l.status === "paid") {
      if (isBuyer) {
        return pastDeadline
          ? { tone: "warn", text: "The delivery window has passed. You can take your SOL back, or keep waiting if you would rather." }
          : { tone: "info", text: `Your SOL is held by the escrow program. Release it once you have received what was promised${secondsLeft !== null ? `, or take it back in ${remaining(secondsLeft)} if you never do` : ""}.` };
      }
      if (isSeller) {
        return pastDeadline
          ? { tone: "warn", text: "The delivery window has passed, so the buyer can reclaim their SOL at any moment. Deliver and ask them to release." }
          : { tone: "warn", text: `The buyer's SOL is in escrow. Hand the thing over and ask them to release${secondsLeft !== null ? ` — you have ${remaining(secondsLeft)} left` : ""}.` };
      }
      return { tone: "info", text: "Sold pending delivery. The buyer's SOL is held by the escrow program." };
    }
    // A draft with no answer from the chain yet — the sync failed, or has not landed.
    if (l.status === "draft") {
      return isSeller
        ? { tone: "warn", text: "Still a draft. Finish opening it on chain before anybody can buy it." }
        : { tone: "warn", text: "This listing is still a draft. The seller has not opened it for sale yet." };
    }
    if (isSeller) return { tone: "info", text: "Live. You will see it here the moment somebody funds the escrow." };
    if (!me) return { tone: "info", text: "Connect a wallet to buy this or to manage it." };
    return atomic
      ? { tone: "info", text: "Buying moves the controls to your wallet in the very same transaction that pays the seller." }
      : { tone: "info", text: "Your SOL goes into an account the escrow program owns. The seller cannot touch it until you release it." };
  })();
  const nextTint = { info: "var(--color-blue)", warn: "var(--color-amber)", success: "var(--color-green)", error: "var(--color-rose)" }[next.tone];

  return (
    <div className="wrap space-y-6 py-8">
      <Link href="/" className="inline-block text-[13.5px] text-muted hover:text-ink">← Back to the market</Link>

      {/* ---------------------------------------------------------- cover */}
      {/* A listing with no cover is a listing nobody clicks. If it is the seller reading,
          the empty frame is the upload control itself rather than a prompt pointing at
          one somewhere further down the page. */}
      {!cover && isSeller ? (
        <CoverPicker
          preview={null}
          busy={busy === "Uploading the cover…"}
          error={coverError}
          note={coverNote}
          onPick={(file) => setCover(file)}
        />
      ) : (
        <div className="relative">
          {/* Capped, so a wide cover does not push the title and the price below the fold
              on a laptop — the picture is the invitation, not the page. */}
          <CoverArt seed={l.id} image={l.token?.image} symbol={l.token?.symbol} banner={cover}
            className="aspect-[21/9] max-h-[360px] w-full" rounded="rounded-2xl" />
          {isSeller && cover && (
            <label className="absolute bottom-3 right-3 cursor-pointer rounded-full px-3.5 py-2 text-[13px] font-semibold backdrop-blur"
              style={{ background: "color-mix(in srgb, var(--color-bg) 78%, transparent)", color: "var(--color-ink)", border: "1px solid var(--color-line)" }}>
              {busy === "Uploading the cover…" ? "Uploading…" : "Change cover"}
              <input type="file" accept={ACCEPT_ATTR} className="hidden" disabled={!!busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) setCover(file);
                }} />
            </label>
          )}
          {/* The picker carries its own message; this branch has none, so it needs one. */}
          {coverError && <p className="mt-2 text-[13px] font-semibold" style={{ color: "var(--color-rose)" }} role="alert">{coverError}</p>}
          {!coverError && coverNote && <p className="mt-2 text-[13px] text-faint">{coverNote}</p>}

          {/* Only the seller may put a picture on a listing, and until now the page said
              so by simply not drawing the control — which reads, to the person who came
              here to add one, as the upload being broken. Say whose listing it is, and
              which wallet is looking at it, so the mismatch is visible rather than felt. */}
          {!cover && !isSeller && (
            <p className="mt-2 text-[13px] text-muted">
              No cover yet — only this listing&rsquo;s seller can add one.{" "}
              {me
                ? <>You are connected as <span className="font-mono text-ink">{shortKey(me, 4)}</span>; the seller is <span className="font-mono text-ink">{shortKey(l.seller, 4)}</span>.</>
                : <>Connect the seller&rsquo;s wallet (<span className="font-mono text-ink">{shortKey(l.seller, 4)}</span>) to add one.</>}
            </p>
          )}
        </div>
      )}

      {/* ----------------------------------------------- title and the rail */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <TypeBadge type={l.type} />
          <StatusBadge status={l.status} />
          {l.token?.symbol && <Chip>${l.token.symbol}</Chip>}
          {l.type === "offchain" && (proof?.verified
            ? <Chip tint="var(--color-green)">Domain verified</Chip>
            : <Chip tint="var(--color-amber)">Unverified seller</Chip>)}
        </div>
        {/* A coin is recognised by its artwork before its name, so a token listing wears
            it beside the title rather than only inside the banner. */}
        <div className="flex items-center gap-4">
          {l.token && (l.token.image || l.token.symbol) && (
            <TokenAvatar image={l.token.image} symbol={l.token.symbol} size={56} />
          )}
          <h1 className="title-lg">{l.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px] text-muted">
          <span className="flex items-center gap-2">Built by <BuilderChip wallet={l.seller} />{isSeller && <span className="text-faint">(you)</span>}</span>
          <span className="text-faint">Listed {new Date(l.createdAt).toLocaleDateString()}</span>
        </div>
        <div className="card px-5 py-4"><Rail steps={steps} /></div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* ------------------------------------------------ the left column */}
        <div className="space-y-6">
          <Section title="About this project">
            <p className="whitespace-pre-wrap text-[16px] leading-relaxed text-body">{l.description || "The seller wrote no description."}</p>
          </Section>

          <Section title="What the buyer receives">
            {l.type === "token_authority" && (
              <ul className="list-disc space-y-1 pl-5 text-[14px] text-muted">
                {(l.asset as TokenAuthorityAsset).authorities.map((a) => <li key={a}>{a === "mint" ? "Mint authority" : a === "freeze" ? "Freeze authority" : "Metadata update authority"}</li>)}
                <li className="break-all">Mint: <a className="font-mono text-blue underline" href={explorerUrl(cfg, "address", l.mint!)} target="_blank" rel="noreferrer">{l.mint}</a></li>
              </ul>
            )}
            {l.type === "pump_creator" && (
              <ul className="list-disc space-y-1 pl-5 text-[14px] text-muted">
                <li>pump.fun coin creator role (creator-fee recipient and fee-split control)</li>
                <li><a className="text-blue underline" href={(l.asset as PumpCreatorAsset).pumpUrl} target="_blank" rel="noreferrer">View on pump.fun</a></li>
                <li>Current on-chain creator: <span className="font-mono">{shortKey(l.token?.pump?.creator, 6)}</span> {l.token?.pump?.complete ? "· graduated" : "· on bonding curve"}</li>
              </ul>
            )}
            {l.type === "offchain" && (
              <div className="space-y-3 text-[14px] text-muted">
                <div>Category: <span className="text-ink">{OFFCHAIN_CATEGORY_LABELS[(l.asset as OffchainAsset).category] ?? (l.asset as OffchainAsset).category}</span></div>
                {(l.asset as OffchainAsset).links.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-5">
                    {(l.asset as OffchainAsset).links.map((u) => <li key={u}><a className="break-all text-blue underline" href={u} target="_blank" rel="noreferrer">{u}</a></li>)}
                  </ul>
                )}
                <div className="whitespace-pre-wrap rounded-xl border border-line bg-bg-2 p-3 text-ink">{(l.asset as OffchainAsset).deliverables}</div>
              </div>
            )}
          </Section>

          {/* Everything that is either checkable or explicitly not checkable, in one place,
              so a buyer does not have to hunt for the caveats. */}
          <Section title="Checks" tint="var(--color-blue)">
            <div className="space-y-3">
              {l.type === "offchain" && (
                <Alert kind={proof?.verified ? "success" : "warn"}>
                  {proof?.verified ? (
                    <><strong>Domain verified.</strong> {proof.verifiedHost} publishes a DNS record naming this seller&apos;s wallet, so they control it.</>
                  ) : (
                    <><strong>Unverified.</strong> Nothing proves this seller controls what they are selling — off-chain assets cannot be checked on chain. Your SOL stays in escrow until you say you received it, and the deadline refunds you if you never do, but judge the seller before you fund anything.</>
                  )}
                </Alert>
              )}

              {reports > 0 && (
                <Alert kind="error">
                  <strong>{reports} {reports === 1 ? "person has" : "people have"} reported this listing.</strong> Reports are not proof, and they do not remove a listing on their own. Read it carefully.
                </Alert>
              )}

              {l.type === "pump_creator" && handover && (
                <>
                  <Alert kind={handover.handedOver ? "success" : handover.role === "buyer" ? "warn" : handover.verdict.full ? "info" : "error"}>
                    <strong>
                      {handover.role === "buyer"
                        ? (handover.handedOver ? "Handed over. " : "Not handed over yet. ")
                        : (handover.verdict.full ? "Seller holds the role outright. " : "Seller no longer holds the role outright. ")}
                    </strong>
                    {handover.verdict.reason}
                    {handover.control?.source === "pool" && " Read from the PumpSwap pool, which pays the fees since graduation."}
                  </Alert>
                  {handover.control?.kind === "sharing_config" && handover.control.config && (
                    <div className="rounded-xl border border-line bg-bg-2 p-3 text-[12.5px]">
                      <div className="kicker mb-1">Creator fee split, live from pump.fun</div>
                      <div className="text-muted">Admin <span className="font-mono text-ink">{shortKey(handover.control.config.admin, 6)}</span>{handover.control.config.adminRevoked && <span className="text-rose"> · permanently locked</span>}</div>
                      <ul className="mt-1 space-y-0.5 font-mono">
                        {handover.control.config.shareholders.map((sh) => (
                          <li key={sh.address} className="flex justify-between gap-3"><span>{shortKey(sh.address, 6)}{sh.address === l.buyer ? " (buyer)" : sh.address === l.seller ? " (seller)" : ""}</span><span>{(sh.shareBps / 100).toFixed(2)}%</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}

              {l.token && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 font-mono text-[12.5px]">
                  <dt className="text-muted">Supply</dt><dd className="text-ink">{l.token.supply && l.token.decimals !== undefined ? (Number(l.token.supply) / 10 ** l.token.decimals).toLocaleString() : "—"}</dd>
                  <dt className="text-muted">Mint authority</dt><dd className="text-ink">{l.token.mintAuthority ? shortKey(l.token.mintAuthority, 6) : "revoked (fixed supply)"}</dd>
                  <dt className="text-muted">Freeze authority</dt><dd className="text-ink">{l.token.freezeAuthority ? shortKey(l.token.freezeAuthority, 6) : "revoked"}</dd>
                  <dt className="text-muted">Metadata</dt><dd className="text-ink">{l.token.updateAuthority ? `mutable · ${shortKey(l.token.updateAuthority, 6)}` : "none"}</dd>
                  {l.token.holders && (<><dt className="text-muted">Top 10 holders</dt><dd className="text-ink">{(l.token.holders.top10Share * 100).toFixed(1)}% {l.token.holders.top10Share > 0.5 ? <span className="text-brand">· concentrated</span> : <span className="text-blue">· distributed</span>}</dd></>)}
                  {l.token.pump && (<><dt className="text-muted">pump.fun</dt><dd className="text-ink">{l.token.pump.complete ? "graduated" : "on bonding curve"} · creator {shortKey(l.token.pump.creator, 6)}</dd></>)}
                </dl>
              )}
              {l.token && <p className="text-[12.5px] text-faint">Snapshot taken when the listing was created. Verify live on the explorer before buying.</p>}
            </div>
          </Section>

          {l.deliveryNote && <Alert kind="info"><strong>Seller&apos;s delivery note:</strong> {l.deliveryNote}</Alert>}
          {l.disputeReason && <Alert kind="error"><strong>Dispute:</strong> {l.disputeReason}</Alert>}

          {/* Long, mostly interesting after the fact, and never the reason somebody opened
              the page — so it opens on request rather than filling the column. */}
          <details className="card p-5">
            <summary className="kicker cursor-pointer select-none">Activity · {events.length}</summary>
            <ol className="mt-3 space-y-1.5 text-[13px] text-muted">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap gap-x-3">
                  <span className="w-40 shrink-0 text-faint">{new Date(e.createdAt).toLocaleString()}</span>
                  <span>{e.kind.replace(/_/g, " ")} {typeof e.data.signature === "string" && tx(e.data.signature)}{typeof e.data.error === "string" && <span className="text-rose"> — {e.data.error}</span>}</span>
                </li>
              ))}
            </ol>
          </details>
        </div>

        {/* ----------------------------------------------- the action column */}
        <aside className="h-fit space-y-4 lg:sticky lg:top-24">
          <div className="card space-y-4 p-5">
            <div>
              <div className="kicker mb-1.5">Price</div>
              <div className="font-mono text-[30px] font-medium leading-none text-brand">
                {formatSol(l.priceLamports)} <span className="text-[15px]">SOL</span>
              </div>
              <div className="mt-2 text-[13px] text-muted">
                Seller receives {formatSol(l.priceLamports - fee)} SOL after the {cfg.feeBps / 100}% fee
              </div>
            </div>

            {/* The one sentence this reader needs. */}
            <div className="rounded-xl border p-3.5"
              style={{ background: `color-mix(in srgb, ${nextTint} 7%, var(--color-tint-base))`, borderColor: `color-mix(in srgb, ${nextTint} 26%, var(--color-tint-base))` }}>
              <div className="kicker mb-1" style={{ color: nextTint }}>
                {settled || l.status === "cancelled" ? "Outcome" : "Next step"}
              </div>
              <p className="text-[14px] leading-relaxed text-ink">{next.text}</p>
            </div>

            {error && <Alert kind="error">{error}</Alert>}
            {notice && <Alert kind="info">{notice}</Alert>}

            {/* ----- the primary action, whoever is reading ----- */}
            {notOpened && isSeller && !atomic && (
              <Button className="w-full" disabled={!!busy} onClick={() => run("Approve in your wallet…", async () => {
                await createListingOnChain(connection, wallet, {
                  id: l.id, type: l.type, priceLamports: l.priceLamports,
                  authorities: [], mint: l.type === "pump_creator" ? l.mint ?? undefined : undefined,
                  deliveryDays: 14,
                });
                await sync();
              })}>
                {busy ?? "Open the escrow so people can buy"}
              </Button>
            )}
            {notOpened && isSeller && atomic && (
              <Link href="/sell"><Button className="w-full" variant="secondary">Finish this on the Sell page</Button></Link>
            )}

            {me && l.status === "active" && !isSeller && !notOpened && (
              <Button className="w-full" onClick={atomic ? buy : fund} disabled={!!busy}>
                {busy ?? `Buy for ${formatSol(l.priceLamports)} SOL`}
              </Button>
            )}

            {isBuyer && l.status === "paid" && (
              <div className="space-y-2">
                <Button className="w-full" variant={l.type === "pump_creator" && handover && !handover.handedOver ? "secondary" : undefined} onClick={release} disabled={!!busy}>
                  {busy ?? (l.type === "pump_creator" && handover && !handover.handedOver ? "Release anyway (not verified on chain)" : "I received it · release funds")}
                </Button>
                {l.type === "pump_creator" && handover && !handover.handedOver && (
                  <p className="text-[12.5px] text-faint">The chain does not show the creator role as yours yet. Releasing now pays the seller anyway.</p>
                )}
                {pastDeadline && (
                  <Button className="w-full" variant="secondary" onClick={claimRefund} disabled={!!busy}>
                    {busy ?? "Delivery window passed · take my money back"}
                  </Button>
                )}
              </div>
            )}

            {isSeller && l.status === "paid" && (
              <div className="space-y-2">
                {l.type === "pump_creator" && (
                  <p className="break-all text-[12.5px] text-muted">
                    Transfer coin ownership to <span className="font-mono">{l.buyer}</span> on pump.fun, then ask them to release.
                    If the coin uses fee sharing, the buyer must end up as admin <em>and</em> sole shareholder at 100%.
                  </p>
                )}
                <textarea className={inputCls} rows={3} placeholder="Delivery note for the buyer — what you handed over, and where" value={note} onChange={(e) => setNote(e.target.value)} />
                <Button className="w-full" variant="secondary" onClick={saveNote} disabled={!!busy || !note.trim()}>{busy ?? "Save delivery note"}</Button>
              </div>
            )}

            {/* Either party, while money is held: the escape hatch. */}
            {(isBuyer || isSeller) && l.status === "paid" && (
              <details className="rounded-xl border border-line bg-bg-2 p-3 text-[13px]">
                <summary className="cursor-pointer select-none text-muted">Something has gone wrong</summary>
                <p className="mt-2 text-muted">A dispute freezes the SOL where it is. Neither side can move it until it is arbitrated.</p>
                <textarea className={`${inputCls} mt-2`} rows={3} placeholder="What happened?" value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button className="mt-2 w-full" variant="danger" onClick={openDispute} disabled={!!busy}>{busy ?? "Open dispute"}</Button>
              </details>
            )}
          </div>

          {/* ----- the review, at the one moment it can be written ----- */}
          {canReview && (
            <div className="card space-y-3 p-5">
              <h3 className="text-[16px] font-bold text-ink">
                {myReview ? "Your review" : `How did this go with the ${isSeller ? "buyer" : "seller"}?`}
              </h3>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} out of 5`}
                    aria-pressed={rating === n}
                    className="rounded-lg border px-3 py-1.5 text-[14px] font-semibold transition-colors"
                    style={{
                      borderColor: rating >= n ? "var(--color-honey)" : "var(--color-line)",
                      background: rating >= n ? "color-mix(in srgb, var(--color-honey) 14%, var(--color-tint-base))" : "transparent",
                      color: rating >= n ? "var(--color-ink)" : "var(--color-muted)",
                    }}>
                    {n}
                  </button>
                ))}
              </div>
              <textarea className={inputCls} rows={3} value={reviewBody} onChange={(e) => setReviewBody(e.target.value)}
                placeholder={isSeller ? "Did they pay and communicate?" : "Did they deliver what they said, on time?"} />
              <Button className="w-full" disabled={!!busy || reviewBody.trim().length < 10 || !rating}
                onClick={() => run("Sign your review…", async () => {
                  await signedPost(wallet, `/api/listings/${l.id}/review`, "review", l.id, { rating, body: reviewBody });
                  setNotice("Review posted. It shows on their builder page.");
                })}>
                {busy ?? (myReview ? "Update my review" : "Post review")}
              </Button>
              <p className="text-[12.5px] text-faint">Public, and tied to this deal. Only the two of you can write one here.</p>
            </div>
          )}

          {/* ----- the paper trail ----- */}
          <div className="card space-y-1.5 p-5 text-[12.5px]">
            <div className="kicker mb-1">Parties</div>
            <div className="flex items-center gap-2 text-muted">Seller <BuilderChip wallet={l.seller} />{isSeller && <span className="text-faint">(you)</span>}</div>
            {l.buyer && <div className="text-muted">Buyer <span className="font-mono text-ink">{shortKey(l.buyer, 6)}</span>{isBuyer && <span className="text-faint"> (you)</span>}</div>}
            {(l.escrowSig || l.paymentSig || l.settlementSig) && (
              <div className="space-y-1 border-t border-line pt-2 font-mono text-muted">
                {l.escrowSig && <div>Escrowed {tx(l.escrowSig)}</div>}
                {l.paymentSig && <div>Payment {tx(l.paymentSig)}</div>}
                {l.settlementSig && <div>Settlement {tx(l.settlementSig)}</div>}
              </div>
            )}
          </div>

          {/* ----- seller housekeeping, folded away ----- */}
          {isSeller && (l.status === "draft" || l.status === "active") && (
            <details className="card p-5 text-[13px]">
              <summary className="kicker cursor-pointer select-none">Manage this listing</summary>
              <div className="mt-4 space-y-4">
                {l.type === "offchain" && !proof?.verified && (
                  <div className="space-y-2">
                    <div className="text-[13.5px] font-semibold text-ink">Prove you own it</div>
                    <p className="text-muted">
                      Add this TXT record to your domain&apos;s DNS, at the root or on <span className="font-mono">_takeover</span>, then check below.
                      Buyers see &ldquo;Unverified seller&rdquo; until you do.
                    </p>
                    <div className="break-all rounded-lg bg-bg p-2 font-mono text-ink">{proof?.expectedRecord ?? `takeover-verify=${l.seller}`}</div>
                    <Button className="w-full" variant="secondary" disabled={!!busy}
                      onClick={() => run("Checking DNS…", async () => {
                        const r = await signedPost<DomainProofResult>(wallet, `/api/listings/${l.id}/verify-domain`, "verify-domain", l.id, {});
                        setProof(r);
                        if (!r.verified) throw new Error(r.proofs[0]?.detail ?? "No matching TXT record found yet. DNS changes can take a few minutes.");
                        setNotice(`Verified ${r.verifiedHost}`);
                      })}>
                      {busy ?? "Check my DNS record"}
                    </Button>
                  </div>
                )}

                {/* Two pictures at two shapes. The banner is edited on the picture itself
                    at the top of this page; the card is only ever seen in the market, so
                    it is edited here, where a seller can see what they are changing. */}
                <div className="space-y-3 border-t border-line pt-4">
                  <div className="text-[13.5px] font-semibold text-ink">Card image</div>
                  <p className="text-muted">What people see in the market. Shown at roughly 16:10.</p>
                  <CoverPicker preview={card} aspect="aspect-[16/10]" label="card image"
                    busy={busy === "Uploading the card image…"}
                    onPick={(file) => setCover(file, "thumb")}
                    onClear={card ? () => run("Removing…", () => removeListingImage(wallet, l.id, "thumb")) : undefined} />
                </div>

                {cover && (
                  <div className="space-y-2 border-t border-line pt-4">
                    <div className="text-[13.5px] font-semibold text-ink">Banner</div>
                    <p className="text-muted">Use &ldquo;Change cover&rdquo; on the picture at the top of this page to replace it.</p>
                    <Button className="w-full" variant="secondary" disabled={!!busy}
                      onClick={() => run("Removing…", () => removeListingImage(wallet, l.id, "banner"))}>
                      {busy ?? "Remove banner"}
                    </Button>
                  </div>
                )}

                <div className="border-t border-line pt-4">
                  <Button className="w-full" variant="danger" onClick={cancel} disabled={!!busy}>{busy ?? "Cancel listing"}</Button>
                  <p className="mt-2 text-faint">
                    {atomic ? "Cancelling returns every escrowed authority to your wallet." : "Cancelling closes the escrow account and returns its rent to you."}
                  </p>
                </div>
              </div>
            </details>
          )}

          {/* Shown to everyone, not only to connected wallets: the person most likely to spot
              a fraudulent listing is the owner of the thing being sold, and they arrive from a
              link with no reason to have connected anything. */}
          {!isSeller && (
            <details className="card p-5 text-[13px]">
              <summary className="cursor-pointer select-none text-muted">Is this your project? Report this listing</summary>
              <p className="mt-2 text-muted">
                Reporting queues it for review. It does not take the listing down on its own, because that would hand anybody a button to erase a competitor.
              </p>
              {!me && <p className="mt-2 text-muted">Connect a wallet to report. A report is signed, so it is attributable and one wallet counts once.</p>}
              <textarea className={`${inputCls} mt-2`} rows={3} disabled={!me}
                placeholder="What is wrong with this listing? Say who you are and what you own."
                value={reportReason} onChange={(e) => setReportReason(e.target.value)} />
              <Button className="mt-2 w-full" variant="secondary" disabled={!!busy || !me || reportReason.trim().length < 10}
                onClick={() => run("Filing report…", async () => {
                  const r = await signedPost<{ filed: boolean; reports: number }>(wallet, `/api/listings/${l.id}/report`, "report", l.id, { reason: reportReason.trim() });
                  setReports(r.reports);
                  setReportReason("");
                  setNotice(r.filed ? "Reported. An admin will review it." : "You have already reported this listing.");
                })}>
                {busy ?? "Report"}
              </Button>
            </details>
          )}
        </aside>
      </div>
    </div>
  );
}
