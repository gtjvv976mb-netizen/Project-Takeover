import { updateListing } from "@/lib/db";
import { handleError, HttpError, json, readSigned, requireListing, requireStatus } from "@/lib/api-utils";
import { authoritiesHeldBy, escrowKeypair } from "@/lib/solana";
import type { TokenAuthorityAsset } from "@/lib/types";
export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { body, signer } = await readSigned<{ signature?: string }>(req, "verify-escrow", id);
    const l = requireListing(id);
    if (l.seller !== signer) throw new HttpError(403, "Only the seller can do this");
    requireStatus(l, "draft");
    const a = l.asset as TokenAuthorityAsset;
    const { held, missing, token } = await authoritiesHeldBy(a.mint, a.authorities, escrowKeypair().publicKey);
    if (missing.length) throw new HttpError(409, `Escrow does not yet hold: ${missing.join(", ")}. Confirm the transfer transaction and retry.`);
    updateListing(id, { status: "active", escrowSig: body.signature ?? null, token }, "escrowed", { held, signature: body.signature });
    return json(requireListing(id));
  } catch (e) { return handleError(e); }
}
