import { getComment, getPost, insertComment, lastWroteAt, listComments } from "@/lib/db";
import { handleError, HttpError, json, readSigned } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

const COMMENT_COOLDOWN_MS = 12_000;
const MAX_DEPTH = 6;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const post = getPost(id);
    if (!post) throw new HttpError(404, "Post not found");
    if (post.removedAt) throw new HttpError(409, "This post was removed");

    const { body, signer } = await readSigned<{ body: string; parentId?: number | null }>(req, "comment", id);
    const text = (body.body ?? "").trim();
    if (text.length < 2) throw new HttpError(400, "Write something");
    if (text.length > 6000) throw new HttpError(400, "That reply is too long (6000 characters max)");

    // Walk up from the parent so a reply cannot be attached to another post's comment,
    // and so the thread cannot be nested past what the page can indent legibly.
    let parentId: number | null = null;
    if (body.parentId) {
      let cur = getComment(Number(body.parentId));
      if (!cur || cur.postId !== id) throw new HttpError(400, "That comment is not on this post");
      parentId = cur.id;
      let depth = 0;
      while (cur?.parentId) {
        if (++depth >= MAX_DEPTH) throw new HttpError(400, "This thread is as deep as it goes — reply higher up.");
        cur = getComment(cur.parentId);
      }
    }

    const since = Date.now() - lastWroteAt(signer);
    if (since < COMMENT_COOLDOWN_MS) {
      throw new HttpError(429, `Give it ${Math.ceil((COMMENT_COOLDOWN_MS - since) / 1000)}s before replying again.`);
    }

    return json(insertComment({ postId: id, parentId, author: signer, body: text }), 201);
  } catch (e) {
    return handleError(e);
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const me = new URL(req.url).searchParams.get("me") ?? "";
    return json(listComments(id, me));
  } catch (e) {
    return handleError(e);
  }
}
