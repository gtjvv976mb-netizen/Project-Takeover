import { randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { insertListing, listListings } from "@/lib/db";
import { handleError, HttpError, json, readSigned } from "@/lib/api-utils";
import { fetchTokenInfo } from "@/lib/solana";
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
    const { body, signer } = await readSigned<{ type: ListingType; title: string; description: string; priceSol: number; asset: ListingAsset }>(req, "create", null);
    const { type, title, description, priceSol, asset } = body;
    if (!["token_authority", "pump_creator", "offchain"].includes(type)) throw new HttpError(400, "Bad listing type");
    if (!title || title.length > 80) throw new HttpError(400, "Title is required (max 80 chars)");
    if ((description ?? "").length > 4000) throw new HttpError(400, "Description too long");
    const priceLamports = Math.round(Number(priceSol) * 1e9);
    if (!Number.isFinite(priceLamports) || priceLamports < 10_000_000) throw new HttpError(400, "Minimum price is 0.01 SOL");

    let mint: string | null = null;
    let token = null;
    let cleanAsset: ListingAsset;

    if (type === "token_authority") {
      const a = asset as TokenAuthorityAsset;
      mint = new PublicKey(a.mint).toBase58();
      const authorities = [...new Set((a.authorities ?? []).filter((x) => VALID_AUTH.includes(x)))];
      if (!authorities.length) throw new HttpError(400, "Pick at least one authority to sell");
      token = await fetchTokenInfo(mint);
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
      if (!token.pump.creator) throw new HttpError(400, "Could not read the coin creator from the bonding curve, so ownership cannot be verified");
      if (token.pump.creator && token.pump.creator !== signer) throw new HttpError(400, `pump.fun lists ${token.pump.creator} as the coin creator, not your wallet`);
      cleanAsset = { mint, pumpUrl: `https://pump.fun/coin/${mint}` };
    } else {
      const a = asset as OffchainAsset;
      const links = (a.links ?? []).map(String).filter((s) => /^https?:\/\//.test(s)).slice(0, 10);
      cleanAsset = { category: a.category ?? "other", links, deliverables: String(a.deliverables ?? "").slice(0, 2000) };
    }

    const now = Date.now();
    const listing: Listing = {
      id: randomUUID().slice(0, 8), type, title: title.trim(), description: (description ?? "").trim(), priceLamports,
      seller: signer, buyer: null, status: type === "token_authority" ? "draft" : "active", asset: cleanAsset, mint, token,
      escrowSig: null, paymentSig: null, settlementSig: null, deliveryNote: null, disputeReason: null, createdAt: now, updatedAt: now,
    };
    insertListing(listing);
    return json(listing, 201);
  } catch (e) { return handleError(e); }
}
