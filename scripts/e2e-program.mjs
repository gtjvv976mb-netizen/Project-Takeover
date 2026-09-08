/**
 * End-to-end proof that the site now settles through the program and not a custodial
 * wallet. Drives the real HTTP API for metadata plus the real program for money, with
 * throwaway keypairs standing in for two browsers.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { AuthorityType, createInitializeMintInstruction, createSetAuthorityInstruction, getMint, MINT_SIZE, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import nacl from "tweetnacl";
import bs58 from "bs58";

const BASE = process.argv[2] ?? "http://localhost:3000";
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const idl = JSON.parse(fs.readFileSync("target/idl/takeover_escrow.json", "utf8"));
const conn = new Connection(RPC, "confirmed");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const authMsg = (action, id, ts) => `Takeover\naction: ${action}\nlisting: ${id ?? "-"}\nts: ${ts}`;
const auth = (kp, action, id) => {
  const timestamp = Date.now();
  return { pubkey: kp.publicKey.toBase58(), timestamp,
    signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(authMsg(action, id, timestamp)), kp.secretKey)) };
};
async function post(path, kp, action, id, body = {}) {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, auth: kp ? auth(kp, action, id) : undefined }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error}`);
  return j;
}
const progFor = (kp) => new Program(idl, new AnchorProvider(conn, new Wallet(kp), { commitment: "confirmed" }));
const idBytes = (s) => { const b = Buffer.alloc(16); Buffer.from(s).copy(b); return [...b]; };
const listingPda = (seller, id, pid) => PublicKey.findProgramAddressSync(
  [Buffer.from("listing"), seller.toBuffer(), Buffer.from(idBytes(id))], pid)[0];
const configPda = (pid) => PublicKey.findProgramAddressSync([Buffer.from("config")], pid)[0];

/** Price of the test deals. Small by default so this is runnable on a rate-limited devnet. */
const PRICE = Math.round(Number(process.env.PRICE_SOL ?? 0.05) * LAMPORTS_PER_SOL);

const seller = Keypair.generate(), buyer = Keypair.generate();

/**
 * Fund the throwaway wallets. Devnet's faucet is usually rate-limited, so fall back to
 * transferring from the local keypair that paid for the deploy.
 */
async function fund(kp, lamports) {
  try {
    await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, lamports), "confirmed");
    return;
  } catch { /* faucet dry; pay it forward from the deploy wallet instead */ }
  const payerPath = process.env.PAYER ?? path.join(os.homedir(), ".config/solana/id.json");
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(payerPath, "utf8"))));
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: kp.publicKey, lamports }));
  await conn.confirmTransaction(await conn.sendTransaction(tx, [payer]), "confirmed");
}
await fund(seller, PRICE * 2 + 0.03 * LAMPORTS_PER_SOL);
await fund(buyer, PRICE * 2 + 0.02 * LAMPORTS_PER_SOL);
log("funded seller and buyer");
const cfg = await (await fetch(BASE + "/api/config")).json();
log("site config:", { programId: cfg.programId, treasury: cfg.treasury, feeBps: cfg.feeBps });
const PID = new PublicKey(cfg.programId);
if (!cfg.programId) throw new Error("site is not reporting a program id");
if (cfg.escrowPubkey) throw new Error("site still exposes a custodial escrow wallet");

// ---- a real mint owned by the seller ----
const mint = Keypair.generate();
{
  const tx = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: seller.publicKey, newAccountPubkey: mint.publicKey, space: MINT_SIZE,
      lamports: await conn.getMinimumBalanceForRentExemption(MINT_SIZE), programId: TOKEN_PROGRAM_ID }),
    createInitializeMintInstruction(mint.publicKey, 6, seller.publicKey, seller.publicKey));
  await conn.sendTransaction(tx, [seller, mint]).then((s) => conn.confirmTransaction(s, "confirmed"));
}
log("mint created", mint.publicKey.toBase58());

// ---- 1. metadata row via the site ----
const listing = await post("/api/listings", seller, "create", null, {
  type: "token_authority", title: "E2E on-chain token", description: "settled by the program", priceSol: PRICE / LAMPORTS_PER_SOL,
  asset: { mint: mint.publicKey.toBase58(), authorities: ["mint", "freeze"] },
});
log("listing row", listing.id, listing.status);

