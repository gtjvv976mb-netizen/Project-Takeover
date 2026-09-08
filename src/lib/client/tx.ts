"use client";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { AuthorityType, createSetAuthorityInstruction, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { updateMetadataAuthorityIx } from "@/lib/solana-shared";
import type { AuthorityKind } from "@/lib/types";

async function send(conn: Connection, wallet: WalletContextState, tx: Transaction): Promise<string> {
  if (!wallet.publicKey) throw new Error("Wallet not connected");
  tx.feePayer = wallet.publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  const sig = await wallet.sendTransaction(tx, conn);
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

/** Seller: move the selected authorities of `mint` from the connected wallet to the escrow wallet. */
export async function escrowAuthoritiesTx(conn: Connection, wallet: WalletContextState, mint: string, kinds: AuthorityKind[], escrow: string): Promise<string> {
  const owner = wallet.publicKey!;
  const mintPk = new PublicKey(mint);
  const escrowPk = new PublicKey(escrow);
  const acct = await conn.getAccountInfo(mintPk);
  const program = acct?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const tx = new Transaction();
  for (const k of kinds) {
    if (k === "mint") tx.add(createSetAuthorityInstruction(mintPk, owner, AuthorityType.MintTokens, escrowPk, [], program));
    if (k === "freeze") tx.add(createSetAuthorityInstruction(mintPk, owner, AuthorityType.FreezeAccount, escrowPk, [], program));
    if (k === "metadata_update") tx.add(updateMetadataAuthorityIx(mintPk, owner, escrowPk));
  }
  return send(conn, wallet, tx);
}

/** Buyer: pay the listing price into escrow. The signature is then submitted to /pay, signed by the same wallet. */
export async function payTx(conn: Connection, wallet: WalletContextState, escrow: string, lamports: number): Promise<string> {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: wallet.publicKey!, toPubkey: new PublicKey(escrow), lamports }));
  return send(conn, wallet, tx);
}
