import { updateListing } from "@/lib/db";
import { handleError, HttpError, json, readSigned, requireListing, requireStatus } from "@/lib/api-utils";
import { releaseToSeller } from "@/lib/solana";
export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { signer } = await readSigned(req, "release", id);
    const l = requireListing(id);
    requireStatus(l, "paid");
    if (l.buyer !== signer) throw new HttpError(403, "Only the buyer can release funds");
    const sig = await releaseToSeller(l);
    updateListing(id, { status: "sold", settlementSig: sig }, "released", { signature: sig });
    return json(requireListing(id));
  } catch (e) { return handleError(e); }
}
