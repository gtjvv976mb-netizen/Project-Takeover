"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { signedDelete, signedPost } from "@/lib/client/api";
import { Alert, Button, Chip, inputCls } from "@/components/ui";
import { BuilderChip } from "@/components/Builder";
import { Vote } from "@/components/Vote";
import { SECTION_LABELS, type ForumComment, type ForumPost } from "@/lib/types";

function ago(ts: number) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

/** Comments arrive flat and ordered; the tree is built here so the API stays simple. */
function tree(all: ForumComment[]) {
  const kids = new Map<number | null, ForumComment[]>();
  for (const c of all) {
    const k = c.parentId ?? null;
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k)!.push(c);
  }
  return kids;
}

export default function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const wallet = useWallet();
  const router = useRouter();
  const me = wallet.publicKey?.toBase58();

  const [post, setPost] = useState<ForumPost | null>(null);
  const [comments, setComments] = useState<ForumComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    const r = await fetch(`/api/forum/posts/${id}${me ? `?me=${me}` : ""}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Could not load this post");
    setPost(j.post);
    setComments(j.comments);
  }, [id, me]);

  useEffect(() => {
    let off = false;
    load().catch((e) => { if (!off) setError((e as Error).message); });
    return () => { off = true; };
  }, [load]);

  async function reply(parentId: number | null) {
    setError(null); setBusy("Sign to reply…");
    try {
      await signedPost(wallet, `/api/forum/posts/${id}/comments`, "comment", id, { body: draft, parentId });
      setDraft(""); setReplyTo(null);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function removePost() {
    setError(null); setBusy("Removing…");
    try {
      await signedDelete(wallet, `/api/forum/posts/${id}`, "remove-post", id);
      router.push("/forum");
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  if (error && !post) return <div className="wrap py-16"><Alert kind="error">{error}</Alert></div>;
  if (!post) return <p className="wrap py-16 text-muted">Loading…</p>;

  const kids = tree(comments);

  function Thread({ parent, depth }: { parent: number | null; depth: number }) {
    const list = kids.get(parent) ?? [];
    if (!list.length) return null;
    return (
      <div className={depth ? "mt-3 space-y-3 border-l border-line pl-4" : "space-y-4"}>
        {list.map((c) => (
          <div key={c.id}>
            <div className="flex gap-2.5">
              <Vote kind="comment" id={c.id} score={c.score} myVote={c.myVote} compact />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <BuilderChip wallet={c.author} />
                  {c.author === post!.author && <Chip tint="var(--color-violet)">author</Chip>}
                  <span className="text-faint">{ago(c.createdAt)}</span>
                </div>
                {c.removedAt ? (
                  <p className="mt-1 text-[14px] italic text-faint">Removed.</p>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-body">{c.body}</p>
                )}
                {me && !c.removedAt && (
                  <button className="mt-1 text-[13px] font-semibold text-muted hover:text-ink"
                    onClick={() => { setReplyTo(replyTo === c.id ? null : c.id); setDraft(""); }}>
                    {replyTo === c.id ? "Cancel" : "Reply"}
                  </button>
                )}
                {replyTo === c.id && (
                  <div className="mt-2 space-y-2">
                    <textarea className={inputCls} rows={3} value={draft} onChange={(e) => setDraft(e.target.value)}
                      placeholder="Your reply…" />
                    <Button disabled={!!busy || draft.trim().length < 2} onClick={() => reply(c.id)}>{busy ?? "Reply"}</Button>
                  </div>
                )}
              </div>
            </div>
            <Thread parent={c.id} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="wrap max-w-3xl space-y-8 py-10">
      <Link href="/forum" className="text-[14px] font-semibold text-muted hover:text-ink">← The board</Link>

      <article className="flex gap-4">
        <Vote kind="post" id={post.id} score={post.score} myVote={post.myVote} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Link href={`/forum?section=${post.section}`}>
              <Chip tint="var(--color-teal)">{SECTION_LABELS[post.section]}</Chip>
            </Link>
            <BuilderChip wallet={post.author} />
            <span className="text-faint">{ago(post.createdAt)}</span>
          </div>
          <h1 className="title-lg mt-2">{post.title}</h1>
          {post.removedAt ? (
            <p className="mt-4 italic text-faint">This post was removed.</p>
          ) : (
            <p className="mt-4 whitespace-pre-wrap text-[16px] leading-relaxed">{post.body}</p>
          )}

          {post.section === "hiring" && !post.removedAt && (
            <div className="note mt-5 text-[14px] text-muted">
              <strong className="text-ink">Want this built for real?</strong> A{" "}
              <Link className="underline" href="/requests">request</Link> takes proposals and holds the money in
              escrow until the work lands. This thread is the conversation before that.
            </div>
          )}

          {me === post.author && !post.removedAt && (
            <Button className="mt-5" variant="danger" disabled={!!busy} onClick={removePost}>
              {busy ?? "Delete this post"}
            </Button>
          )}
        </div>
      </article>

      <section className="space-y-4 border-t border-line pt-6">
        <h2 className="text-[18px] font-bold text-ink">
          {post.commentCount} {post.commentCount === 1 ? "reply" : "replies"}
        </h2>

        {me ? (
          replyTo === null && (
            <div className="space-y-2">
              <textarea className={inputCls} rows={4} value={draft} onChange={(e) => setDraft(e.target.value)}
                placeholder="Add a reply…" />
              <Button disabled={!!busy || draft.trim().length < 2} onClick={() => reply(null)}>{busy ?? "Reply"}</Button>
            </div>
          )
        ) : (
          <Alert kind="info">Connect a wallet to reply or vote.</Alert>
        )}

        {error && <Alert kind="error">{error}</Alert>}

        {comments.length === 0
          ? <p className="text-[15px] text-muted">No replies yet.</p>
          : <Thread parent={null} depth={0} />}
      </section>
    </div>
  );
}
