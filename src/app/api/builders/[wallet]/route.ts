import { PublicKey } from "@solana/web3.js";
import { builderStats, getBuilder, listListings, upsertBuilder } from "@/lib/db";
import { handleError, HttpError, json, readSigned } from "@/lib/api-utils";
export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ wallet: string }> }) {
  try {
    const wallet = new PublicKey((await ctx.params).wallet).toBase58();
    const listings = listListings({ status: "all", wallet }).filter((l) => l.seller === wallet && l.status !== "draft");
    return json({ wallet, profile: getBuilder(wallet), stats: builderStats(wallet), listings });
  } catch (e) { return handleError(e); }
}

/** Builder edits their own profile (signed with their wallet). */
export async function POST(req: Request, ctx: { params: Promise<{ wallet: string }> }) {
  try {
    const { wallet } = await ctx.params;
    const { body, signer } = await readSigned<{ name: string; bio: string; github: string; x: string; website: string }>(req, "profile", null);
    if (signer !== wallet) throw new HttpError(403, "You can only edit your own profile");
    const clean = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
    const url = (v: unknown) => { const s = clean(v, 200); return s && !/^https?:\/\//.test(s) ? "" : s; };
    upsertBuilder({ wallet, name: clean(body.name, 40), bio: clean(body.bio, 600), github: url(body.github), x: url(body.x), website: url(body.website) });
    return json({ profile: getBuilder(wallet) });
  } catch (e) { return handleError(e); }
}
