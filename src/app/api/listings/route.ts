import { randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { getRequest, insertListing, listListings, updateRequest } from "@/lib/db";
import { handleError, HttpError, json, readSigned } from "@/lib/api-utils";
import { fetchTokenInfo } from "@/lib/solana";
import { pumpControlOf } from "@/lib/solana-shared";
import { imageExists, isStoredName } from "@/lib/uploads";
import type { AuthorityKind, Listing, ListingAsset, ListingStatus, ListingType, OffchainAsset, PumpCreatorAsset, TokenAuthorityAsset } from "@/lib/types";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const status = (u.searchParams.get("status") ?? "active") as ListingStatus | "all";
  const wallet = u.searchParams.get("wallet") ?? undefined;
  const type = u.searchParams.get("type") ?? undefined;
  return json(listListings({ status, wallet, type }));
}

const VALID_AUTH: AuthorityKind[] = ["mint", "freeze", "metadata_update"];

export async function POST(req: Request) {
  try {
    const { body, signer } = await readSigned<{ type: ListingType; title: string; description: string; priceSol: number; asset: ListingAsset; requestId?: string; image?: string }>(req, "create", null);
    const { type, title, description, priceSol, asset, requestId, image } = body;

    // A listing can be the answer to a request somebody posted. Check that before
    // anything else is written, so an awarded developer cannot be raced to the escrow
    // and a stranger cannot attach their own listing to a request they did not win.
    const request = requestId ? getRequest(requestId) : null;
    if (requestId) {
      if (!request) throw new HttpError(404, "That request does not exist");
      if (request.status !== "awarded" || request.awardedDev !== signer) {
        throw new HttpError(403, "This request has not been awarded to you");
      }
      if (request.listingId) throw new HttpError(409, "That request already has an escrow open");
      if (type !== "offchain") throw new HttpError(400, "Commissioned work is delivered as a project, not as token authorities");
    }
    if (!["token_authority", "pump_creator", "offchain"].includes(type)) throw new HttpError(400, "Bad listing type");
    if (!title || title.length > 80) throw new HttpError(400, "Title is required (max 80 chars)");
    if ((description ?? "").length > 4000) throw new HttpError(400, "Description too long");
    const priceLamports = Math.round(Number(priceSol) * 1e9);
    if (!Number.isFinite(priceLamports) || priceLamports < 10_000_000) throw new HttpError(400, "Minimum price is 0.01 SOL");

    // A cover is required, and required here rather than only in the form. Listings with
    // no picture were the ones nobody clicked: a wall of blank cards tells a buyer nothing
    // about which of them is a real project. The name must be one this service stored and
    // the file must still be on the disk, so a made-up hash cannot buy a listing a cover.
    if (!image || typeof image !== "string") {
      throw new HttpError(400, "Every listing needs a cover image. Upload one before publishing.");
    }
    if (!isStoredName(image) || !imageExists(image)) {
      throw new HttpError(400, "That cover image is not one we hold. Upload it again.");
    }

    let mint: string | null = null;
    let token = null;
    let cleanAsset: ListingAsset;

    if (type === "token_authority") {
      const a = asset as TokenAuthorityAsset;
      mint = new PublicKey(a.mint).toBase58();
      const authorities = [...new Set((a.authorities ?? []).filter((x) => VALID_AUTH.includes(x)))];
      if (!authorities.length) throw new HttpError(400, "Pick at least one authority to sell");
      token = await fetchTokenInfo(mint);
      // The escrow program holds authorities through the legacy SPL Token program and
      // Metaplex. A Token-2022 mint cannot be escrowed by it at all, and even if it could,
      // a permanent delegate or transfer hook would leave the buyer with less than "the
      // authorities" implies. Say so at listing time rather than at settlement.
      if (token.extensions?.program === "token-2022") {
        const critical = token.extensions.risks.filter((r) => r.level === "critical");
        throw new HttpError(400, critical.length
          ? `This is a Token-2022 mint and its extensions undercut the sale: ${critical.map((r) => r.text).join(" ")}`
          : "This is a Token-2022 mint. The escrow program can only hold legacy SPL Token authorities today, so it cannot be listed yet.");
      }
      if (authorities.includes("metadata_update") && token.metadataSource !== "metaplex") {
        throw new HttpError(400, "This token's metadata is not held in a Metaplex account, so its update authority cannot be escrowed here.");
      }
      for (const k of authorities) {
        const cur = k === "mint" ? token.mintAuthority : k === "freeze" ? token.freezeAuthority : token.updateAuthority;
        if (cur !== signer) throw new HttpError(400, `Your wallet does not hold the ${k} authority (current: ${cur ?? "none / revoked"})`);
      }
      cleanAsset = { mint, authorities };
    } else if (type === "pump_creator") {
      const a = asset as PumpCreatorAsset;
      mint = new PublicKey(a.mint).toBase58();
      token = await fetchTokenInfo(mint);
      if (!token.pump) throw new HttpError(400, "No pump.fun bonding curve found for this mint");
      if (!token.pump.control) throw new HttpError(400, "Could not read the coin creator from the chain, so ownership cannot be verified");
      // Look through a fee-sharing config, not at it: a seller who is admin of a config
      // that still pays them 90% has not got a coin to sell, and one whose config is
      // revoked has nothing that can be handed over at all.
      const verdict = pumpControlOf(token.pump.control, signer);
      if (!verdict.full) throw new HttpError(400, `You do not hold this coin's creator role outright. ${verdict.reason}${verdict.isAdmin && !verdict.revoked ? " Reset the fee split to 100% to your wallet on pump.fun, then list it." : ""}`);
      cleanAsset = { mint, pumpUrl: `https://pump.fun/coin/${mint}` };
    } else {
      const a = asset as OffchainAsset;
      const links = (a.links ?? []).map(String).filter((s) => /^https?:\/\//.test(s)).slice(0, 10);
      cleanAsset = { category: a.category ?? "other", links, deliverables: String(a.deliverables ?? "").slice(0, 2000) };
    }

    const now = Date.now();
    const listing: Listing = {
      id: randomUUID().slice(0, 8), type, title: title.trim(), description: (description ?? "").trim(), priceLamports,
      // Draft for every kind, not just token_authority. A row here is only an index
      // entry; the program is what a buyer actually pays into, and `fund` needs the
      // listing account to already exist. Marking a row active before the seller has
      // opened it on chain advertised a listing whose purchase transaction could only
      // fail. The sync route promotes it once the account is really there.
      seller: signer, buyer: null, status: "draft", asset: cleanAsset, mint, token, image,
      escrowSig: null, paymentSig: null, settlementSig: null, deliveryNote: null, disputeReason: null, createdAt: now, updatedAt: now,
    };
    insertListing(listing);
    if (request) updateRequest(request.id, { listingId: listing.id });
    return json(listing, 201);
  } catch (e) { return handleError(e); }
}
