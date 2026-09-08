import { fetchTokenInfo } from "@/lib/solana";
import { handleError, json } from "@/lib/api-utils";
export const dynamic = "force-dynamic";
export async function GET(_: Request, ctx: { params: Promise<{ mint: string }> }) {
  try { return json(await fetchTokenInfo((await ctx.params).mint)); } catch (e) { return handleError(e); }
}
