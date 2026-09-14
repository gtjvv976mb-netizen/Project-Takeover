"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { signedPost } from "@/lib/client/api";
import { Alert, Button, Chip, Field, inputCls } from "@/components/ui";
import { BuilderChip } from "@/components/Builder";
import { Vote } from "@/components/Vote";
import { SECTIONS, SECTION_LABELS, type ForumPost, type Section } from "@/lib/types";

function ago(ts: number) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

export default function ForumPage() {
  return (
    <Suspense fallback={<p className="wrap py-10 text-muted">Loading…</p>}>
      <Forum />
    </Suspense>
  );
}

function Forum() {
  const wallet = useWallet();
  const router = useRouter();
  const params = useSearchParams();
  const me = wallet.publicKey?.toBase58();

  const section = (params.get("section") ?? "") as Section | "";
  const sort = (params.get("sort") ?? "hot") as "hot" | "new" | "top";

  const [posts, setPosts] = useState<ForumPost[] | null>(null);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newSection, setNewSection] = useState<Section>("general");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const go = useCallback((next: Record<string, string>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v); else q.delete(k);
    }
    router.push(`/forum?${q.toString()}`);
  }, [params, router]);

  useEffect(() => {
    let off = false;
    const q = new URLSearchParams({ sort });
    if (section) q.set("section", section);
    if (me) q.set("me", me);
    fetch(`/api/forum/posts?${q}`).then((r) => r.json())
      .then((p) => { if (!off) setPosts(Array.isArray(p) ? p : []); })
      .catch(() => { if (!off) setPosts([]); });
    return () => { off = true; };
  }, [section, sort, me]);

  async function submit() {
    setError(null); setBusy("Sign to post…");
    try {
      const p = await signedPost<ForumPost>(wallet, "/api/forum/posts", "post", null, { section: newSection, title, body });
      router.push(`/forum/${p.id}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <div className="wrap grid gap-8 py-10 lg:grid-cols-[1fr_280px]">
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="title-lg">The board</h1>
            <p className="lead mt-2">
              Where people say what they need and builders say what they do. Anyone can post;
              the wallet you post from is the same one that carries your track record.
            </p>
          </div>
          {me && !writing && <Button onClick={() => setWriting(true)}>New post</Button>}
        </header>

        {!me && <Alert kind="info">Reading is open to everyone. Connect a wallet to post, reply or vote.</Alert>}

        {writing && (
          <div className="card space-y-4 p-5">
            <Field label="Section">
              <select className={inputCls} value={newSection} onChange={(e) => setNewSection(e.target.value as Section)}>
                {SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.emoji} {s.label} — {s.blurb}</option>)}
              </select>
            </Field>
            <Field label="Title">
              <input className={inputCls} value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)}
                placeholder="Looking for someone who has shipped an Anchor program" />
            </Field>
            <Field label="Post">
              <textarea className={inputCls} rows={7} value={body} onChange={(e) => setBody(e.target.value)}
                placeholder="The detail. What you need, what you have, what good looks like…" />
            </Field>
            {newSection === "hiring" && (
              <Alert kind="info">
                If you want this built for money with the escrow behind it, a{" "}
                <Link className="underline" href="/requests">request</Link> is the version that takes
                proposals and holds the SOL. Post here for the looser conversation first.
              </Alert>
            )}
            {error && <Alert kind="error">{error}</Alert>}
            <div className="flex gap-2">
              <Button onClick={submit} disabled={!!busy || title.trim().length < 8 || body.trim().length < 20}>{busy ?? "Post"}</Button>
              <Button variant="ghost" onClick={() => { setWriting(false); setError(null); }}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-line bg-surface p-1">
            {(["hot", "new", "top"] as const).map((s) => (
              <button key={s} onClick={() => go({ sort: s })}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold capitalize transition-colors ${sort === s ? "bg-brand text-white" : "text-muted hover:text-ink"}`}>
                {s}
              </button>
            ))}
          </div>
          {section && (
            <button className="pill" onClick={() => go({ section: "" })} style={{ ["--tint" as string]: "var(--color-teal)" }}>
              {SECTION_LABELS[section]} ✕
            </button>
          )}
        </div>

        {posts === null ? (
          <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24" />)}</div>
        ) : posts.length === 0 ? (
          <div className="note grid place-items-center px-6 py-16 text-center">
            <div className="text-4xl" aria-hidden>💬</div>
            <h3 className="mt-3 text-[19px] font-bold text-ink">Nothing posted here yet</h3>
            <p className="mt-1.5 max-w-sm text-[15px] text-muted">
              Someone has to go first. A question, something you shipped, or what you are available to build.
            </p>
            {me && <Button className="mt-4" onClick={() => setWriting(true)}>Write the first one</Button>}
          </div>
        ) : (
          <div className="space-y-3">
            {posts.map((p) => (
              <article key={p.id} className="card flex gap-3 p-4">
                <Vote kind="post" id={p.id} score={p.score} myVote={p.myVote} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <Chip tint="var(--color-teal)">{SECTION_LABELS[p.section]}</Chip>
                    <BuilderChip wallet={p.author} />
                    <span className="text-faint">{ago(p.createdAt)}</span>
                  </div>
                  <Link href={`/forum/${p.id}`} className="mt-1.5 block">
                    <h2 className="text-[18px] font-bold leading-snug text-ink hover:text-brand">{p.title}</h2>
                    <p className="clamp-2 mt-1 text-[14px] leading-relaxed text-muted">{p.body}</p>
                  </Link>
                  <Link href={`/forum/${p.id}`} className="mt-2 inline-block text-[13px] font-semibold text-muted hover:text-ink">
                    {p.commentCount} {p.commentCount === 1 ? "reply" : "replies"}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <div className="card p-4">
          <h2 className="kicker mb-3">Sections</h2>
          <div className="space-y-1">
            {SECTIONS.map((s) => (
              <button key={s.id} onClick={() => go({ section: s.id })}
                className={`block w-full rounded-lg px-2.5 py-2 text-left transition-colors ${section === s.id ? "bg-bg-2" : "hover:bg-bg-2"}`}>
                <span className="text-[14px] font-semibold text-ink">{s.emoji} {s.label}</span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-faint">{s.blurb}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="note text-[13px] text-muted" style={{ ["--tint" as string]: "var(--color-blue)" }}>
          <strong className="text-ink">Talk is cheap here, on purpose.</strong> Anyone with a wallet can post,
          and a wallet costs nothing — so treat a high score as a sign somebody is around, not as proof they
          deliver. <Link className="underline" href="/builders">The builders directory</Link> counts settled
          deals separately for exactly that reason.
        </div>
      </aside>
    </div>
  );
}
