"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { api, signedPost, uploadStagedImage } from "@/lib/client/api";
import { createListingOnChain, escrowAuthorityOnChain } from "@/lib/client/program";
import { useConfig } from "@/components/ConfigContext";
import { Alert, Button, Field, inputCls, TokenAvatar } from "@/components/ui";
import { CoverPicker } from "@/components/CoverPicker";
import { prepareImage } from "@/lib/client/image";
import { OFFCHAIN_CATEGORY_LABELS, shortKey, TYPE_LABELS, type AuthorityKind, type Listing, type ListingType, type OffchainAsset, type TokenInfo } from "@/lib/types";
import { pumpControlOf } from "@/lib/solana-shared";

const AUTH_LABELS: Record<AuthorityKind, string> = { mint: "Mint authority (can mint new supply)", freeze: "Freeze authority (can freeze token accounts)", metadata_update: "Metadata update authority (name, symbol, image)" };

/**
 * Wrapped because `useSearchParams` suspends: an awarded developer arrives here from a
 * request with the agreed price and deadline already in the URL, so the form is filled
 * in for them rather than retyped from memory.
 */
export default function SellPage() {
  return (
    <Suspense fallback={<p className="wrap py-10 text-muted">Loading…</p>}>
      <Sell />
    </Suspense>
  );
}