// ---- 2. seller opens it on chain and hands over the controls ----
const sp = progFor(seller);
const pda = listingPda(seller.publicKey, listing.id, PID);
await sp.methods.createListing(idBytes(listing.id), { tokenAuthority: {} }, new BN(PRICE), 1 | 2, 7)
  .accountsPartial({ config: configPda(PID), listing: pda, seller: seller.publicKey, mint: mint.publicKey, systemProgram: SystemProgram.programId }).rpc();
for (const which of [1, 2]) {
  await sp.methods.escrowAuthority(which).accountsPartial({ listing: pda, seller: seller.publicKey, mint: mint.publicKey,
    metadata: null, tokenMetadataProgram: null, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
}
let m = await getMint(conn, mint.publicKey);
if (m.mintAuthority?.toBase58() !== pda.toBase58()) throw new Error("program does not hold mint authority");
log("controls handed to the program ✓");

const synced = await post(`/api/listings/${listing.id}/sync`, null, null, null);
log("after sync:", synced.listing.status, "| on chain:", synced.onChain);
if (synced.listing.status !== "active") throw new Error("expected active after escrow");

// ---- 3. buyer buys: one instruction pays the seller and moves the controls ----
const sellerBefore = await conn.getBalance(seller.publicKey);
await progFor(buyer).methods.buyToken().accountsPartial({
  config: configPda(PID), listing: pda, buyer: buyer.publicKey, seller: seller.publicKey,
  treasury: new PublicKey(cfg.treasury), mint: mint.publicKey, metadata: null, tokenMetadataProgram: null,
  tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).rpc();
const sellerAfter = await conn.getBalance(seller.publicKey);
m = await getMint(conn, mint.publicKey);

const expected = PRICE * (1 - cfg.feeBps / 10000);
log("seller received", (sellerAfter - sellerBefore) / LAMPORTS_PER_SOL, "SOL (expected", expected / LAMPORTS_PER_SOL, ")");
if (sellerAfter - sellerBefore !== expected) throw new Error("seller payout wrong");
if (m.mintAuthority?.toBase58() !== buyer.publicKey.toBase58()) throw new Error("buyer did not receive mint authority");
if (m.freezeAuthority?.toBase58() !== buyer.publicKey.toBase58()) throw new Error("buyer did not receive freeze authority");
log("atomic settlement ✓ buyer holds the controls, seller was paid");

const final = await post(`/api/listings/${listing.id}/sync`, null, null, null);
log("site now shows:", final.listing.status, "| buyer:", final.listing.buyer?.slice(0, 8));
if (final.listing.status !== "sold") throw new Error("site did not reflect the sale");

// ---- 4. the refund path nobody can block ----
const off = await post("/api/listings", seller, "create", null, {
  type: "offchain", title: "E2E escrowed project", description: "tests the escrowed path", priceSol: PRICE / LAMPORTS_PER_SOL,
  asset: { category: "project", links: [], deliverables: "repo + domain" },
});
await sp.methods.createListing(idBytes(off.id), { offchain: {} }, new BN(PRICE), 0, 1)
  .accountsPartial({ config: configPda(PID), listing: listingPda(seller.publicKey, off.id, PID), seller: seller.publicKey, mint: null, systemProgram: SystemProgram.programId }).rpc();
await progFor(buyer).methods.fund().accountsPartial({ listing: listingPda(seller.publicKey, off.id, PID), buyer: buyer.publicKey, systemProgram: SystemProgram.programId }).rpc();
const fundedRow = await post(`/api/listings/${off.id}/sync`, null, null, null);
log("escrowed deal:", fundedRow.listing.status, "| held:", Number(fundedRow.escrowedLamports) / LAMPORTS_PER_SOL, "SOL");
if (fundedRow.listing.status !== "paid") throw new Error("expected paid");

// buyer releases
const beforeRelease = await conn.getBalance(seller.publicKey);
await progFor(buyer).methods.release().accountsPartial({ config: configPda(PID), listing: listingPda(seller.publicKey, off.id, PID),
  signer: buyer.publicKey, seller: seller.publicKey, buyer: buyer.publicKey, treasury: new PublicKey(cfg.treasury) }).rpc();
const afterRelease = await conn.getBalance(seller.publicKey);
log("release paid seller", (afterRelease - beforeRelease) / LAMPORTS_PER_SOL, "SOL");
if (afterRelease - beforeRelease !== PRICE * (1 - cfg.feeBps / 10000)) throw new Error("release payout wrong");

log("ALL GOOD ✅  the site settles through the program; no server key was involved");
