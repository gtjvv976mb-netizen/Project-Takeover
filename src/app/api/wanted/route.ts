import { PublicKey } from "@solana/web3.js";
import { addWanted, cacheToken, isTokenCacheFresh, removeWanted, wantedBoard } from "@/lib/db";
import { handleError, HttpError, json, readSigned } from "@/lib/api-utils";
import { fetchTokenInfo } from "@/lib/solana";

export const dynamic = "force-dynamic";

/** The demand board: tokens people have asked for, whether or not the owner ever showed up. */
export async function GET() {
  return json(wantedBoard());
}

/**
 * Register interest in any Solana token. The owner does not need an account here, or
 * to have heard of this site — the entry describes a mint, not a relationship.
 */
export async function POST(req: Request) {
  try {
    const { body, signer } = await readSigned<{ mint: string; note?: string; indicativeSol?: number; remove?: boolean }>(req, "want", null);
    const mint = new PublicKey(body.mint).toBase58();

    if (body.remove) {
      removeWanted(mint, signer);
      return json({ ok: true, removed: true });
    }

    const indicativeLamports = Math.max(0, Math.round(Number(body.indicativeSol ?? 0) * 1e9));
    if (!Number.isFinite(indicativeLamports)) throw new HttpError(400, "Bad indicative price");

    // Reading the chain here means the board can never hold a made-up token.
    if (!isTokenCacheFresh(mint)) {
      const token = await fetchTokenInfo(mint);
      cacheToken(mint, token);
    }

    addWanted({
      mint,
      addedBy: signer,
      note: String(body.note ?? "").slice(0, 500),
      indicativeLamports,
      createdAt: Date.now(),
    });
    return json({ ok: true, mint });
  } catch (e) {
    return handleError(e);
  }
}
