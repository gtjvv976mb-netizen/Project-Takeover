import { castVote, getComment, getPost, myVote, scoreOf } from "@/lib/db";
import { handleError, HttpError, json, readSigned } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

/**
 * One vote per wallet per thing, and never on your own.
 *
 * Voting the same way twice clears it, which is what every arrow on the internet does.
 * Wallets are free to mint, so this stops one person voting twice from one wallet and
 * nothing more — the honest limit of any identity that costs nothing.
 */
export async function POST(req: Request) {
  try {
    const { body, signer } = await readSigned<{ kind: "post" | "comment"; id: string; value: number }>(req, "vote", null);

    if (body.kind !== "post" && body.kind !== "comment") throw new HttpError(400, "Vote on a post or a comment");
    const value = Number(body.value);
    if (![1, -1, 0].includes(value)) throw new HttpError(400, "A vote is up, down, or none");

    const author = body.kind === "post"
      ? getPost(String(body.id))?.author
      : getComment(Number(body.id))?.author;
    if (!author) throw new HttpError(404, "Nothing there to vote on");
    if (author === signer) throw new HttpError(400, "You cannot vote for yourself");

    const target = `${body.kind}:${body.id}`;
    // A second identical vote is a change of mind about voting at all.
    const next = myVote(target, signer) === value ? 0 : (value as 1 | -1 | 0);
    castVote(target, signer, next);

    return json({ score: scoreOf(target), myVote: next });
  } catch (e) {
    return handleError(e);
  }
}
