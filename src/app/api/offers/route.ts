import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import { json, handleError } from "@/lib/api-utils";
import { connection } from "@/lib/solana";
import { IDL, PROGRAM_ID, bitsToAuthorities, offerStatusFrom } from "@/lib/program";

export const dynamic = "force-dynamic";

const coder = new BorshAccountsCoder(IDL as Idl);
// Anchor 0.31 writes each account's 8-byte discriminator into the IDL itself.
const OFFER_DISC = Uint8Array.from(
  (IDL as { accounts: { name: string; discriminator: number[] }[] }).accounts.find((a) => a.name === "Offer")!.discriminator,
);

/**
 * Live offers, read straight from the chain rather than an index, so what the site
 * shows is exactly what someone can actually accept. Filterable by mint.
 */
export async function GET(req: Request) {
  try {
    const mint = new URL(req.url).searchParams.get("mint");

    const accounts = await connection().getProgramAccounts(PROGRAM_ID, {
      filters: [{ memcmp: { offset: 0, bytes: bs58.encode(OFFER_DISC) } }],
    });

    const offers = accounts
      .map(({ pubkey, account }) => {
        try {
          const o = coder.decode("Offer", account.data) as {
            buyer: PublicKey; mint: PublicKey; offer_id: number[]; price: { toString(): string };
            fee_bps: number; escrowed_lamports: { toString(): string }; expiry: { toString(): string };
            authorities: number; status: Record<string, unknown>;
          };
          return {
            account: pubkey.toBase58(),
            buyer: o.buyer.toBase58(),
            mint: o.mint.toBase58(),
            id: Buffer.from(o.offer_id).toString("utf8").replace(/\0+$/, ""),
            priceLamports: Number(o.price.toString()),
            feeBps: o.fee_bps,
            escrowedLamports: Number(o.escrowed_lamports.toString()),
            expiry: Number(o.expiry.toString()),
            authorities: bitsToAuthorities(o.authorities),
            status: offerStatusFrom(o.status),
          };
        } catch {
          return null;
        }
      })
      .filter((o): o is NonNullable<typeof o> => !!o)
      .filter((o) => o.status === "open")
      .filter((o) => !mint || o.mint === mint)
      .sort((a, b) => b.priceLamports - a.priceLamports);

    return json(offers);
  } catch (e) {
    return handleError(e);
  }
}
