import { updateListing } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { handleError, HttpError, json, readSigned, requireListing, requireStatus } from "@/lib/api-utils";
import { refundBuyer, releaseToSeller } from "@/lib/solana";
export const dynamic = "force-dynamic";
/** Admin (ADMIN_PUBKEYS env) resolves a disputed listing: "release" pays seller, "refund" returns SOL to buyer. */
export async function POST(req: Request) {
  try {
    const { body, signer } = await readSigned<{ listingId: string; outcome: "release" | "refund" }>(req, "admin-resolve", null);
    if (!isAdmin(signer)) throw new HttpError(403, "Not an admin");
    const l = requireListing(body.listingId);
    requireStatus(l, "disputed");
    if (body.outcome === "release") {
      const sig = await releaseToSeller(l);
      updateListing(l.id, { status: "sold", settlementSig: sig }, "admin_released", { admin: signer, signature: sig });
    } else if (body.outcome === "refund") {
      const sig = await refundBuyer(l);
      updateListing(l.id, { status: "refunded", settlementSig: sig }, "admin_refunded", { admin: signer, signature: sig });
    } else throw new HttpError(400, "outcome must be release or refund");
    return json(requireListing(l.id));
  } catch (e) { return handleError(e); }
}
