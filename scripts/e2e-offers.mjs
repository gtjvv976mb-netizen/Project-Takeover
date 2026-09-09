/**
 * Prove funded offers on a real cluster: a stranger bids on a token they do not own,
 * the actual owner accepts, and the controls and the money swap in one instruction.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { createInitializeMintInstruction, getMint, MINT_SIZE, TOKEN_PROGRAM_ID } from "@solana/spl-token";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const PRICE = Math.round(Number(process.env.PRICE_SOL ?? 0.05) * LAMPORTS_PER_SOL);
const idl = JSON.parse(fs.readFileSync("src/idl/takeover_escrow.json", "utf8"));
const conn = new Connection(RPC, "confirmed");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const PID = new PublicKey(idl.address);
const prog = (kp) => new Program(idl, new AnchorProvider(conn, new Wallet(kp), { commitment: "confirmed" }));
const idBytes = (s) => { const b = Buffer.alloc(16); Buffer.from(s).copy(b); return [...b]; };
const offerPda = (buyer, id) => PublicKey.findProgramAddressSync([Buffer.from("offer"), buyer.toBuffer(), Buffer.from(id)], PID)[0];
const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], PID)[0];

const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))));
const owner = Keypair.generate(), bidder = Keypair.generate();
async function fund(kp, lamports) {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: kp.publicKey, lamports }));
  await conn.confirmTransaction(await conn.sendTransaction(tx, [payer]), "confirmed");
}
await fund(owner, 0.03 * LAMPORTS_PER_SOL);
// enough for two bids: one that gets taken, and one the bidder withdraws
await fund(bidder, PRICE * 2 + 0.04 * LAMPORTS_PER_SOL);
log("funded an owner and an unrelated bidder");

// a token the bidder has nothing to do with
const mint = Keypair.generate();
await conn.confirmTransaction(await conn.sendTransaction(new Transaction().add(
  SystemProgram.createAccount({ fromPubkey: owner.publicKey, newAccountPubkey: mint.publicKey, space: MINT_SIZE,
    lamports: await conn.getMinimumBalanceForRentExemption(MINT_SIZE), programId: TOKEN_PROGRAM_ID }),
  createInitializeMintInstruction(mint.publicKey, 6, owner.publicKey, owner.publicKey),
), [owner, mint]), "confirmed");
log("a token exists, owned by someone who never visited the site:", mint.publicKey.toBase58().slice(0, 8));

const cfg = await prog(payer).account.config.fetch(configPda);
const id = idBytes("live" + Date.now().toString(36).slice(-6));
const offer = offerPda(bidder.publicKey, id);

// the bid
const bidderBefore = await conn.getBalance(bidder.publicKey);
await prog(bidder).methods.makeOffer(id, new BN(PRICE), 1 | 2, 14)
  .accountsPartial({ config: configPda, offer, buyer: bidder.publicKey, mint: mint.publicKey, systemProgram: SystemProgram.programId }).rpc();
const held = (await prog(payer).account.offer.fetch(offer)).escrowedLamports;
log(`bid placed: ${Number(held) / LAMPORTS_PER_SOL} SOL locked on chain, bidder down ${((bidderBefore - await conn.getBalance(bidder.publicKey)) / LAMPORTS_PER_SOL).toFixed(4)}`);

// the owner takes it
const ownerBefore = await conn.getBalance(owner.publicKey);
await prog(owner).methods.acceptOffer().accountsPartial({
  config: configPda, offer, seller: owner.publicKey, buyer: bidder.publicKey, treasury: cfg.treasury,
  mint: mint.publicKey, metadata: null, tokenMetadataProgram: null, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
const ownerAfter = await conn.getBalance(owner.publicKey);
const m = await getMint(conn, mint.publicKey);

const expected = PRICE * (1 - cfg.feeBps / 10000);
log(`owner received ${((ownerAfter - ownerBefore) / LAMPORTS_PER_SOL).toFixed(4)} SOL (expected ${(expected / LAMPORTS_PER_SOL).toFixed(4)} after ${cfg.feeBps / 100}% fee)`);
if (m.mintAuthority?.toBase58() !== bidder.publicKey.toBase58()) throw new Error("bidder did not get mint authority");
if (m.freezeAuthority?.toBase58() !== bidder.publicKey.toBase58()) throw new Error("bidder did not get freeze authority");
log("the bidder now controls a token they did not own an hour ago ✓");

// and a bid nobody takes comes back
const id2 = idBytes("back" + Date.now().toString(36).slice(-6));
const offer2 = offerPda(bidder.publicKey, id2);
await prog(bidder).methods.makeOffer(id2, new BN(PRICE), 1, 14)
  .accountsPartial({ config: configPda, offer: offer2, buyer: bidder.publicKey, mint: mint.publicKey, systemProgram: SystemProgram.programId }).rpc();
const b1 = await conn.getBalance(bidder.publicKey);
await prog(bidder).methods.cancelOffer().accountsPartial({ offer: offer2, signer: bidder.publicKey, buyer: bidder.publicKey }).rpc();
log(`withdrew an unwanted bid, ${((await conn.getBalance(bidder.publicKey) - b1) / LAMPORTS_PER_SOL).toFixed(4)} SOL returned`);

log("LIVE ON DEVNET ✅  funded offers work end to end");
