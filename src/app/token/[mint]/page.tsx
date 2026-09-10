"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { signedPost } from "@/lib/client/api";
import { acceptOfferOnChain, cancelOfferOnChain, makeOfferOnChain } from "@/lib/client/program";
import { formatSol, shortKey, type AuthorityKind, type Listing, type TokenInfo, type WantedEntry } from "@/lib/types";
import { Alert, Button, Chip, Field, inputCls, ListingCard, Sigil } from "@/components/ui";
import { CoverArt } from "@/components/CoverArt";
import { explorerUrl, useConfig } from "@/components/ConfigContext";

type Dossier = {
  mint: string;
  token: TokenInfo | null;
  wanted: WantedEntry[];
  listings: Listing[];
  forSale: Listing | null;
};

/** One fact read from the chain, with a plain-language reading of what it means. */
function Fact({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "good" | "warn" }) {
  const color = tone === "good" ? "var(--color-green)" : tone === "warn" ? "var(--color-rose)" : undefined;
  return (
    <div className="border-t border-line py-2.5">
      <div className="kicker">{label}</div>
      <div className="mt-1 text-[15px] font-semibold" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}

type Offer = {
  account: string; buyer: string; mint: string; id: string;
  priceLamports: number; escrowedLamports: number; expiry: number;
  authorities: AuthorityKind[]; status: string;
};

const AUTH_LABEL: Record<AuthorityKind, string> = {
  mint: "mint", freeze: "freeze", metadata_update: "metadata",
};

export default function TokenPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = use(params);
  const wallet = useWallet();
  const { connection } = useConnection();
  const cfg = useConfig();
  const me = wallet.publicKey?.toBase58();

  const [d, setD] = useState<Dossier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [price, setPrice] = useState("");
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [bid, setBid] = useState("");
  const [bidAuths, setBidAuths] = useState<AuthorityKind[]>(["mint", "metadata_update"]);

  const load = useCallback(async () => {
    const r = await fetch(`/api/token/${mint}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Could not read that token");
    setD(j);
    // Offers come straight from the chain, so the page never shows a bid that is not
    // really there to be taken.
    try {
      const o = await fetch(`/api/offers?mint=${mint}`).then((x) => x.json());
      setOffers(Array.isArray(o) ? o : []);
    } catch { setOffers([]); }
  }, [mint]);

  useEffect(() => {
    let off = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch((e) => { if (!off) setError((e as Error).message); });
    return () => { off = true; };
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const placeBid = () => run(async () => {
    const lamports = Math.round(Number(bid) * 1e9);
    if (!Number.isFinite(lamports) || lamports <= 0) throw new Error("Enter an amount in SOL");
    if (!bidAuths.length) throw new Error("Pick at least one control to bid for");
    await makeOfferOnChain(connection, wallet, {
      id: `${Date.now().toString(36)}${Math.floor(performance.now()).toString(36)}`.slice(0, 15),
      mint, priceLamports: lamports, authorities: bidAuths, expiryDays: 14,
    });
    setBid("");
  });

  const acceptBid = (o: Offer) => run(() =>
    acceptOfferOnChain(connection, wallet, {
      id: o.id, buyer: o.buyer, treasury: cfg.treasury, mint,
      includesMetadata: o.authorities.includes("metadata_update"),
    }));

  const withdrawBid = (o: Offer) => run(() => cancelOfferOnChain(connection, wallet, { id: o.id, buyer: o.buyer }));

  async function want(remove = false) {
    setBusy(true); setError(null);
    try {
      await signedPost(wallet, "/api/wanted", "want", null, { mint, note, indicativeSol: Number(price) || 0, remove });
      setNote(""); setPrice("");
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (error && !d) return <div className="wrap py-16"><Alert kind="error">{error}</Alert></div>;
  if (!d) return <div className="wrap py-16 text-muted">Reading the chain…</div>;

  const t = d.token;
  const mine = d.wanted.find((w) => w.addedBy === me);
  const revoked = t ? !t.mintAuthority && !t.freezeAuthority : false;
  const owner = t?.pump?.creator ?? t?.updateAuthority ?? t?.mintAuthority ?? null;
  const socials = t?.socials ?? {};
  const hasSocials = Boolean(socials.twitter || socials.telegram || socials.website);
  const top10 = t?.holders ? t.holders.top10Share * 100 : null;

  const shareText = `I want to buy ${t?.name ?? "this project"}${t?.symbol ? ` ($${t.symbol})` : ""} on Project: Takeover`;
  const shareUrl = typeof window !== "undefined" ? window.location.href : "";

  return (
    <div className="wrap grid gap-10 py-10 lg:grid-cols-[1fr_380px]">
      <div className="space-y-8">
        <header>
          <CoverArt seed={mint} image={t?.image} symbol={t?.symbol} className="aspect-[21/9] w-full" rounded="rounded-2xl" />
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {t?.pump ? <Chip tint="var(--color-tangerine)">pump.fun coin</Chip> : <Chip tint="var(--color-violet)">SPL token</Chip>}
            {revoked && <Chip tint="var(--color-blue)">Authorities revoked</Chip>}
            {t?.pump?.complete && <Chip tint="var(--color-blue)">Graduated</Chip>}
            {d.forSale && <Chip tint="var(--color-green)">For sale now</Chip>}
          </div>
          <h1 className="title-lg mt-3">{t?.name ?? "Unknown token"} {t?.symbol && <span className="text-muted">${t.symbol}</span>}</h1>
          {t?.description && <p className="lead mt-3">{t.description}</p>}
          <a className="mono mt-3 inline-block break-all text-[13px] text-blue hover:underline"
            href={explorerUrl(cfg, "address", mint)} target="_blank" rel="noreferrer">{mint}</a>
        </header>

        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="kicker mb-1">Read from the chain</h2>
          <div className="grid gap-x-8 sm:grid-cols-2">
            <Fact label="Supply" value={t?.supply && t.decimals !== undefined ? (Number(t.supply) / 10 ** t.decimals).toLocaleString() : "—"} />
            <Fact label="Mint authority" value={t?.mintAuthority ? shortKey(t.mintAuthority, 6) : "revoked — supply is fixed"} tone={t?.mintAuthority ? undefined : "good"} />
            <Fact label="Freeze authority" value={t?.freezeAuthority ? shortKey(t.freezeAuthority, 6) : "revoked"} tone={t?.freezeAuthority ? "warn" : "good"} />
            <Fact label="Metadata" value={t?.updateAuthority ? `editable by ${shortKey(t.updateAuthority, 6)}` : "locked"} />
            {top10 !== null && (
              <Fact label="Top 10 holders" value={`${top10.toFixed(1)}% of supply`} tone={top10 > 50 ? "warn" : "good"} />
            )}
            {t?.pump && <Fact label="pump.fun creator" value={shortKey(t.pump.creator, 6)} />}
          </div>
        </section>

        {d.listings.length > 0 && (
          <section>
            <h2 className="mb-3 text-[20px] font-bold text-ink">On this marketplace</h2>
            <div className="grid gap-5 sm:grid-cols-2">{d.listings.map((l) => <ListingCard key={l.id} l={l} />)}</div>
          </section>
        )}

        <section>
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-[20px] font-bold text-ink">Funded offers</h2>
            {offers && offers.length > 0 && (
              <span className="pill" style={{ ["--tint" as string]: "var(--color-green)" }}>
                {formatSol(offers.reduce((a, o) => a + o.escrowedLamports, 0))} SOL locked
              </span>
            )}
          </div>
          <p className="mb-4 mt-1 text-[14px] text-muted">
            Real SOL, already locked on chain. If you hold the controls, accepting pays you instantly.
          </p>

          {offers === null ? (
            <div className="skeleton h-20" />
          ) : offers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line p-8 text-center text-[15px] text-muted">
              No funded offers yet.
            </div>
          ) : (
            <ul className="space-y-2">
              {offers.map((o) => {
                const mineBid = o.buyer === me;
                return (
                  <li key={o.account} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4">
                    <Sigil wallet={o.buyer} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-[20px] font-bold text-ink">{formatSol(o.priceLamports)} SOL</span>
                        <span className="text-[13px] text-muted">from {shortKey(o.buyer, 4)}{mineBid && " (you)"}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {o.authorities.map((a) => <Chip key={a}>{AUTH_LABEL[a]}</Chip>)}
                        <Chip tint="var(--color-faint)">expires {new Date(o.expiry * 1000).toLocaleDateString()}</Chip>
                      </div>
                    </div>
                    {me && (mineBid ? (
                      <Button variant="secondary" onClick={() => withdrawBid(o)} disabled={busy}>Withdraw</Button>
                    ) : (
                      <Button onClick={() => acceptBid(o)} disabled={busy}>Accept &amp; get paid</Button>
                    ))}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-1 text-[20px] font-bold text-ink">Also interested ({d.wanted.length})</h2>
          <p className="mb-4 text-[14px] text-muted">
            Interest registered here is a signal, not a commitment. Nobody&apos;s money is locked.
          </p>
          {d.wanted.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line p-8 text-center text-[15px] text-muted">
              Nobody has asked for this one yet. Be the first.
            </div>
          ) : (
            <ul className="space-y-2">
              {d.wanted.map((w) => (
                <li key={w.addedBy} className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4">
                  <Sigil wallet={w.addedBy} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <Link href={`/builders/${w.addedBy}`} className="font-semibold text-ink hover:text-brand">{shortKey(w.addedBy, 4)}</Link>
                      {w.indicativeLamports > 0 && (
                        <span className="text-[15px] font-bold text-brand">~{formatSol(w.indicativeLamports)} SOL</span>
                      )}
                      <span className="text-[13px] text-faint">{new Date(w.createdAt).toLocaleDateString()}</span>
                    </div>
                    {w.note && <p className="mt-1 text-[14px] leading-relaxed text-muted">{w.note}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className="h-fit space-y-4 lg:sticky lg:top-24">
        {d.forSale ? (
          <div className="card p-5">
            <div className="kicker">Already for sale</div>
            <div className="mt-1 text-[30px] font-bold text-ink">{formatSol(d.forSale.priceLamports)} <span className="text-[15px] text-muted">SOL</span></div>
            <Link href={`/listings/${d.forSale.id}`} className="mt-4 block"><Button className="w-full">Go to the listing</Button></Link>
          </div>
        ) : (
          <div className="card p-5">
            <div className="kicker">Not for sale yet</div>
            <h2 className="mt-1 text-[19px] font-bold text-ink">Tell the owner you want it</h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
              Register your interest publicly. If the owner ever looks up their own token, this is what they see.
            </p>
            {!me ? (
              <Alert kind="warn"><span className="text-[14px]">Connect a wallet to add your name.</span></Alert>
            ) : mine ? (
              <div className="mt-4 space-y-3">
                <Alert kind="success"><span className="text-[14px]">You&apos;re on the list for this one.</span></Alert>
                <Button variant="secondary" className="w-full" onClick={() => want(true)} disabled={busy}>Remove me</Button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <Field label="What would you pay? (optional)" hint="Indicative only. Nothing is locked.">
                  <input className={inputCls} type="number" min="0" step="0.1" placeholder="e.g. 12" value={price} onChange={(e) => setPrice(e.target.value)} />
                </Field>
                <Field label="Message to the owner (optional)">
                  <textarea className={inputCls} rows={3} maxLength={500} placeholder="What you'd do with it." value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <Button className="w-full" onClick={() => want(false)} disabled={busy}>{busy ? "Signing…" : "I want to buy this"}</Button>
              </div>
            )}
            {error && <div className="mt-3"><Alert kind="error">{error}</Alert></div>}
          </div>
        )}

        {me && !d.forSale && (
          <div className="card p-5">
            <div className="kicker">Put money behind it</div>
            <h2 className="mt-1 text-[19px] font-bold text-ink">Make a funded offer</h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
              Your SOL locks on chain for 14 days. Only someone who genuinely holds these controls can
              take it, and you can withdraw any time before they do.
            </p>
            <div className="mt-4 space-y-3">
              <Field label="Your offer in SOL">
                <input className={inputCls} type="number" min="0.01" step="0.1" placeholder="e.g. 8"
                  value={bid} onChange={(e) => setBid(e.target.value)} />
              </Field>
              <div>
                <div className="mb-1.5 text-[14px] font-semibold text-ink">What you want</div>
                <div className="flex flex-wrap gap-2">
                  {(["mint", "freeze", "metadata_update"] as AuthorityKind[]).map((a) => {
                    const on = bidAuths.includes(a);
                    return (
                      <button key={a} type="button"
                        onClick={() => setBidAuths(on ? bidAuths.filter((x) => x !== a) : [...bidAuths, a])}
                        className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                          on ? "border-brand bg-brand text-white" : "border-line text-muted hover:text-ink"}`}>
                        {AUTH_LABEL[a]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Button className="w-full" onClick={placeBid} disabled={busy || !bid}>
                {busy ? "Signing…" : "Lock the offer on chain"}
              </Button>
            </div>
          </div>
        )}

        <div className="card p-5">
          <div className="kicker">Reach the owner</div>
          {hasSocials ? (
            <>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
                Links the creator published in the token&apos;s own metadata. We never message anyone —
                if you want them to know, tell them yourself.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {socials.twitter && <a className="btn btn-secondary !py-2 !text-[13px]" href={socials.twitter} target="_blank" rel="noreferrer noopener">X / Twitter ↗</a>}
                {socials.telegram && <a className="btn btn-secondary !py-2 !text-[13px]" href={socials.telegram} target="_blank" rel="noreferrer noopener">Telegram ↗</a>}
                {socials.website && <a className="btn btn-secondary !py-2 !text-[13px]" href={socials.website} target="_blank" rel="noreferrer noopener">Website ↗</a>}
                {t?.pump && <a className="btn btn-secondary !py-2 !text-[13px]" href={`https://pump.fun/coin/${mint}`} target="_blank" rel="noreferrer noopener">pump.fun ↗</a>}
              </div>
              <button
                className="btn btn-ghost mt-3 w-full !text-[13px]"
                onClick={() => navigator.clipboard?.writeText(`${shareText}\n${shareUrl}`)}
              >
                Copy a message to send them
              </button>
            </>
          ) : (
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
              This token published no socials in its metadata. The owner&apos;s wallet is{" "}
              <span className="mono break-all text-[13px]">{shortKey(owner, 6)}</span>.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
