// SERVER ONLY. Holds the escrow keypair and talks to the RPC.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import bs58 from "bs58";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { AuthorityType, createSetAuthorityInstruction, getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { AppConfig, AuthorityKind, Listing, TokenInfo } from "./types";
import { bondingCurvePda, metadataPda, parseBondingCurve, parseMetadata, updateMetadataAuthorityIx } from "./solana-shared";

export const NETWORK = (process.env.SOLANA_NETWORK ?? "devnet") as AppConfig["network"];
/** Server-side RPC. May carry an API key; never sent to the browser. */
export const RPC_URL = process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL ?? `https://api.${NETWORK}.solana.com`;
/** Endpoint handed to wallets in the browser. Keep this one keyless / CORS-open. */
export const BROWSER_RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? `https://api.${NETWORK}.solana.com`;
export const FEE_BPS = Number(process.env.FEE_BPS ?? 200); // 2% platform fee
export const APP_NAME = process.env.APP_NAME ?? process.env.NEXT_PUBLIC_APP_NAME ?? "Project: Takeover";

declare global {
  var __takeoverConn: Connection | undefined;
  var __takeoverEscrow: Keypair | undefined;
}

export function connection(): Connection {
  if (!globalThis.__takeoverConn) globalThis.__takeoverConn = new Connection(RPC_URL, "confirmed");
  return globalThis.__takeoverConn;
}

/** Escrow keypair: from ESCROW_SECRET_KEY (base58 or JSON byte array) or generated once into data/escrow-keypair.json. */
export function escrowKeypair(): Keypair {
  if (globalThis.__takeoverEscrow) return globalThis.__takeoverEscrow;
  const env = process.env.ESCROW_SECRET_KEY?.trim();
  let kp: Keypair;
  if (env) {
    kp = env.startsWith("[")
      ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(env)))
      : Keypair.fromSecretKey(bs58.decode(env));
  } else {
    const file = path.join(process.cwd(), "data", "escrow-keypair.json");
    if (fs.existsSync(file)) {
      kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
    } else {
      kp = Keypair.generate();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
      console.log(`[takeover] Generated new escrow wallet ${kp.publicKey.toBase58()} -> ${file}. Fund it with SOL for tx fees.`);
    }
  }
  globalThis.__takeoverEscrow = kp;
  return kp;
}

export function appConfig(): AppConfig {
  return { network: NETWORK, rpcUrl: BROWSER_RPC_URL, escrowPubkey: escrowKeypair().publicKey.toBase58(), feeBps: FEE_BPS, appName: APP_NAME };
}

export function feeFor(priceLamports: number): number {
  return Math.floor((priceLamports * FEE_BPS) / 10_000);
}

// ---------- token inspection ----------

async function tokenProgramFor(mint: PublicKey): Promise<PublicKey> {
  const info = await connection().getAccountInfo(mint);
  if (!info) throw new Error("Mint account not found");
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  throw new Error("Account is not an SPL token mint");
}

export async function fetchTokenInfo(mintStr: string): Promise<TokenInfo> {
  const mint = new PublicKey(mintStr);
  const conn = connection();
  const program = await tokenProgramFor(mint);
  const m = await getMint(conn, mint, "confirmed", program);
  const info: TokenInfo = {
    mint: mintStr,
    decimals: m.decimals,
    supply: m.supply.toString(),
    mintAuthority: m.mintAuthority?.toBase58() ?? null,
    freezeAuthority: m.freezeAuthority?.toBase58() ?? null,
    updateAuthority: null,
    pump: null,
  };
  const [meta, curve] = await conn.getMultipleAccountsInfo([metadataPda(mint), bondingCurvePda(mint)]);
  if (meta) {
    const p = parseMetadata(meta.data);
    info.updateAuthority = p.updateAuthority.toBase58();
    info.name = p.name; info.symbol = p.symbol; info.uri = p.uri;
    if (p.uri) {
      try {
        const res = await fetch(p.uri, { signal: AbortSignal.timeout(4000) });
        const j = (await res.json()) as { image?: string; name?: string; symbol?: string };
        if (j.image) info.image = j.image;
        if (!info.name && j.name) info.name = j.name;
        if (!info.symbol && j.symbol) info.symbol = j.symbol;
      } catch { /* off-chain metadata unreachable; fine */ }
    }
  }
  if (curve) {
    const c = parseBondingCurve(curve.data);
    info.pump = { bondingCurve: bondingCurvePda(mint).toBase58(), creator: c?.creator?.toBase58() ?? null, complete: c?.complete ?? null };
  }
  try {
    const largest = await conn.getTokenLargestAccounts(mint);
    const top = largest.value.map((a) => ({ address: a.address.toBase58(), amount: a.amount }));
    const supply = Number(m.supply);
    const top10 = top.slice(0, 10).reduce((acc, a) => acc + Number(a.amount), 0);
    info.holders = { top, top10Share: supply > 0 ? top10 / supply : 0 };
  } catch { info.holders = null; }
  return info;
}

/** Which of the requested authorities are currently held by `holder`. */
export async function authoritiesHeldBy(mintStr: string, wanted: AuthorityKind[], holder: PublicKey) {
  const t = await fetchTokenInfo(mintStr);
  const h = holder.toBase58();
  const held: AuthorityKind[] = [];
  const missing: AuthorityKind[] = [];
  for (const a of wanted) {
    const cur = a === "mint" ? t.mintAuthority : a === "freeze" ? t.freezeAuthority : t.updateAuthority;
    (cur === h ? held : missing).push(a);
  }
  return { held, missing, token: t };
}

