import { getPost, listComments, setPostRemoved } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { handleError, HttpError, json, readSigned } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const me = new URL(req.url).searchParams.get("me") ?? "";
    const post = getPost(id, me);
    if (!post) throw new HttpError(404, "Post not found");
    return json({ post, comments: listComments(id, me) });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * Take a post down. Its author can, and so can an admin.
 *
 * The row is kept and only marked, because a thread with its replies deleted underneath
 * them reads as though the repliers were talking to themselves, and because a removal
 * somebody disputes later needs to still exist to be looked at.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const post = getPost(id);
    if (!post) throw new HttpError(404, "Post not found");
    const { signer } = await readSigned(req, "remove-post", id);
    if (signer !== post.author && !isAdmin(signer)) throw new HttpError(403, "Only the author can delete this");
    setPostRemoved(id, true);
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
