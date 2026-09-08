import { updateListing } from "@/lib/db";
import { handleError, HttpError, json, readSigned, requireListing, requireStatus } from "@/lib/api-utils";
import { returnAuthoritiesToSeller } from "@/lib/solana";
export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { signer } = await readSigned(req, "cancel", id);
    const l = requireListing(id);
    if (l.seller !== signer) throw new HttpError(403, "Only the seller can cancel");
    requireStatus(l, "draft", "active");
    const sig = await returnAuthoritiesToSeller(l);
    updateListing(id, { status: "cancelled", settlementSig: sig }, "cancelled", { returnedSignature: sig });
    return json(requireListing(id));
  } catch (e) { return handleError(e); }
}
