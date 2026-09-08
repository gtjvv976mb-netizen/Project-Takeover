"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { api, signedPost } from "@/lib/client/api";
import { createListingOnChain, escrowAuthorityOnChain } from "@/lib/client/program";
import { useConfig } from "@/components/ConfigContext";
import { Alert, Button, Field, inputCls, TokenAvatar } from "@/components/ui";
import { OFFCHAIN_CATEGORY_LABELS, shortKey, TYPE_LABELS, type AuthorityKind, type Listing, type ListingType, type OffchainAsset, type TokenInfo } from "@/lib/types";

const AUTH_LABELS: Record<AuthorityKind, string> = { mint: "Mint authority (can mint new supply)", freeze: "Freeze authority (can freeze token accounts)", metadata_update: "Metadata update authority (name, symbol, image)" };

export default function Sell() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const cfg = useConfig();
  const router = useRouter();
  const me = wallet.publicKey?.toBase58();

  const [type, setType] = useState<ListingType>("token_authority");
  const [mint, setMint] = useState("");
  const [token, setToken] = useState<TokenInfo | null>(null);
  const [authorities, setAuthorities] = useState<AuthorityKind[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priceSol, setPriceSol] = useState("");
  const [category, setCategory] = useState<OffchainAsset["category"]>("project");
  const [links, setLinks] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Listing | null>(null);

  async function lookup() {
    setError(null); setToken(null); setBusy("Looking up token…");
    try {
      const t = await api.token(mint.trim());
      setToken(t);
      if (!title) setTitle(t.name ? `${t.name} (${t.symbol})` : mint.trim());
      const held = (["mint", "freeze", "metadata_update"] as AuthorityKind[]).filter((k) => (k === "mint" ? t.mintAuthority : k === "freeze" ? t.freezeAuthority : t.updateAuthority) === me);
      setAuthorities(held);
      if (t.pump && type === "token_authority" && held.length === 0) setType("pump_creator");
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function create() {
    setError(null); setBusy("Waiting for signature…");
    try {
      const asset = type === "offchain"
        ? { category, links: links.split(/\s+/).filter(Boolean), deliverables }
        : type === "pump_creator" ? { mint: mint.trim() } : { mint: mint.trim(), authorities };
      const l = await signedPost(wallet, "/api/listings", "create", null, { type, title, description, priceSol: Number(priceSol), asset });
      setCreated(l);
      if (l.status === "active") router.push(`/listings/${l.id}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  /**
   * Open the listing on chain, then hand each authority to the program. Both are
   * signed by the seller; the site never holds a key that could do this for them.
   */
  async function escrow() {
    if (!created) return;
    setError(null);
    try {
      setBusy("Approve the listing in your wallet…");
      await createListingOnChain(connection, wallet, {
        id: created.id, type: created.type, priceLamports: created.priceLamports,
        authorities, mint: mint.trim(),
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
    return (
      <div className="wrap py-10 max-w-3xl space-y-5">
        <h1 className="text-2xl font-bold">Step 2 · Hand the controls to the program</h1>
        <p className="text-muted">
          Your listing is saved. To go live, hand the selected authorities to the escrow program
          <span className="font-mono text-xs"> {shortKey(cfg.programId, 6)}</span>. Nobody holds a key to it,
          so no person can take them, and cancelling returns them to you at any time before a sale.
        </p>
        <ul className="list-disc pl-5 text-sm text-muted">{authorities.map((a) => <li key={a}>{AUTH_LABELS[a]}</li>)}</ul>
        {error && <Alert kind="error">{error}</Alert>}
        <Button onClick={escrow} disabled={!!busy}>{busy ?? "Hand over & publish"}</Button>
      </div>
    );
  }

  const canSubmit = title && Number(priceSol) >= 0.01 && (type === "offchain" ? deliverables : token && (type === "pump_creator" || authorities.length > 0));

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
              {type === "token_authority" && (
                <div className="mt-4 space-y-2">
                  {(Object.keys(AUTH_LABELS) as AuthorityKind[]).map((k) => {
                    const cur = k === "mint" ? token.mintAuthority : k === "freeze" ? token.freezeAuthority : token.updateAuthority;
                    const mine = cur === me;
                    return (
                      <label key={k} className={`flex items-center gap-3  border px-3 py-2 text-sm ${mine ? "border-line" : "border-white/5 opacity-50"}`}>
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
              {type === "pump_creator" && (
                token.pump ? (
                  token.pump.creator === me
                    ? <Alert kind="success">You are the on-chain creator of this coin. Buyers will receive the creator role and its fee rights.</Alert>
                    : <Alert kind="error">The bonding curve lists {shortKey(token.pump.creator)} as creator, not your wallet.</Alert>
                ) : <Alert kind="error">This mint has no pump.fun bonding curve.</Alert>
              )}
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

      <Field label="Title"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} /></Field>
      <Field label="Description" hint="Buyers pay for proof: link the repo, the deployed site, the community, the numbers."><textarea className={inputCls} rows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What you built, what works today, holders / volume / community size, and why you're handing it over…" /></Field>
      <Field label="Price (SOL)" hint={`Platform fee ${cfg.feeBps / 100}% is deducted from your payout.`}>
        <input className={inputCls} type="number" min="0.01" step="0.01" value={priceSol} onChange={(e) => setPriceSol(e.target.value)} />
      </Field>

      {error && <Alert kind="error">{error}</Alert>}
      <Button onClick={create} disabled={!canSubmit || !!busy}>{busy ?? (type === "token_authority" ? "Continue to escrow" : "Publish listing")}</Button>
    </div>
  );
}
