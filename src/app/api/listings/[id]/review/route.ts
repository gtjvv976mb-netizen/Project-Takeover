import { myReviewOf, reviewsForListing, upsertReview } from "@/lib/db";
import { handleError, HttpError, json, readSigned, requireListing } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

/**
 * States in which a deal is over and there is something to review.
 *
 * `sold` means the escrow paid the seller. `refunded` means it went back to the buyer —
 * the seller did not deliver, or a dispute went against them — and that is exactly the
 * case a reputation system must not quietly drop.
 *
 * `cancelled` is absent on purpose: a cancelled listing never had a counterparty, so
 * there is nobody to review and nothing to review them on.
 */
const REVIEWABLE = new Set(["sold", "refunded"]);

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    requireListing(id);
    return json(reviewsForListing(id));
  } catch (e) {
    return handleError(e);
  }
}

/**
 * Review the person on the other side of a deal you were in.
 *
 * This is the whole basis of the reputation: not a badge next to a review, but the only
 * door into writing one. The listing has to have settled, and the signer has to be one of
 * its two parties. Since the program refuses to let a seller buy their own listing, the
 * cheapest way to manufacture a good review is two wallets and real SOL through escrow,
 * paying the platform fee. That is the honest limit — it costs money rather than being
 * impossible.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const listing = requireListing(id);
    const { body, signer } = await readSigned<{ rating: number; body: string }>(req, "review", id);

    if (!REVIEWABLE.has(listing.status)) {
      throw new HttpError(409, listing.status === "cancelled"
        ? "This listing was cancelled, so there is no deal to review."
        : "You can review this once the deal has settled.");
    }
    if (!listing.buyer) throw new HttpError(409, "This deal has no counterparty to review");

    // Exactly two people were in this deal, and each reviews the other.
    let subject: string;
    let role: "buyer" | "seller";
    if (signer === listing.seller) { subject = listing.buyer; role = "buyer"; }
    else if (signer === listing.buyer) { subject = listing.seller; role = "seller"; }
    else throw new HttpError(403, "Only the two people in this deal can review it");

    const rating = Math.round(Number(body.rating));
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, "Rate it from 1 to 5");
    const text = (body.body ?? "").trim();
    if (text.length < 10) throw new HttpError(400, "Say something about how it went — at least 10 characters.");
    if (text.length > 2000) throw new HttpError(400, "That review is too long (2000 characters max)");

    return json(upsertReview({ listingId: id, reviewer: signer, subject, role, rating, body: text }), 201);
  } catch (e) {
    return handleError(e);
  }
}

/** What this wallet already said about this deal, so the form can be pre-filled. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { signer } = await readSigned(req, "review", id);
    return json({ review: myReviewOf(id, signer) });
  } catch (e) {
    return handleError(e);
  }
}
