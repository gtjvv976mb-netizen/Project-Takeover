import { addReport, reportCount } from "@/lib/db";
import { handleError, HttpError, json, readSigned, requireListing } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

/**
 * Report a listing.
 *
 * An off-chain listing carries no on-chain proof of who owns the thing being sold, so the
 * person best placed to notice that one is fraudulent is whoever actually owns it. Until
 * now they had nowhere to say so.
 *
 * A report is signed by the reporter's wallet, which costs them nothing but makes the
 * claim attributable and keeps one wallet to one report per listing. Reports do not take a
 * listing down by themselves — that would hand anybody a censor's button — they queue it
 * for an admin, and the count is public so a buyer can weigh it.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { body, signer } = await readSigned<{ reason?: string }>(req, "report", id);
    const l = requireListing(id);
    if (signer === l.seller) throw new HttpError(400, "You cannot report your own listing. Cancel it instead.");
    const reason = String(body.reason ?? "").trim().slice(0, 1000);
    if (reason.length < 10) throw new HttpError(400, "Say what is wrong with this listing, in at least a sentence");

    const filed = addReport(id, signer, reason);
    return json({ filed, alreadyReported: !filed, reports: reportCount(id) }, filed ? 201 : 200);
  } catch (e) { return handleError(e); }
}

/** How many open reports this listing carries. Public: a buyer should see it. */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const l = requireListing((await ctx.params).id);
    return json({ reports: reportCount(l.id) });
  } catch (e) { return handleError(e); }
}
