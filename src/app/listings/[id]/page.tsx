"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { api, signedPost } from "@/lib/client/api";
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
          <CoverArt seed={l.id} image={l.token?.image} symbol={l.token?.symbol} className="aspect-[21/9] w-full" rounded="rounded-2xl" />
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
          {l.type === "offchain" && (
            <div className="space-y-2 text-muted">
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
            <Button className="w-full" onClick={release} disabled={!!busy}>{busy ?? "I received it · release funds"}</Button>
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
        {isSeller && (l.status === "draft" || l.status === "active") && (
          <Button className="w-full" variant="danger" onClick={cancel} disabled={!!busy}>{busy ?? "Cancel listing"}</Button>
        )}
        {isSeller && l.status === "paid" && (
          <div className="space-y-2">
            <Alert kind="success">The buyer has escrowed {formatSol(l.priceLamports)} SOL. Deliver to get paid.</Alert>
            {l.type === "pump_creator" && (
              <p className="break-all text-xs text-muted">
                Transfer coin ownership to <span className="font-mono">{l.buyer}</span> on pump.fun, then ask them to release.
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
