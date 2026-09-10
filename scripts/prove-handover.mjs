/**
 * Proves the thing the whole product claims: that a token's ownership really changes
 * hands, and that at no point can either side take both the money and the asset.
 *
 *   RPC_URL=https://api.devnet.solana.com node scripts/prove-handover.mjs
 *
 * It reads the mint's authorities straight off the chain at four moments — before the
 * listing, after the seller hands them to the program, at the instant of sale, and after
 * — and prints an explorer link for every step so none of it has to be taken on trust.
 *
 * The interesting moment is the third. The seller is paid and the buyer receives the
 * authorities in ONE instruction, so there is no window where the seller has both the
 * money and the controls, and none where the buyer has the controls without having paid.
 * That is not a policy or a promise; it is what atomicity means.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { createInitializeMintInstruction, getMint, MINT_SIZE, TOKEN_PROGRAM_ID } from "@solana/spl-token";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const idl = JSON.parse(fs.readFileSync("src/idl/takeover_escrow.json", "utf8"));
const PID = new PublicKey(idl.address);

const prog = (kp) => new Program(idl, new AnchorProvider(conn, new Wallet(kp), { commitment: "confirmed" }));
const idBytes = (s) => { const b = Buffer.alloc(16); Buffer.from(s).copy(b); return [...b]; };
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PID)[0];
const payerPath = process.env.PAYER ?? path.join(os.homedir(), ".config/solana/id.json");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(payerPath, "utf8"))));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(label, fn, tries = 8) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      const m = String(e?.message ?? e);
      if (i >= tries || !/Blockhash not found|block height|429|Too Many|timed out|fetch failed|ECONNRESET/i.test(m)) throw e;
      await sleep(Math.min(1200 * i, 8000));
    }
  }
}
async function send(ix, signers) {
  return retry("send", async () => {
    const tx = new Transaction().add(...ix);
    tx.feePayer = signers[0].publicKey;
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    const sig = await conn.sendTransaction(tx, signers, { preflightCommitment: "confirmed" });
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    return sig;
  });
}
const bal = (pk) => retry("bal", async () => { await sleep(200); return conn.getBalance(pk); });
const rent = (n) => retry("rent", async () => { await sleep(200); return conn.getMinimumBalanceForRentExemption(n); });
const tx = (s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;
const acct = (a) => `https://explorer.solana.com/address/${a}?cluster=devnet`;

/** Who does the CHAIN say controls this token right now? */
async function whoControls(mint, names) {
  const m = await retry("getMint", () => getMint(conn, mint));
  const name = (k) => (k ? names[k.toBase58()] ?? k.toBase58() : "revoked");
  return { mintAuthority: name(m.mintAuthority), freezeAuthority: name(m.freezeAuthority) };
}
function show(step, state) {
  console.log(`\n  ${step}`);
  console.log(`    mint authority   : ${state.mintAuthority}`);
  console.log(`    freeze authority : ${state.freezeAuthority}`);
}

const PRICE = Math.round(Number(process.env.PRICE_SOL ?? 0.05) * LAMPORTS_PER_SOL);

const seller = Keypair.generate();
const buyer = Keypair.generate();
const mint = Keypair.generate();
const id = "proof" + Math.random().toString(36).slice(2, 5);
const listing = pda([Buffer.from("listing"), seller.publicKey.toBuffer(), Buffer.from(idBytes(id))]);
const names = {
  [seller.publicKey.toBase58()]: `SELLER   (${seller.publicKey.toBase58().slice(0, 8)}…)`,
  [buyer.publicKey.toBase58()]: `BUYER    (${buyer.publicKey.toBase58().slice(0, 8)}…)`,
  [listing.toBase58()]: `ESCROW PROGRAM (${listing.toBase58().slice(0, 8)}… — nobody holds this key)`,
};

console.log("=".repeat(78));
console.log("  DOES A PROJECT ACTUALLY CHANGE HANDS?");
console.log("=".repeat(78));
console.log(`\n  seller  ${seller.publicKey.toBase58()}`);
console.log(`  buyer   ${buyer.publicKey.toBase58()}`);
console.log(`  price   ${PRICE / LAMPORTS_PER_SOL} SOL`);