// ---------- escrow-side transactions ----------

async function setAuthorityIxs(mintStr: string, kinds: AuthorityKind[], from: PublicKey, to: PublicKey): Promise<TransactionInstruction[]> {
  const mint = new PublicKey(mintStr);
  const program = await tokenProgramFor(mint);
  const ixs: TransactionInstruction[] = [];
  for (const k of kinds) {
    if (k === "mint") ixs.push(createSetAuthorityInstruction(mint, from, AuthorityType.MintTokens, to, [], program));
    else if (k === "freeze") ixs.push(createSetAuthorityInstruction(mint, from, AuthorityType.FreezeAccount, to, [], program));
    else if (k === "metadata_update") ixs.push(updateMetadataAuthorityIx(mint, from, to));
  }
  return ixs;
}

async function sendFromEscrow(ixs: TransactionInstruction[]): Promise<string> {
  const kp = escrowKeypair();
  const tx = new Transaction().add(...ixs);
  tx.feePayer = kp.publicKey;
  return sendAndConfirmTransaction(connection(), tx, [kp], { commitment: "confirmed" });
}

/** Hand escrowed authorities to `to` and (optionally) pay the seller in the same atomic tx. */
export async function settleTokenAuthoritySale(listing: Listing, buyer: PublicKey): Promise<string> {
  if (listing.type !== "token_authority" || !listing.mint) throw new Error("Not a token authority listing");
  const asset = listing.asset as { authorities: AuthorityKind[] };
  const escrow = escrowKeypair().publicKey;
  const { held, missing } = await authoritiesHeldBy(listing.mint, asset.authorities, escrow);
  if (missing.length) throw new Error(`Escrow no longer holds: ${missing.join(", ")}`);
  const ixs = await setAuthorityIxs(listing.mint, held, escrow, buyer);
  ixs.push(SystemProgram.transfer({ fromPubkey: escrow, toPubkey: new PublicKey(listing.seller), lamports: listing.priceLamports - feeFor(listing.priceLamports) }));
  return sendFromEscrow(ixs);
}

/** Return escrowed authorities to the seller (listing cancelled before sale). */
export async function returnAuthoritiesToSeller(listing: Listing): Promise<string | null> {
  if (listing.type !== "token_authority" || !listing.mint) return null;
  const asset = listing.asset as { authorities: AuthorityKind[] };
  const escrow = escrowKeypair().publicKey;
  const { held } = await authoritiesHeldBy(listing.mint, asset.authorities, escrow);
  if (!held.length) return null;
  const ixs = await setAuthorityIxs(listing.mint, held, escrow, new PublicKey(listing.seller));
  return sendFromEscrow(ixs);
}

export async function payOut(to: string, lamports: number): Promise<string> {
  const escrow = escrowKeypair().publicKey;
  return sendFromEscrow([SystemProgram.transfer({ fromPubkey: escrow, toPubkey: new PublicKey(to), lamports })]);
}

export async function releaseToSeller(listing: Listing): Promise<string> {
  return payOut(listing.seller, listing.priceLamports - feeFor(listing.priceLamports));
}

export async function refundBuyer(listing: Listing): Promise<string> {
  if (!listing.buyer) throw new Error("No buyer to refund");
  return payOut(listing.buyer, listing.priceLamports); // full refund, platform eats the tx fee
}

// ---------- payment verification ----------

/**
 * Confirms `signature` moved >= price lamports from `buyer` (the fee payer) to the escrow wallet.
 * Replay across listings is prevented by the UNIQUE constraint on listings.payment_sig.
 */
export async function verifyPayment(signature: string, listing: Listing, buyer: PublicKey): Promise<number> {
  const conn = connection();
  const escrow = escrowKeypair().publicKey.toBase58();
  const tx = await conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  if (!tx) throw new Error("Transaction not found yet. Wait a few seconds and retry.");
  if (tx.meta?.err) throw new Error("Payment transaction failed on-chain");
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
  const escrowIdx = keys.indexOf(escrow);
  if (escrowIdx < 0) throw new Error("Transaction does not touch the escrow wallet");
  if (!tx.transaction.message.accountKeys[0].pubkey.equals(buyer)) throw new Error("Transaction was not paid by the buyer wallet");
  const received = (tx.meta?.postBalances[escrowIdx] ?? 0) - (tx.meta?.preBalances[escrowIdx] ?? 0);
  if (listing.status === "active" && received < listing.priceLamports) throw new Error(`Escrow received ${received} lamports, expected ${listing.priceLamports}`);
  if (received <= 0) throw new Error("Escrow did not receive any SOL in this transaction");
  return received;
}

/** For pump.fun listings: is the bonding curve's creator now `wallet`? */
export async function pumpCreatorIs(mintStr: string, wallet: string): Promise<{ ok: boolean; creator: string | null }> {
  const info = await connection().getAccountInfo(bondingCurvePda(new PublicKey(mintStr)));
  if (!info) return { ok: false, creator: null };
  const c = parseBondingCurve(info.data);
  const creator = c?.creator?.toBase58() ?? null;
  return { ok: creator === wallet, creator };
}
