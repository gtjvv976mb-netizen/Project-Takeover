import { PublicKey } from "@solana/web3.js";
import { updateListing } from "@/lib/db";
import { handleError, HttpError, json, readSigned, requireListing, requireStatus } from "@/lib/api-utils";
import { settleTokenAuthoritySale } from "@/lib/solana";
export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { signer } = await readSigned(req, "settle", id);
    const l = requireListing(id);
    requireStatus(l, "paid");
    if (l.type !== "token_authority" || !l.buyer) throw new HttpError(400, "Nothing to settle automatically");
    if (signer !== l.buyer && signer !== l.seller) throw new HttpError(403, "Not a party to this listing");
    const sig = await settleTokenAuthoritySale(l, new PublicKey(l.buyer));
    updateListing(id, { status: "sold", settlementSig: sig }, "settled", { signature: sig, retriedBy: signer });
    return json(requireListing(id));
  } catch (e) { return handleError(e); }
}
