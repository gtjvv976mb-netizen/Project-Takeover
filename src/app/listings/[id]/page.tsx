"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { api, removeListingImage, signedPost, uploadListingImage, type DomainProofResult, type Handover } from "@/lib/client/api";
import { buyTokenOnChain, cancelOnChain, disputeOnChain, fundOnChain, refundOnChain, releaseOnChain } from "@/lib/client/program";
import { explorerUrl, useConfig } from "@/components/ConfigContext";
import { Alert, Button, Chip, inputCls, StatusBadge, TypeBadge } from "@/components/ui";
import { CoverArt } from "@/components/CoverArt";
import { formatSol, OFFCHAIN_CATEGORY_LABELS, shortKey, type Listing, type ListingEvent, type OffchainAsset, type PumpCreatorAsset, type TokenAuthorityAsset } from "@/lib/types";
import { BuilderChip } from "@/components/Builder";

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
  /** Ticks once a minute so the refund button appears the moment the window closes. */
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);
  const [reason, setReason] = useState("");

  const reload = useCallback(async () => {
    const r = await api.listing(id);
    setL(r.listing);
    setEvents(r.events);
    if (r.listing.type === "pump_creator") api.handover(id).then(setHandover).catch(() => setHandover(null));
    if (r.listing.type === "offchain") api.domainProof(id).then(setProof).catch(() => setProof(null));
    api.reports(id).then((x) => setReports(x.reports)).catch(() => {});
    // refresh the authoritative state from the program itself
    try {
      const chain = await fetch(`/api/listings/${id}/sync`, { method: "POST" }).then((x) => x.json());
      if (chain?.onChain) {
        setDeadline(chain.deadline || null);
        if (chain.listing) setL(chain.listing);
      }
    } catch { /* index still renders without it */ }
  }, [id]);
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
  const tx = (sig: string | null) => sig && <a className="font-mono text-xs text-blue underline" href={explorerUrl(cfg, "tx", sig)} target="_blank" rel="noreferrer">{shortKey(sig, 6)}</a>;

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

  const pastDeadline = deadline !== null && nowSec >= deadline;

  return (
    <div className="wrap py-10 grid gap-10 lg:grid-cols-[1fr_360px]">
      <div className="space-y-8">
        <header>
          <CoverArt seed={l.id} image={l.token?.image} symbol={l.token?.symbol} banner={l.image ? `/api/uploads/${l.image}` : null} className="aspect-[21/9] w-full" rounded="rounded-2xl" />
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <TypeBadge type={l.type} />
            <StatusBadge status={l.status} />
            {l.token?.symbol && <Chip>${l.token.symbol}</Chip>}
          </div>
          <h1 className="title-lg mt-3">{l.title}</h1>
        </header>

        <p className="whitespace-pre-wrap text-[17px] leading-relaxed">{l.description || "No description."}</p>

        <section className="rounded-2xl border border-line bg-surface p-5 text-sm">
          <h2 className="kicker mb-3">What you get</h2>
          {l.type === "token_authority" && (
            <ul className="list-disc space-y-1 pl-5 text-muted">
              {(l.asset as TokenAuthorityAsset).authorities.map((a) => <li key={a}>{a === "mint" ? "Mint authority" : a === "freeze" ? "Freeze authority" : "Metadata update authority"}</li>)}
              <li className="break-all">Mint: <a className="font-mono text-blue underline" href={explorerUrl(cfg, "address", l.mint!)} target="_blank" rel="noreferrer">{l.mint}</a></li>
            </ul>
          )}
          {l.type === "pump_creator" && (
            <ul className="list-disc space-y-1 pl-5 text-muted">
              <li>pump.fun coin creator role (creator-fee recipient and fee-split control)</li>
              <li><a className="text-blue underline" href={(l.asset as PumpCreatorAsset).pumpUrl} target="_blank" rel="noreferrer">View on pump.fun</a></li>
              <li>Current on-chain creator: <span className="font-mono">{shortKey(l.token?.pump?.creator, 6)}</span> {l.token?.pump?.complete ? "· graduated" : "· on bonding curve"}</li>
            </ul>
          )}
          {l.type === "pump_creator" && handover && (
            <div className="mt-4 space-y-2">
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
                <div className="rounded-xl border border-line bg-bg-2 p-3 text-xs">
                  <div className="kicker mb-1">Creator fee split, live from pump.fun</div>
                  <div className="text-muted">Admin <span className="font-mono text-ink">{shortKey(handover.control.config.admin, 6)}</span>{handover.control.config.adminRevoked && <span className="text-rose"> · permanently locked</span>}</div>
                  <ul className="mt-1 space-y-0.5 font-mono">
                    {handover.control.config.shareholders.map((sh) => (
                      <li key={sh.address} className="flex justify-between gap-3"><span>{shortKey(sh.address, 6)}{sh.address === l.buyer ? " (buyer)" : sh.address === l.seller ? " (seller)" : ""}</span><span>{(sh.shareBps / 100).toFixed(2)}%</span></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {l.type === "offchain" && (
            <div className="space-y-2 text-muted">
              {/* Nothing on chain says who owns a website, so the page states plainly which
                  kind of claim this is rather than letting the buyer assume it was checked. */}
              <Alert kind={proof?.verified ? "success" : "warn"}>
                {proof?.verified ? (
                  <><strong>Domain verified.</strong> {proof.verifiedHost} publishes a DNS record naming this seller&apos;s wallet, so they control it.</>
                ) : (
                  <><strong>Unverified.</strong> Nothing proves this seller controls what they are selling. Off-chain assets cannot be checked on chain. Your SOL stays in escrow until you say you received it, and the deadline refunds you if you never do — but judge the seller before you fund anything.</>
                )}
              </Alert>
              {reports > 0 && (
                <Alert kind="error">
                  <strong>{reports} {reports === 1 ? "person has" : "people have"} reported this listing.</strong> Reports are not proof, and they do not remove a listing on their own. Read it carefully.
                </Alert>
              )}
              <div>Category: {OFFCHAIN_CATEGORY_LABELS[(l.asset as OffchainAsset).category] ?? (l.asset as OffchainAsset).category}</div>
              {(l.asset as OffchainAsset).links.length > 0 && <ul className="list-disc pl-5">{(l.asset as OffchainAsset).links.map((u) => <li key={u}><a className="text-blue underline" href={u} target="_blank" rel="noreferrer">{u}</a></li>)}</ul>}
              <div className="whitespace-pre-wrap bg-bg-2 p-3">{(l.asset as OffchainAsset).deliverables}</div>
            </div>
          )}
        </section>

        {l.token && (
          <section className="rounded-2xl border border-line bg-surface p-5 text-sm">
            <h2 className="kicker mb-3 text-blue">Verified on the blockchain</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-xs text-ink sm:grid-cols-3">
              <dt className="text-body">Supply</dt><dd className="col-span-1 sm:col-span-2">{l.token.supply && l.token.decimals !== undefined ? (Number(l.token.supply) / 10 ** l.token.decimals).toLocaleString() : "—"}</dd>
              <dt className="text-body">Mint authority</dt><dd className="col-span-1 sm:col-span-2">{l.token.mintAuthority ? shortKey(l.token.mintAuthority, 6) : "revoked (fixed supply)"}</dd>
              <dt className="text-body">Freeze authority</dt><dd className="col-span-1 sm:col-span-2">{l.token.freezeAuthority ? shortKey(l.token.freezeAuthority, 6) : "revoked"}</dd>
              <dt className="text-body">Metadata</dt><dd className="col-span-1 sm:col-span-2">{l.token.updateAuthority ? `mutable · ${shortKey(l.token.updateAuthority, 6)}` : "none"}</dd>
              {l.token.holders && (<><dt className="text-body">Top 10 holders</dt><dd className="col-span-1 sm:col-span-2">{(l.token.holders.top10Share * 100).toFixed(1)}% of supply {l.token.holders.top10Share > 0.5 ? <span className="text-brand">· concentrated</span> : <span className="text-blue">· distributed</span>}</dd></>)}
              {l.token.pump && (<><dt className="text-body">pump.fun</dt><dd className="col-span-1 sm:col-span-2">{l.token.pump.complete ? "graduated to Raydium/PumpSwap" : "on bonding curve"} · creator {shortKey(l.token.pump.creator, 6)}</dd></>)}
            </dl>
            <p className="mt-2 text-xs text-faint">Snapshot taken when the listing was created. Verify live on the explorer before buying.</p>
          </section>
        )}

        {l.deliveryNote && <Alert kind="info"><strong>Seller&apos;s delivery note:</strong> {l.deliveryNote}</Alert>}
        {l.disputeReason && <Alert kind="error"><strong>Dispute:</strong> {l.disputeReason}</Alert>}

        <section className="border-t border-line pt-5 text-sm">
          <h2 className="kicker mb-3">Activity</h2>
          <ol className="space-y-1 text-muted">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3"><span className="w-36 shrink-0 text-body">{new Date(e.createdAt).toLocaleString()}</span><span>{e.kind.replace(/_/g, " ")} {typeof e.data.signature === "string" && tx(e.data.signature)}{typeof e.data.error === "string" && <span className="text-rose"> — {e.data.error}</span>}</span></li>
            ))}
          </ol>
        </section>
      </div>

      <aside className="card h-fit space-y-4 p-5 lg:sticky lg:top-24">
        <div><div className="font-mono text-3xl font-medium text-brand">{formatSol(l.priceLamports)} <span className="text-base">SOL</span></div><div className="micro mt-1 text-muted">Seller receives {formatSol(l.priceLamports - fee)} SOL after {cfg.feeBps / 100}% fee</div></div>
        <div className="space-y-1.5 border-t border-line pt-3 font-mono text-[11px] text-muted">
          <div className="flex items-center gap-2">Builder <BuilderChip wallet={l.seller} />{isSeller && <span>(you)</span>}</div>
          {l.buyer && <div>Buyer <span className="font-mono">{shortKey(l.buyer, 6)}</span>{isBuyer && " (you)"}</div>}
          {l.escrowSig && <div>Escrowed {tx(l.escrowSig)}</div>}
          {l.paymentSig && <div>Payment {tx(l.paymentSig)}</div>}
          {l.settlementSig && <div>Settlement {tx(l.settlementSig)}</div>}
        </div>

        {error && <Alert kind="error">{error}</Alert>}
        {notice && <Alert kind="info">{notice}</Alert>}

        {!me && <Alert kind="warn">Connect a wallet to buy or manage this listing.</Alert>}

        {/* ----- buyer actions ----- */}
        {me && l.status === "active" && !isSeller && (
          <div className="space-y-2">
            <Button className="w-full" onClick={l.type === "token_authority" ? buy : fund} disabled={!!busy}>
              {busy ?? `Buy for ${formatSol(l.priceLamports)} SOL`}
            </Button>
            <p className="text-xs text-faint">
              {l.type === "token_authority"
                ? "The controls move to your wallet in the very same transaction that pays the seller. There is no moment where one side holds both."
                : "Your SOL goes into an account the escrow program owns. The seller cannot touch it, and neither can we."}
            </p>
          </div>
        )}

        {isBuyer && l.status === "paid" && (
          <div className="space-y-2">
            <Alert kind="info">Your {formatSol(l.priceLamports)} SOL is held by the escrow program.</Alert>
            {l.type === "pump_creator" && handover && !handover.handedOver && (
              <Alert kind="warn"><strong>The chain does not show the creator role as yours yet.</strong> Releasing now pays the seller anyway. Ask them to finish the transfer on pump.fun, then reload this page.</Alert>
            )}
            <Button className="w-full" variant={l.type === "pump_creator" && handover && !handover.handedOver ? "secondary" : undefined} onClick={release} disabled={!!busy}>
              {busy ?? (l.type === "pump_creator" && handover && !handover.handedOver ? "Release anyway (not verified on chain)" : "I received it · release funds")}
            </Button>
            {pastDeadline && (
              <Button className="w-full" variant="secondary" onClick={claimRefund} disabled={!!busy}>
                {busy ?? "Delivery window passed · take my money back"}
              </Button>
            )}
            <textarea className={inputCls} rows={2} placeholder="Problem? Describe it and open a dispute" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button className="w-full" variant="danger" onClick={openDispute} disabled={!!busy}>Open dispute</Button>
          </div>
        )}

        {/* ----- seller actions ----- */}
        {isSeller && l.status === "draft" && (
          <Link href="/sell"><Alert kind="warn">Not live yet: the controls are still yours. Finish handing them over on the Sell page, or cancel below.</Alert></Link>
        )}
        {isSeller && l.type === "offchain" && !proof?.verified && (
          <div className="space-y-2 rounded-xl border border-line bg-bg-2 p-3 text-xs">
            <div className="kicker">Prove you own it</div>
            <p className="text-muted">
              Add this TXT record to your domain&apos;s DNS, at the root or on <span className="mono">_takeover</span>, then check below.
              Buyers see &ldquo;Unverified seller&rdquo; until you do.
            </p>
            <div className="mono break-all rounded bg-bg p-2 text-ink">{proof?.expectedRecord ?? `takeover-verify=${l.seller}`}</div>
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
        {isSeller && (
          <div className="space-y-2 rounded-xl border border-line bg-bg-2 p-3">
            <div className="text-sm font-semibold">Banner</div>
            <p className="text-xs text-muted">
              Your own picture at the top of this listing, in place of the generated artwork.
              PNG, JPEG, WebP or GIF, up to 2 MB. Wide images look best — it is cropped to a letterbox.
            </p>
            <input
              id="banner-file"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="block w-full text-xs text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-xs file:text-ink"
              disabled={!!busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = ""; // so picking the same file twice still fires
                if (file) run("Uploading…", () => uploadListingImage(wallet, l.id, file));
              }}
            />
            {l.image && (
              <Button className="w-full" variant="secondary" disabled={!!busy}
                onClick={() => run("Removing…", () => removeListingImage(wallet, l.id))}>
                {busy ?? "Remove banner"}
              </Button>
            )}
          </div>
        )}
        {isSeller && (l.status === "draft" || l.status === "active") && (
          <Button className="w-full" variant="danger" onClick={cancel} disabled={!!busy}>{busy ?? "Cancel listing"}</Button>
        )}
        {/* Shown to everyone, not only to connected wallets: the person most likely to spot
            a fraudulent listing is the owner of the thing being sold, and they arrive from a
            link with no reason to have connected anything. Hiding the control from them
            would hide it from exactly the reader it exists for. */}
        {!isSeller && (
          <details className="rounded-xl border border-line bg-bg-2 p-3 text-xs">
            <summary className="cursor-pointer text-muted">Is this your project? Report this listing</summary>
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
        {isSeller && l.status === "paid" && (
          <div className="space-y-2">
            <Alert kind="success">The buyer has escrowed {formatSol(l.priceLamports)} SOL. Deliver to get paid.</Alert>
            {l.type === "pump_creator" && (
              <p className="break-all text-xs text-muted">
                Transfer coin ownership to <span className="font-mono">{l.buyer}</span> on pump.fun, then ask them to release.
                If the coin uses fee sharing, the buyer must end up as admin <em>and</em> sole shareholder at 100%; anything less shows here as not handed over.
              </p>
            )}
            <textarea className={inputCls} rows={3} placeholder="Delivery note for the buyer (what you handed over, and where)" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button className="w-full" variant="secondary" onClick={saveNote} disabled={!!busy || !note.trim()}>{busy ?? "Save delivery note"}</Button>
            <Button className="w-full" variant="danger" onClick={openDispute} disabled={!!busy}>Open dispute</Button>
          </div>
        )}
      </aside>
    </div>
  );
}