// ---- a token that genuinely belongs to the seller -------------------------
for (const [kp, lamports] of [[seller, 0.04 * LAMPORTS_PER_SOL], [buyer, PRICE + 0.04 * LAMPORTS_PER_SOL]]) {
  await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: kp.publicKey, lamports })], [payer]);
}
const mintSig = await send([
  SystemProgram.createAccount({
    fromPubkey: seller.publicKey, newAccountPubkey: mint.publicKey, space: MINT_SIZE,
    lamports: await rent(MINT_SIZE), programId: TOKEN_PROGRAM_ID,
  }),
  createInitializeMintInstruction(mint.publicKey, 6, seller.publicKey, seller.publicKey),
], [seller, mint]);

console.log(`\n  token   ${mint.publicKey.toBase58()}`);
console.log(`          ${acct(mint.publicKey.toBase58())}`);
console.log(`  created ${tx(mintSig)}`);

console.log("\n" + "-".repeat(78));
show("1. BEFORE — the seller built it and controls it", await whoControls(mint.publicKey, names));

// ---- seller opens the listing and hands the controls to the program -------
const sp = prog(seller);
await retry("create_listing", () => sp.methods
  .createListing(idBytes(id), { tokenAuthority: {} }, new BN(PRICE), 1 | 2, 30)
  .accountsPartial({ config: pda([Buffer.from("config")]), listing, seller: seller.publicKey,
    mint: mint.publicKey, systemProgram: SystemProgram.programId }).rpc());
let escrowSig;
for (const bit of [1, 2]) {
  escrowSig = await retry("escrow", () => sp.methods.escrowAuthority(bit).accountsPartial({
    listing, seller: seller.publicKey, mint: mint.publicKey,
    metadata: null, tokenMetadataProgram: null, tokenProgram: TOKEN_PROGRAM_ID }).rpc());
}
show("2. LISTED — the seller no longer controls it either", await whoControls(mint.publicKey, names));
console.log(`    ${tx(escrowSig)}`);
console.log("\n    Note what this costs the seller: they cannot mint, cannot freeze, and");
console.log("    cannot take it back except by cancelling. The site cannot move it either —");
console.log("    that address is derived from the program and has no private key at all.");

// ---- the moment of sale ---------------------------------------------------
const cfg = await retry("config", () => prog(payer).account.config.fetch(pda([Buffer.from("config")])));
const before = { seller: await bal(seller.publicKey), buyer: await bal(buyer.publicKey) };
const buySig = await retry("buy_token", () => prog(buyer).methods.buyToken().accountsPartial({
  config: pda([Buffer.from("config")]), listing, buyer: buyer.publicKey, seller: seller.publicKey,
  treasury: new PublicKey(cfg.treasury),
  mint: mint.publicKey, metadata: null, tokenMetadataProgram: null,
  tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
}).rpc());
const after = { seller: await bal(seller.publicKey), buyer: await bal(buyer.publicKey) };

show("3. AFTER — one transaction later", await whoControls(mint.publicKey, names));
console.log(`    ${tx(buySig)}`);
console.log("\n    In that single transaction:");
console.log(`      seller received  ${((after.seller - before.seller) / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
console.log(`      buyer  paid      ${((before.buyer - after.buyer) / LAMPORTS_PER_SOL).toFixed(6)} SOL (incl. network fee)`);
console.log("      buyer  received  full control of the token");

// ---- and the buyer can actually use it ------------------------------------
const proof = await retry("getMint", () => getMint(conn, mint.publicKey));
const ok = proof.mintAuthority?.toBase58() === buyer.publicKey.toBase58()
  && proof.freezeAuthority?.toBase58() === buyer.publicKey.toBase58();

console.log("\n" + "=".repeat(78));
if (!ok) {
  console.log("  FAILED — the buyer does not hold the authorities");
  process.exit(1);
}
console.log("  PROVEN. The chain, not this script, now records the buyer as the owner.");
console.log("=".repeat(78));
console.log(`
  Check it yourself without trusting any of the above:

    solana account ${mint.publicKey.toBase58()} --url devnet

  or open ${acct(mint.publicKey.toBase58())}
  and read the Mint Authority field. It says ${buyer.publicKey.toBase58()}.

  That wallet did not exist an hour ago and has never met the seller.
`);