function Sell() {
  const wallet = useWallet();
  const params = useSearchParams();
  /** Set when this listing is the escrow for a commission that was awarded to them. */
  const forRequest = params.get("request");
  const { connection } = useConnection();
  const cfg = useConfig();
  const router = useRouter();
  const me = wallet.publicKey?.toBase58();

  const [type, setType] = useState<ListingType>(forRequest ? "offchain" : "token_authority");
  const [mint, setMint] = useState("");
  const [token, setToken] = useState<TokenInfo | null>(null);
  const [authorities, setAuthorities] = useState<AuthorityKind[]>([]);
  const [title, setTitle] = useState(params.get("title") ?? "");
  const [description, setDescription] = useState("");
  const [priceSol, setPriceSol] = useState(params.get("price") ?? "");
  const [category, setCategory] = useState<OffchainAsset["category"]>("project");
  const [links, setLinks] = useState("");
  const [deliverables, setDeliverables] = useState("");
  /**
   * The buyer's safety net: once they fund, the seller has this long to deliver, and
   * after it the refund is permissionless. The program accepts 1 to 90 and this was
   * never asked for, so every escrowed listing silently took the client default of 7.
   */
  const [deliveryDays, setDeliveryDays] = useState(Number(params.get("days")) || 14);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Listing | null>(null);
  /**
   * The cover, staged before the listing exists. Listings used to go up with nothing but
   * generated artwork on them, which told a buyer nothing and made the market look empty;
   * a picture is now required, and the server checks that too.
   */
  const [image, setImage] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageNote, setImageNote] = useState<string | null>(null);

  async function pickImage(file: File) {
    setError(null); setImageError(null); setImageNote(null);
    // Show it straight away from the local file; the upload only decides whether it sticks.
    const local = URL.createObjectURL(file);
    setPreview(local);
    setBusy("Uploading the cover…");
    try {
      // Shrink first rather than refusing: a photo off a phone is several megabytes and
      // the seller should not have to know that, let alone go and fix it in another app.
      const { file: ready, note } = await prepareImage(file);
      const up = await uploadStagedImage(wallet, ready);
      setImage(up.image);
      setPreview(up.url);
      setImageNote(note);
    } catch (e) {
      setImage(null);
      setPreview(null);
      setImageError((e as Error).message);
    } finally {
      URL.revokeObjectURL(local);
      setBusy(null);
    }
  }

  async function lookup() {
    setError(null); setToken(null); setBusy("Looking up token…");
    try {
      // The route answers with a dossier; the mint's own state is the `token` inside it.
      const { token: t } = await api.token(mint.trim());
      if (!t) throw new Error("That mint could not be read from the chain.");
      setToken(t);
      if (!title) setTitle(t.name ? `${t.name} (${t.symbol})` : mint.trim());
      const held = (["mint", "freeze", "metadata_update"] as AuthorityKind[]).filter((k) => (k === "mint" ? t.mintAuthority : k === "freeze" ? t.freezeAuthority : t.updateAuthority) === me)
        // Metadata held inside a Token-2022 mint is a different authority than the Metaplex one the program can escrow.
        .filter((k) => k !== "metadata_update" || t.metadataSource === "metaplex");
      setAuthorities(t.extensions?.program === "token-2022" ? [] : held);
      if (t.pump && type === "token_authority" && held.length === 0) setType("pump_creator");
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function create() {
    setError(null); setBusy("Waiting for signature…");
    try {
      const asset = type === "offchain"
        ? { category, links: links.split(/\s+/).filter(Boolean), deliverables }
        : type === "pump_creator" ? { mint: mint.trim() } : { mint: mint.trim(), authorities };
      const l = await signedPost(wallet, "/api/listings", "create", null, { type, title, description, priceSol: Number(priceSol), asset, image, requestId: forRequest ?? undefined });
      setCreated(l);
      if (l.status === "active") router.push(`/listings/${l.id}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  /**
   * Open the listing on chain, and for a token sale hand each authority to the program.
   * Both are signed by the seller; the site never holds a key that could do this.
   *
   * Every kind goes through this, not only token sales. A buyer's `fund` and `buy_token`
   * both take an initialised listing account, so a listing that was never opened here
   * cannot be bought at all — it just fails in the buyer's wallet.
   */
  async function escrow() {
    if (!created) return;
    setError(null);
    try {
      setBusy("Approve the listing in your wallet…");
      await createListingOnChain(connection, wallet, {
        id: created.id, type: created.type, priceLamports: created.priceLamports,
        authorities, mint: created.type === "offchain" ? undefined : mint.trim(),
        deliveryDays,
      });
      for (const [i, which] of authorities.entries()) {
        setBusy(`Handing over ${AUTH_LABELS[which].split(" (")[0]} (${i + 1}/${authorities.length})…`);
        await escrowAuthorityOnChain(connection, wallet, { id: created.id, which, mint: mint.trim() });
      }
      setBusy("Confirming on chain…");
      await fetch(`/api/listings/${created.id}/sync`, { method: "POST" });
      router.push(`/listings/${created.id}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  if (!me) return <p className="wrap py-10 text-muted">Connect your wallet to create a listing.</p>;

  if (created && created.status === "draft") {
    const isToken = created.type === "token_authority";
    return (
      <div className="wrap py-10 max-w-3xl space-y-5">
        <h1 className="text-2xl font-bold">
          {isToken ? "Step 2 · Hand the controls to the program" : "Step 2 · Open the escrow"}
        </h1>
        <p className="text-muted">
          {isToken ? (
            <>
              Your listing is saved. To go live, hand the selected authorities to the escrow program
              <span className="font-mono text-xs"> {shortKey(cfg.programId, 6)}</span>. Nobody holds a key to it,
              so no person can take them, and cancelling returns them to you at any time before a sale.
            </>
          ) : (
            <>
              Your listing is saved here, but a buyer pays the escrow program
              <span className="font-mono text-xs"> {shortKey(cfg.programId, 6)}</span>, not this site. One signature
              opens the account their money will go into. Until you sign it there is nothing on chain to pay,
              so the listing stays off the market.
            </>
          )}
        </p>
        {isToken
          ? <ul className="list-disc pl-5 text-sm text-muted">{authorities.map((a) => <li key={a}>{AUTH_LABELS[a]}</li>)}</ul>
          : <p className="text-sm text-muted">Delivery window: <strong className="text-ink">{deliveryDays} days</strong> from the moment a buyer funds.</p>}
        {error && <Alert kind="error">{error}</Alert>}
        <Button onClick={escrow} disabled={!!busy}>
          {busy ?? (isToken ? "Hand over & publish" : "Open the escrow & publish")}
        </Button>
      </div>
    );
  }

  const canSubmit = title && image && Number(priceSol) >= 0.01 && (type === "offchain" ? deliverables : token && (type === "pump_creator" ? pumpControlOf(token.pump?.control, me ?? "").full : authorities.length > 0 && token.extensions?.program !== "token-2022"));

  return (
    <div className="wrap py-10 max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Put your work on the market</h1>
      <p className="text-sm text-muted">You built it. Prove it on-chain, price it in SOL, and let someone who wants to run it take over. An on-chain program holds the escrow, so neither side has to trust us.</p>

      <Field label="What are you selling?">
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(TYPE_LABELS) as ListingType[]).map((t) => (
            <button key={t} type="button" onClick={() => setType(t)} className={` border px-3 py-2 text-left text-sm ${type === t ? "border-ember bg-brand/10" : "border-line bg-bg-2 hover:bg-bg-2"}`}>{TYPE_LABELS[t]}</button>
          ))}
        </div>
      </Field>

      {type !== "offchain" && (
        <>
          <Field label="Token mint address" hint="Paste the mint. We read the on-chain authorities and pump.fun bonding curve.">
            <div className="flex gap-2">
              <input className={inputCls} value={mint} onChange={(e) => setMint(e.target.value)} placeholder="e.g. 7xKX…pump" />
              <Button variant="secondary" onClick={lookup} disabled={!mint || !!busy}>Look up</Button>
            </div>
          </Field>
          {token && (
            <div className=" border border-line bg-bg-2 p-4">
              <div className="flex items-center gap-3">
                <TokenAvatar image={token.image} symbol={token.symbol} />
                <div>
                  <div className="font-semibold">{token.name ?? "Unnamed"} {token.symbol && <span className="text-faint">${token.symbol}</span>}</div>
                  <div className="text-xs text-faint">{token.pump ? `pump.fun coin · creator ${shortKey(token.pump.creator)}${token.pump.complete ? " · graduated" : " · bonding"}` : "SPL token"}</div>
                </div>
              </div>
              {type === "token_authority" && token.extensions?.program === "token-2022" && (
                <div className="mt-4 space-y-2">
                  <Alert kind="error">
                    This is a Token-2022 mint. The escrow program can only hold legacy SPL Token authorities today, so it cannot be listed as a token sale yet.
                    {token.extensions.risks.length > 0 && " Its extensions also change what the authorities are worth:"}
                  </Alert>
                  {token.extensions.risks.map((r) => <Alert key={r.code} kind={r.level === "critical" ? "error" : "warn"}>{r.text}</Alert>)}
                </div>
              )}
              {type === "token_authority" && token.extensions?.program !== "token-2022" && (
                <div className="mt-4 space-y-2">
                  {(Object.keys(AUTH_LABELS) as AuthorityKind[]).map((k) => {
                    const cur = k === "mint" ? token.mintAuthority : k === "freeze" ? token.freezeAuthority : token.updateAuthority;
                    const mine = cur === me && (k !== "metadata_update" || token.metadataSource === "metaplex");
                    return (
                      <label key={k} className={`flex items-center gap-3  border px-3 py-2 text-sm ${mine ? "border-line" : "border-line opacity-50"}`}>
                        <input type="checkbox" disabled={!mine} checked={authorities.includes(k)} onChange={(e) => setAuthorities(e.target.checked ? [...authorities, k] : authorities.filter((x) => x !== k))} />
                        <span className="flex-1">{AUTH_LABELS[k]}</span>
                        <span className="font-mono text-xs text-faint">{cur ? (mine ? "you" : shortKey(cur)) : "revoked"}</span>
                      </label>
                    );
                  })}
                  {!token.mintAuthority && !token.freezeAuthority && token.updateAuthority !== me && (
                    <Alert kind="warn">Your wallet holds none of this token&apos;s authorities. {token.pump ? "For pump.fun coins, list the coin ownership instead." : ""}</Alert>
                  )}
                </div>
              )}
              {type === "pump_creator" && (() => {
                if (!token.pump) return <Alert kind="error">This mint has no pump.fun bonding curve.</Alert>;
                const v = pumpControlOf(token.pump.control, me ?? "");
                if (v.full) return <Alert kind="success">You hold this coin&apos;s creator role outright. Buyers will receive the creator role and every basis point of its fee.</Alert>;
                return (
                  <Alert kind="error">
                    You do not hold the creator role outright. {v.reason}
                    {v.isAdmin && !v.revoked && " Reset the fee split to 100% to your wallet on pump.fun, then look the coin up again."}
                  </Alert>
                );
              })()}
            </div>
          )}
        </>
      )}

      {type === "offchain" && (
        <>
          <Field label="Category">
            <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as OffchainAsset["category"])}>
              {(Object.keys(OFFCHAIN_CATEGORY_LABELS) as OffchainAsset["category"][]).map((c) => <option key={c} value={c}>{OFFCHAIN_CATEGORY_LABELS[c]}</option>)}
            </select>
          </Field>
          <Field label="Links (one per line)"><textarea className={inputCls} rows={3} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://…" /></Field>
          <Field label="What exactly does the buyer receive?" hint="Logins, DNS transfer, admin roles, repo access… Be specific; this is what a dispute is judged on.">
            <textarea className={inputCls} rows={4} value={deliverables} onChange={(e) => setDeliverables(e.target.value)} />
          </Field>
        </>
      )}

      <Field label="Cover image" hint="Required. This is the picture on your card in the market and at the top of your listing — it is the whole of what somebody sees before they decide to click. Wide images look best; it is cropped to a letterbox. Large pictures are shrunk for you.">
        <CoverPicker preview={preview} busy={busy === "Uploading the cover…"} onPick={pickImage}
          error={imageError} note={imageNote}
          onClear={() => { setImage(null); setPreview(null); setImageError(null); setImageNote(null); }} />
      </Field>

      <Field label="Title"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} /></Field>
      <Field label="Description" hint="Buyers pay for proof: link the repo, the deployed site, the community, the numbers."><textarea className={inputCls} rows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What you built, what works today, holders / volume / community size, and why you're handing it over…" /></Field>
      {type !== "token_authority" && (
        <Field label="Delivery window (days)" hint="Once a buyer funds, you have this long to hand the thing over. After it passes, anyone can return their money to them — including them. 1 to 90.">
          <input className={inputCls} type="number" min={1} max={90} value={deliveryDays}
            onChange={(e) => setDeliveryDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))} />
        </Field>
      )}

      <Field label="Price (SOL)" hint={`Platform fee ${cfg.feeBps / 100}% is deducted from your payout.`}>
        <input className={inputCls} type="number" min="0.01" step="0.01" value={priceSol} onChange={(e) => setPriceSol(e.target.value)} />
      </Field>

      {error && <Alert kind="error">{error}</Alert>}
      {/* A disabled button with no reason beside it is the most common way a form loses
          somebody. Name the one thing that is missing. */}
      {!canSubmit && !busy && (
        <p className="text-[13px] text-faint">
          {!image ? "Add a cover image to continue." : !title ? "Give the listing a title." : Number(priceSol) < 0.01 ? "Set a price of at least 0.01 SOL." : "Fill in what the buyer receives."}
        </p>
      )}
      <Button onClick={create} disabled={!canSubmit || !!busy}>{busy ?? (type === "token_authority" ? "Continue to escrow" : "Publish listing")}</Button>
    </div>
  );
}
