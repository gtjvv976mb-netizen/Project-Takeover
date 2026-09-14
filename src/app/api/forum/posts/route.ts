import { randomUUID } from "node:crypto";
import { insertPost, lastWroteAt, listPosts } from "@/lib/db";
import { handleError, HttpError, json, readSigned } from "@/lib/api-utils";
import { SECTIONS, type Section } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * A wallet costs nothing to create, so this is a speed bump against a flood rather than
 * sybil resistance. It buys time for a human to notice and report, which is the part
 * that actually works.
 */
const POST_COOLDOWN_MS = 45_000;

const VALID = new Set(SECTIONS.map((s) => s.id));

export async function GET(req: Request) {
  const u = new URL(req.url);
  const section = u.searchParams.get("section") ?? undefined;
  if (section && !VALID.has(section as Section)) throw new HttpError(400, "No such section");
  return json(listPosts({
    section,
    sort: (u.searchParams.get("sort") as "hot" | "new" | "top") ?? "hot",
    author: u.searchParams.get("author") ?? undefined,
    // Who is asking, so each row can carry how they voted without a second round trip.
    me: u.searchParams.get("me") ?? undefined,
  }));
}

export async function POST(req: Request) {
  try {
    const { body, signer } = await readSigned<{ section: Section; title: string; body: string }>(req, "post", null);

    if (!VALID.has(body.section)) throw new HttpError(400, "Pick a section");
    const title = (body.title ?? "").trim();
    const text = (body.body ?? "").trim();
    if (title.length < 8 || title.length > 140) throw new HttpError(400, "Titles run from 8 to 140 characters");
    if (text.length < 20) throw new HttpError(400, "Say a little more — at least 20 characters.");
    if (text.length > 12_000) throw new HttpError(400, "That post is too long (12 000 characters max)");

    const since = Date.now() - lastWroteAt(signer);
    if (since < POST_COOLDOWN_MS) {
      throw new HttpError(429, `Give it ${Math.ceil((POST_COOLDOWN_MS - since) / 1000)}s before posting again.`);
    }

    const now = Date.now();
    const post = { id: randomUUID().slice(0, 8), author: signer, section: body.section, title, body: text, createdAt: now, updatedAt: now };
    insertPost(post);
    return json({ ...post, score: 0, commentCount: 0, myVote: 0, removedAt: null }, 201);
  } catch (e) {
    return handleError(e);
  }
}
