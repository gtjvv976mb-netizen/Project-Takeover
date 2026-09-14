import { PublicKey } from "@solana/web3.js";
import { cacheToken, getCachedToken, isTokenCacheFresh, listListings, wantedFor } from "@/lib/db";
import { handleError, json } from "@/lib/api-utils";
import { fetchTokenInfo } from "@/lib/solana";
import type { TokenDossier } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Everything the chain knows about a mint, plus whatever this site knows about it:
 * whether it is for sale, and who has said they want it.
 *
 * This works for ANY Solana token. Nobody has to have listed it.
 */
export async function GET(req: Request, ctx: { params: Promise<{ mint: string }> }) {
  try {
    const mint = new PublicKey((await ctx.params).mint).toBase58();
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";

    let token = getCachedToken(mint);
    if (fresh || !token || !isTokenCacheFresh(mint)) {
      token = await fetchTokenInfo(mint);
      cacheToken(mint, token);
    }

    const listings = listListings({ status: "all" }).filter((l) => l.mint === mint);
    // Typed, so the shape clients decode against is checked here rather than assumed there.
    const dossier: TokenDossier = {
      mint,
      token,
      wanted: wantedFor(mint),
      listings: listings.filter((l) => l.status !== "draft"),
      forSale: listings.find((l) => l.status === "active") ?? null,
    };
    return json(dossier);
  } catch (e) {
    return handleError(e);
  }
}
