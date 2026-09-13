import { getListing, updateListing } from "@/lib/db";
import { handleError, HttpError, json, readSigned, requireListing } from "@/lib/api-utils";
import { checkLinks, expectedTxt } from "@/lib/domain-proof";
import type { OffchainAsset } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET — what this listing would need to prove itself, and where it currently stands.
 *
 * Public, because a buyer deciding whether to trust a listing should be able to see the
 * same evidence the seller does, including the exact TXT record they were asked for.
 */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const l = requireListing((await ctx.params).id);
    if (l.type !== "offchain") throw new HttpError(400, "Only off-chain listings are verified by DNS; token and pump.fun listings are proven on chain");
    const a = l.asset as OffchainAsset;
    const { verified, proofs } = await checkLinks(a.links, l.seller);
    return json({
      verified,
      // What is stored on the listing, which may be older than the live check above.
      recorded: Boolean(a.domainVerified),
      verifiedHost: a.verifiedHost ?? null,
      expectedRecord: expectedTxt(l.seller),
      proofs,
    });
  } catch (e) { return handleError(e); }
}

/**
 * POST — re-check and record the result on the listing. Signed by the seller.
 *
 * The seller runs this after adding the TXT record. It is also how a proof gets removed:
 * if the record is taken down, a later check flips the listing back to unproven, so the
 * badge can never outlive the fact it stands for.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { signer } = await readSigned(req, "verify-domain", id);
    const l = requireListing(id);
    if (l.type !== "offchain") throw new HttpError(400, "Only off-chain listings are verified by DNS");
    if (signer !== l.seller) throw new HttpError(403, "Only the seller can verify this listing");

    const a = l.asset as OffchainAsset;
    const { verified, proofs } = await checkLinks(a.links, l.seller);
    const hit = proofs.find((p) => p.verified) ?? null;
    updateListing(
      id,
      { asset: { ...a, domainVerified: verified, verifiedHost: hit?.host ?? null, verifiedAt: verified ? Date.now() : null } },
      verified ? "domain_verified" : "domain_unverified",
      { host: hit?.host ?? null },
    );
    return json({ verified, verifiedHost: hit?.host ?? null, expectedRecord: expectedTxt(l.seller), proofs, listing: getListing(id) });
  } catch (e) { return handleError(e); }
}
