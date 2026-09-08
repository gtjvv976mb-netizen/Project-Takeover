import { PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { getListing, updateListing } from "@/lib/db";
import { handleError, json, requireListing } from "@/lib/api-utils";
import { connection } from "@/lib/solana";
import { IDL, listingPda, statusFromAccount } from "@/lib/program";
import type { Idl } from "@coral-xyz/anchor";

export const dynamic = "force-dynamic";

const coder = new BorshAccountsCoder(IDL as Idl);

/**
 * Pull the authoritative state from chain into the local index.
 *
 * The program is the source of truth for money and ownership; the database only
 * caches it so the market can be searched and described. Anyone may call this — it
 * grants nothing, it just refreshes a cache from public data.
 */
export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const l = requireListing(id);
    const pda = listingPda(new PublicKey(l.seller), id);
    const info = await connection().getAccountInfo(pda, "confirmed");

    if (!info) {
      return json({ listing: l, onChain: false, note: "Not created on chain yet" });
    }

    // BorshAccountsCoder decodes straight from the IDL, so field names stay snake_case
    // here, unlike the camelCase the typed Program client hands back.
    const acct = coder.decode("Listing", info.data) as {
      buyer: PublicKey;
      price: { toString(): string };
      status: Record<string, unknown>;
      escrowed_lamports: { toString(): string };
      deadline: { toString(): string };
      escrowed: number;
    };

    const status = statusFromAccount(acct.status);
    const buyer = acct.buyer.equals(PublicKey.default) ? null : acct.buyer.toBase58();
    const priceLamports = Number(acct.price.toString());

    if (l.status !== status || l.buyer !== buyer || l.priceLamports !== priceLamports) {
      updateListing(id, { status, buyer, priceLamports }, "synced", {
        status,
        buyer,
        escrowedLamports: acct.escrowed_lamports.toString(),
        deadline: acct.deadline.toString(),
      });
    }

    return json({
      listing: getListing(id),
      onChain: true,
      account: pda.toBase58(),
      escrowedLamports: acct.escrowed_lamports.toString(),
      deadline: Number(acct.deadline.toString()),
      escrowedAuthorities: acct.escrowed,
    });
  } catch (e) {
    return handleError(e);
  }
}
