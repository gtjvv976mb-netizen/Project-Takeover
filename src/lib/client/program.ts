"use client";
/**
 * Every action that moves money or ownership is signed here, in the buyer's or
 * seller's own wallet, and executed by the on-chain program. The server has no key and
 * cannot perform any of these on a user's behalf.
 */
import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, type Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import {
  AUTH_BIT, IDL, KIND_ARG, METADATA_PROGRAM_ID, authoritiesToBits, configPda, listingIdBytes,
  listingPda, metadataPda,
} from "@/lib/program";
import type { AuthorityKind, ListingType } from "@/lib/types";

/**
 * Anchor's account resolver treats `null` as "this optional account is not supplied"
 * and substitutes the program id (accounts-resolver.js, resolveOptionalsHelper). Its
 * TypeScript types only admit `undefined`, so this documents the gap in one place
 * rather than casting at every call site.
 */
type OptionalAccounts = Record<string, PublicKey | null>;
const accts = (o: OptionalAccounts) => o as never;

function programFor(connection: Connection, wallet: WalletContextState): Program<Idl> {
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error("Connect a wallet first");
  const provider = new AnchorProvider(
    connection,
    {
      publicKey: wallet.publicKey,
      signTransaction: wallet.signTransaction.bind(wallet),
      signAllTransactions: wallet.signAllTransactions!.bind(wallet),
    },
    { commitment: "confirmed" },
  );
  return new Program(IDL as Idl, provider);
}

/** Seller opens the listing on chain. Token listings start as a draft. */
export async function createListingOnChain(
  connection: Connection,
  wallet: WalletContextState,
  opts: { id: string; type: ListingType; priceLamports: number; authorities: AuthorityKind[]; mint?: string; deliveryDays?: number },
): Promise<string> {
  const program = programFor(connection, wallet);
  const seller = wallet.publicKey!;
  return program.methods
    .createListing(
      Array.from(listingIdBytes(opts.id)),
      KIND_ARG[opts.type],
      new BN(opts.priceLamports),
      authoritiesToBits(opts.authorities),
      opts.deliveryDays ?? 7,
    )
    .accountsPartial(accts({
      config: configPda(),
      listing: listingPda(seller, opts.id),
      seller,
      mint: opts.mint ? new PublicKey(opts.mint) : null,
      systemProgram: SystemProgram.programId,
    }))
    .rpc();
}

/** Seller hands one authority to the program. Repeat until the listing goes live. */
export async function escrowAuthorityOnChain(
  connection: Connection,
  wallet: WalletContextState,
  opts: { id: string; which: AuthorityKind; mint: string },
): Promise<string> {
  const program = programFor(connection, wallet);
  const seller = wallet.publicKey!;
  const mint = new PublicKey(opts.mint);
  const needsMetadata = opts.which === "metadata_update";
  return program.methods
    .escrowAuthority(AUTH_BIT[opts.which])
    .accountsPartial(accts({
      listing: listingPda(seller, opts.id),
      seller,
      mint,
      metadata: needsMetadata ? metadataPda(mint) : null,
      tokenMetadataProgram: needsMetadata ? METADATA_PROGRAM_ID : null,
      tokenProgram: TOKEN_PROGRAM_ID,
    }))
    .rpc();
}

/**
 * The atomic one. Pays the seller and moves every escrowed authority to the buyer in a
 * single instruction, so there is no moment where one side holds both.
 */
export async function buyTokenOnChain(
  connection: Connection,
  wallet: WalletContextState,
  opts: { id: string; seller: string; treasury: string; mint: string; includesMetadata: boolean },
): Promise<string> {
  const program = programFor(connection, wallet);
  const seller = new PublicKey(opts.seller);
  const mint = new PublicKey(opts.mint);
  return program.methods
    .buyToken()
    .accountsPartial(accts({
      config: configPda(),
      listing: listingPda(seller, opts.id),
      buyer: wallet.publicKey!,
      seller,
      treasury: new PublicKey(opts.treasury),
      mint,
      metadata: opts.includesMetadata ? metadataPda(mint) : null,
      tokenMetadataProgram: opts.includesMetadata ? METADATA_PROGRAM_ID : null,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    }))
    .rpc();
}

/** Buyer escrows the price for a deal the program cannot hold the asset for. */
export async function fundOnChain(
  connection: Connection,
  wallet: WalletContextState,
  opts: { id: string; seller: string },
): Promise<string> {
  const program = programFor(connection, wallet);
  return program.methods
    .fund()
    .accountsPartial(accts({
      listing: listingPda(new PublicKey(opts.seller), opts.id),
      buyer: wallet.publicKey!,
      systemProgram: SystemProgram.programId,
    }))
    .rpc();
}

type SettleOpts = { id: string; seller: string; buyer: string; treasury: string };

function settleAccounts(wallet: WalletContextState, o: SettleOpts) {
  const seller = new PublicKey(o.seller);
  return {
    config: configPda(),
    listing: listingPda(seller, o.id),
    signer: wallet.publicKey!,
    seller,
    buyer: new PublicKey(o.buyer),
    treasury: new PublicKey(o.treasury),
  };
}

/** Buyer confirms delivery. */
export async function releaseOnChain(connection: Connection, wallet: WalletContextState, o: SettleOpts): Promise<string> {
  return programFor(connection, wallet).methods.release().accountsPartial(accts(settleAccounts(wallet, o))).rpc();
}

/** Callable by anyone once the deadline passes. Nobody needs the operator's help. */
export async function refundOnChain(connection: Connection, wallet: WalletContextState, o: SettleOpts): Promise<string> {
  return programFor(connection, wallet).methods.refund().accountsPartial(accts(settleAccounts(wallet, o))).rpc();
}

/** Arbitrator only, and only on a disputed deal. */
export async function resolveOnChain(connection: Connection, wallet: WalletContextState, o: SettleOpts, paySeller: boolean): Promise<string> {
  return programFor(connection, wallet).methods.resolve(paySeller).accountsPartial(accts(settleAccounts(wallet, o))).rpc();
}

export async function disputeOnChain(connection: Connection, wallet: WalletContextState, opts: { id: string; seller: string }): Promise<string> {
  const program = programFor(connection, wallet);
  return program.methods
    .dispute()
    .accountsPartial(accts({ listing: listingPda(new PublicKey(opts.seller), opts.id), signer: wallet.publicKey! }))
    .rpc();
}

/** Seller withdraws an unsold listing; escrowed authorities come back to them. */
export async function cancelOnChain(
  connection: Connection,
  wallet: WalletContextState,
  opts: { id: string; mint?: string | null; includesMetadata: boolean },
): Promise<string> {
  const program = programFor(connection, wallet);
  const seller = wallet.publicKey!;
  const mint = opts.mint ? new PublicKey(opts.mint) : null;
  return program.methods
    .cancel()
    .accountsPartial(accts({
      listing: listingPda(seller, opts.id),
      seller,
      mint,
      metadata: mint && opts.includesMetadata ? metadataPda(mint) : null,
      tokenMetadataProgram: mint && opts.includesMetadata ? METADATA_PROGRAM_ID : null,
      tokenProgram: mint ? TOKEN_PROGRAM_ID : null,
    }))
    .rpc();
}
