"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { api, signedDelete, signedPost } from "@/lib/client/api";
import { Alert, Button, Chip, Field, inputCls } from "@/components/ui";
import { BuilderChip } from "@/components/Builder";
import { formatSol, REQUEST_CATEGORY_LABELS, type BuildRequest, type Proposal } from "@/lib/types";

function when(ts: number) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export default function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const wallet = useWallet();
  const me = wallet.publicKey?.toBase58();

  const [data, setData] = useState<{ request: BuildRequest; proposals: Proposal[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [pitch, setPitch] = useState("");
  const [priceSol, setPriceSol] = useState("");
  const [days, setDays] = useState(14);

  const load = useCallback(async () => { setData(await api.request(id)); }, [id]);

  useEffect(() => {
    let off = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch((e) => { if (!off) setError((e as Error).message); });
    return () => { off = true; };
  }, [load]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setError(null); setBusy(label);
    try { await fn(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  if (error && !data) return <div className="wrap py-16"><Alert kind="error">{error}</Alert></div>;
  if (!data) return <p className="wrap py-16 text-muted">Loading…</p>;

  const { request: r, proposals } = data;
  const isPoster = me === r.poster;
  const mine = proposals.find((p) => p.dev === me) ?? null;
  const accepted = proposals.find((p) => p.status === "accepted") ?? null;
  const canPropose = !!me && !isPoster && r.status === "open";

  const propose = () => run("Sign your proposal…", () =>
    signedPost<Proposal>(wallet, `/api/requests/${id}/proposals`, "propose", id, {
      pitch, priceSol: Number(priceSol), deliveryDays: days,
    }).then(() => { setPitch(""); setPriceSol(""); }));

  const award = (p: Proposal) => run("Sign to award…", () =>
    signedPost(wallet, `/api/requests/${id}/proposals/${p.id}`, "award", id, {}));

  const withdrawProposal = (p: Proposal) => run("Withdrawing…", () =>
    signedDelete(wallet, `/api/requests/${id}/proposals/${p.id}`, "withdraw-proposal", id));

  const cancelRequest = () => run("Withdrawing…", () =>
    signedDelete(wallet, `/api/requests/${id}`, "cancel-request", id));

  return (
    <div className="wrap grid gap-10 py-10 lg:grid-cols-[1fr_340px]">
      <div className="space-y-8">
        <header>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tint="var(--color-teal)">{REQUEST_CATEGORY_LABELS[r.category]}</Chip>
            <Chip tint={r.status === "open" ? "var(--color-green)" : r.status === "awarded" ? "var(--color-blue)" : "var(--color-faint)"}>
              {r.status === "open" ? "Taking proposals" : r.status === "awarded" ? "Awarded" : "Withdrawn"}
            </Chip>
          </div>
          <h1 className="title-lg mt-3">{r.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px] text-muted">
            <span className="flex items-center gap-2">Posted by <BuilderChip wallet={r.poster} /></span>
            <span className="text-faint">{when(r.createdAt)}</span>
          </div>
        </header>

        <p className="whitespace-pre-wrap text-[16px] leading-relaxed">{r.brief}</p>

        <section className="space-y-4">
          <h2 className="text-[19px] font-bold text-ink">
            {proposals.length} {proposals.length === 1 ? "proposal" : "proposals"}
          </h2>

          {proposals.length === 0 && (
            <div className="note text-[15px] text-muted">
              No proposals yet. {canPropose ? "Yours would be the first one they read." : "Developers can answer this from their own wallet."}
            </div>
          )}

          {proposals.map((p) => (
            <div key={p.id} className={`card p-5 ${p.status === "accepted" ? "border-green" : ""}`}
              style={p.status === "accepted" ? { borderColor: "var(--color-green)" } : undefined}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <BuilderChip wallet={p.dev} />
                  {p.dev === me && <Chip>You</Chip>}
                  {p.status === "accepted" && <Chip tint="var(--color-green)">Chosen</Chip>}
                </div>
                <div className="text-right">
                  <div className="price">{formatSol(p.priceLamports)} <span className="text-[13px] font-semibold text-muted">SOL</span></div>
                  <div className="text-[13px] text-faint">in {p.deliveryDays} days</div>
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-body">{p.pitch}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {isPoster && r.status === "open" && (
                  <Button disabled={!!busy} onClick={() => award(p)}>{busy ?? "Choose this developer"}</Button>
                )}
                {p.dev === me && p.status === "open" && (
                  <Button variant="ghost" disabled={!!busy} onClick={() => withdrawProposal(p)}>Withdraw</Button>
                )}
              </div>
            </div>
          ))}
        </section>

        {canPropose && (
          <section className="card space-y-4 p-5">
            <h2 className="text-[19px] font-bold text-ink">{mine ? "Update your proposal" : "Offer to build it"}</h2>
            <Field label="How would you build it?" hint="What you would deliver, how you would approach it, anything you have built like it before.">
              <textarea className={inputCls} rows={5} value={pitch} onChange={(e) => setPitch(e.target.value)}
                placeholder="What you will deliver, how you will go about it, and what you have shipped before…" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Your price (SOL)" hint="This is the figure the escrow will hold.">
                <input className={inputCls} type="number" min={0.01} step={0.01} value={priceSol}
                  onChange={(e) => setPriceSol(e.target.value)} placeholder={String(r.budgetLamports / 1e9)} />
              </Field>
              <Field label="You need (days)">
                <input className={inputCls} type="number" min={1} max={90} value={days}
                  onChange={(e) => setDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))} />
              </Field>
            </div>
            {mine && <Alert kind="info">You already have a proposal here. Sending another replaces it.</Alert>}
            {error && <Alert kind="error">{error}</Alert>}
            <Button onClick={propose} disabled={!!busy || pitch.trim().length < 30 || !priceSol}>
              {busy ?? (mine ? "Replace my proposal" : "Send proposal")}
            </Button>
          </section>
        )}
      </div>

      {/* ----------------------------------------------------------- sidebar */}
      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <div className="card space-y-3 p-5">
          <div>
            <div className="kicker mb-1">Budget</div>
            <div className="price">{formatSol(r.budgetLamports)} <span className="text-[14px] font-semibold text-muted">SOL</span></div>
            <p className="mt-1 text-[13px] text-faint">Indicative. The agreed price is whatever proposal gets chosen.</p>
          </div>
          <div className="border-t border-line pt-3 text-[14px] text-muted">
            Wanted within <strong className="text-ink">{r.deliveryDays} days</strong>
          </div>
        </div>

        {!me && <Alert kind="info">Connect a wallet to propose.</Alert>}

        {r.status === "awarded" && accepted && (
          <div className="card space-y-3 p-5">
            <h3 className="text-[16px] font-bold text-ink">Awarded</h3>
            <div className="flex items-center gap-2 text-[14px]"><BuilderChip wallet={accepted.dev} /></div>
            <p className="text-[14px] text-muted">
              Agreed at <strong className="text-ink">{formatSol(accepted.priceLamports)} SOL</strong> over {accepted.deliveryDays} days.
            </p>

            {r.listingId ? (
              <>
                <p className="text-[14px] text-muted">The escrow for this work is open.</p>
                <Link href={`/listings/${r.listingId}`}>
                  <Button className="w-full">{isPoster ? "Go and fund it" : "Open the escrow"}</Button>
                </Link>
              </>
            ) : me === accepted.dev ? (
              <>
                <p className="text-[14px] text-muted">
                  Next: open the escrow at your agreed price. You are the seller here — the money sits in
                  the program until they confirm you delivered.
                </p>
                <Link href={`/sell?request=${r.id}&price=${accepted.priceLamports / 1e9}&days=${accepted.deliveryDays}&title=${encodeURIComponent(r.title)}`}>
                  <Button className="w-full">Open the escrow</Button>
                </Link>
              </>
            ) : (
              <p className="text-[14px] text-muted">
                Waiting for the developer to open the escrow. Nothing is owed until they do and you fund it.
              </p>
            )}
          </div>
        )}

        {isPoster && r.status === "open" && (
          <Button className="w-full" variant="danger" disabled={!!busy} onClick={cancelRequest}>
            {busy ?? "Withdraw this request"}
          </Button>
        )}

        <div className="note text-[13px] text-muted" style={{ ["--tint" as string]: "var(--color-blue)" }}>
          <strong className="text-ink">How payment works.</strong> Choosing somebody moves no money. The
          developer opens an escrow, you fund it, and the program holds the SOL until you confirm delivery.
          If they vanish, the deadline returns it to you and nobody — including us — can stop that.
        </div>
      </aside>
    </div>
  );
}
