import { cacheToken, getCachedToken, isTokenCacheFresh } from "@/lib/db";
import { handleError, json } from "@/lib/api-utils";
import { fetchTokenInfo, TOKEN_MINT, TOKEN_SYMBOL, GRADUATION_SOL } from "@/lib/solana";

export const dynamic = "force-dynamic";

/**
 * This project's own pump.fun coin. Returns `configured: false` until one is launched,
 * so every piece of token UI can hide itself rather than invent numbers.
 */
export async function GET() {
  try {
    if (!TOKEN_MINT) return json({ configured: false, mint: null, symbol: null, token: null });

    let token = getCachedToken(TOKEN_MINT, 60_000);
    if (!token || !isTokenCacheFresh(TOKEN_MINT, 60_000)) {
      token = await fetchTokenInfo(TOKEN_MINT);
      cacheToken(TOKEN_MINT, token);
    }
    return json({
      configured: true,
      mint: TOKEN_MINT,
      symbol: TOKEN_SYMBOL ?? token.symbol ?? null,
      graduationSol: GRADUATION_SOL,
      token,
    });
  } catch (e) {
    return handleError(e);
  }
}
