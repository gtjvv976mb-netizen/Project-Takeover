import { PublicKey } from "@solana/web3.js";
import { addEvent, claimSignature, updateListing } from "@/lib/db";
import { handleError, HttpError, json, readSigned, requireListing } from "@/lib/api-utils";
import { payOut, settleTokenAuthoritySale, verifyPayment } from "@/lib/solana";
export const dynamic = "force-dynamic";

/**
 * Buyer submits the signature of their SOL transfer to escrow.
 * - listing active: verify, mark paid, and for token listings settle immediately.
 * - listing no longer active (sold/cancelled in the meantime): verify and refund the buyer automatically.
 * A signature can only ever be consumed once (used_signatures table).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { body, signer } = await readSigned<{ signature: string }>(req, "pay", id);
    const l = requireListing(id);
    if (!body.signature) throw new HttpError(400, "Missing payment signature");
    if (l.seller === signer) throw new HttpError(400, "You cannot buy your own listing");

    const received = await verifyPayment(body.signature, l, new PublicKey(signer));
    if (!claimSignature(body.signature, "payment", id)) throw new HttpError(409, "This payment signature was already used");

    if (l.status !== "active") {
      // Too late: someone else bought it or the seller cancelled between page load and payment. Give the SOL back.
      const refundSig = await payOut(signer, received);
      addEvent(id, "late_payment_refunded", { buyer: signer, paymentSignature: body.signature, refundSignature: refundSig, lamports: received });
      throw new HttpError(409, `Listing is ${l.status}. Your ${received / 1e9} SOL was refunded (tx ${refundSig}).`);
    }

    updateListing(id, { status: "paid", buyer: signer, paymentSig: body.signature }, "paid", { buyer: signer, signature: body.signature });
    const paid = requireListing(id);
    if (l.type === "token_authority") {
      try {
        const sig = await settleTokenAuthoritySale(paid, new PublicKey(signer));
        updateListing(id, { status: "sold", settlementSig: sig }, "settled", { signature: sig });
      } catch (e) {
        // Funds are safe in escrow; buyer or seller can hit /settle to retry.
        updateListing(id, {}, "settlement_failed", { error: e instanceof Error ? e.message : String(e) });
      }
    }
    return json(requireListing(id));
  } catch (e) { return handleError(e); }
}
