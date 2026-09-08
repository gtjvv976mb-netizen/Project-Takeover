import { updateListing } from "@/lib/db";
import { handleError, HttpError, json, readSigned, requireListing } from "@/lib/api-utils";
export const dynamic = "force-dynamic";

/** A seller's delivery note. Descriptive text only — it moves no money. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { body, signer } = await readSigned<{ note: string }>(req, "note", id);
    const l = requireListing(id);
    if (l.seller !== signer) throw new HttpError(403, "Only the seller can leave a delivery note");
    updateListing(id, { deliveryNote: String(body.note ?? "").slice(0, 2000) }, "delivery_note", {});
    return json(requireListing(id));
  } catch (e) { return handleError(e); }
}
