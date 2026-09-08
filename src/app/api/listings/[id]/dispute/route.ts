import { updateListing } from "@/lib/db";
import { handleError, HttpError, json, readSigned, requireListing, requireStatus } from "@/lib/api-utils";
export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { body, signer } = await readSigned<{ reason: string }>(req, "dispute", id);
    const l = requireListing(id);
    requireStatus(l, "paid");
    if (signer !== l.seller && signer !== l.buyer) throw new HttpError(403, "Not a party to this listing");
    updateListing(id, { status: "disputed", disputeReason: String(body.reason ?? "").slice(0, 2000) }, "disputed", { by: signer, reason: body.reason });
    return json(requireListing(id));
  } catch (e) { return handleError(e); }
}
