import { updateListing } from "@/lib/db";
import { handleError, HttpError, json, readSigned, requireListing, requireStatus } from "@/lib/api-utils";
import { pumpCreatorIs, releaseToSeller } from "@/lib/solana";
export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { body, signer } = await readSigned<{ note?: string }>(req, "verify-handoff", id);
    const l = requireListing(id);
    requireStatus(l, "paid");
    if (signer !== l.seller && signer !== l.buyer) throw new HttpError(403, "Not a party to this listing");
    if (body.note && signer === l.seller) updateListing(id, { deliveryNote: String(body.note).slice(0, 2000) }, "delivery_note", { note: body.note });
    if (l.type === "pump_creator" && l.mint && l.buyer) {
      const r = await pumpCreatorIs(l.mint, l.buyer);
      if (r.ok) {
        const sig = await releaseToSeller(l);
        updateListing(id, { status: "sold", settlementSig: sig }, "released", { signature: sig, verifiedOnChain: true, creator: r.creator });
        return json({ verified: true, listing: requireListing(id) });
      }
      return json({ verified: false, creator: r.creator, listing: requireListing(id) });
    }
    return json({ verified: false, listing: requireListing(id) });
  } catch (e) { return handleError(e); }
}
