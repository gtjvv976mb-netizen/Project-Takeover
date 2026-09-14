import { getRequest, listProposals, updateRequest } from "@/lib/db";
import { handleError, HttpError, json, readSigned } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

function requireRequest(id: string) {
  const r = getRequest(id);
  if (!r) throw new HttpError(404, "Request not found");
  return r;
}

/** The request and every live proposal on it. Proposals are public: a developer deciding
 *  whether to bid deserves to see what they are bidding against. */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const request = requireRequest(id);
    return json({ request, proposals: listProposals(id) });
  } catch (e) {
    return handleError(e);
  }
}

/** Withdraw a request. Only the poster, and only before it is awarded. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const request = requireRequest(id);
    const { signer } = await readSigned(req, "cancel-request", id);
    if (signer !== request.poster) throw new HttpError(403, "Only the person who posted this can withdraw it");
    if (request.status === "awarded") {
      throw new HttpError(409, "This is already awarded. Settle or cancel the escrow instead — the developer may have started work.");
    }
    updateRequest(id, { status: "cancelled" });
    return json(getRequest(id));
  } catch (e) {
    return handleError(e);
  }
}
