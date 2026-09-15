"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { api, signedPost } from "@/lib/client/api";
import { Alert, Button, Chip, Field, inputCls } from "@/components/ui";
import { formatSol, REQUEST_CATEGORY_LABELS, type BuildRequest, type RequestCategory } from "@/lib/types";

const STATUS_TINT: Record<BuildRequest["status"], string> = {
  open: "var(--color-green)",
  awarded: "var(--color-blue)",
  cancelled: "var(--color-faint)",
};

function RequestCard({ r }: { r: BuildRequest }) {
  return (
    <Link href={`/requests/${r.id}`} className="card card-hover flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tint="var(--color-teal)">{REQUEST_CATEGORY_LABELS[r.category]}</Chip>
        <Chip tint={STATUS_TINT[r.status]}>{r.status === "open" ? "Taking proposals" : r.status === "awarded" ? "Awarded" : "Withdrawn"}</Chip>
      </div>
      <div>
        <h3 className="text-[18px] font-bold leading-snug text-ink">{r.title}</h3>
        <p className="clamp-2 mt-1 text-[14px] leading-relaxed text-muted">{r.brief}</p>
      </div>
      <div className="mt-auto flex items-end justify-between border-t border-line pt-3">
        <div>
          <div className="kicker mb-0.5">Budget</div>
          <div className="price">{formatSol(r.budgetLamports)} <span className="text-[13px] font-semibold text-muted">SOL</span></div>
        </div>
        <div className="text-right text-[13px] text-muted">
          <div>{r.proposalCount} {r.proposalCount === 1 ? "proposal" : "proposals"}</div>
          <div className="text-faint">wants it in {r.deliveryDays}d</div>
        </div>
      </div>
    </Link>
  );
}

export default function RequestsPage() {
  const wallet = useWallet();
  const router = useRouter();
  const me = wallet.publicKey?.toBase58();
  const [rows, setRows] = useState<BuildRequest[] | null>(null);
  const [status, setStatus] = useState<"open" | "awarded" | "all">("open");
  const [posting, setPosting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [category, setCategory] = useState<RequestCategory>("site");
  const [budgetSol, setBudgetSol] = useState("");
  const [deliveryDays, setDeliveryDays] = useState(21);

  const load = useCallback(() => {
    api.requests({ status }).then(setRows).catch(() => setRows([]));
  }, [status]);

  useEffect(() => {
    let off = false;
    api.requests({ status }).then((r) => { if (!off) setRows(r); }).catch(() => { if (!off) setRows([]); });
    return () => { off = true; };
  }, [status]);

  // The front page and the footer link straight to "#post": somebody who clicked
  // "Post a request" should land on the form, not on a list with a button above it.
  // A hash rather than a query string, so this page needs no Suspense boundary.
  useEffect(() => {
    // The hash is external state the server cannot see, so it cannot be a lazy initial
    // value without a hydration mismatch; reading it once after mount is the honest way.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (window.location.hash === "#post") setPosting(true);
  }, []);

  async function post() {
    setError(null); setBusy("Sign to post…");
    try {
      const r = await signedPost<BuildRequest>(wallet, "/api/requests", "request", null, {
        title, brief, category, budgetSol: Number(budgetSol), deliveryDays,
      });
      setPosting(false);
      setTitle(""); setBrief(""); setBudgetSol("");
      load();
      router.push(`/requests/${r.id}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <div className="wrap space-y-8 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="title-lg">Work people want built</h1>
          <p className="lead mt-2">
            The other half of the market. Describe what you need, developers say how they would
            build it and what they would charge, and the one you pick gets paid through the same
            escrow everything else here uses.
          </p>
        </div>
        {me && !posting && <Button onClick={() => setPosting(true)}>Post what you need</Button>}
      </header>

      {!me && <Alert kind="info">Connect a wallet to post a request or send a proposal. Reading needs nothing.</Alert>}

      {posting && (
        <div id="post" className="card scroll-mt-24 space-y-4 p-5">
          <h2 className="text-[19px] font-bold text-ink">What do you want built?</h2>
          <Field label="One line">
            <input className={inputCls} value={title} maxLength={90} onChange={(e) => setTitle(e.target.value)}
              placeholder="A Telegram bot that posts new pump.fun graduations" />
          </Field>
          <Field label="The brief" hint="Scope, what done looks like, anything you already have. Vague briefs get vague proposals — and vague proposals are what disputes are made of.">
            <textarea className={inputCls} rows={6} value={brief} onChange={(e) => setBrief(e.target.value)}
              placeholder="What it should do, who it is for, what you will hand over (repo, hosting, API keys), and how you will judge that it works…" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Category">
              <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as RequestCategory)}>
                {(Object.keys(REQUEST_CATEGORY_LABELS) as RequestCategory[]).map((c) => (
                  <option key={c} value={c}>{REQUEST_CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </Field>
            <Field label="Budget (SOL)" hint="Indicative.">
              <input className={inputCls} type="number" min={0.01} step={0.01} value={budgetSol}
                onChange={(e) => setBudgetSol(e.target.value)} placeholder="5" />
            </Field>
            <Field label="Wanted within (days)">
              <input className={inputCls} type="number" min={1} max={90} value={deliveryDays}
                onChange={(e) => setDeliveryDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))} />
            </Field>
          </div>
          <p className="text-[13px] text-faint">
            Posting costs nothing and commits nothing — no wallet transaction, no SOL moved. You only
            escrow money once you have picked someone.
          </p>
          {error && <Alert kind="error">{error}</Alert>}
          <div className="flex gap-2">
            <Button onClick={post} disabled={!!busy || !title || brief.length < 40 || !budgetSol}>{busy ?? "Post it"}</Button>
            <Button variant="ghost" onClick={() => { setPosting(false); setError(null); }}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="seg">
          {([["open", "Taking proposals"], ["awarded", "Awarded"], ["all", "Everything"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setStatus(v)} aria-pressed={status === v}>{label}</button>
          ))}
        </div>
        {rows && <span className="kicker">{rows.length} {rows.length === 1 ? "request" : "requests"}</span>}
      </div>

      {rows === null ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-52" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="note grid place-items-center px-6 py-16 text-center">
          <div className="text-4xl" aria-hidden>🧰</div>
          <h3 className="mt-3 text-[19px] font-bold text-ink">Nothing here yet</h3>
          <p className="mt-1.5 max-w-sm text-[15px] text-muted">
            {status === "open"
              ? "Nobody has asked for anything yet. If you need something built, you would be the first — and the first request gets every developer's attention."
              : "Nothing in this state."}
          </p>
          {me && status === "open" && <Button className="mt-4" onClick={() => setPosting(true)}>Post what you need</Button>}
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => <RequestCard key={r.id} r={r} />)}
        </div>
      )}

    </div>
  );
}
