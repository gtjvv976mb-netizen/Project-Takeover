/**
 * Proves the fee split end to end: 5% off the seller, 3 points to stakers, 2 to the
 * treasury, and every staker able to withdraw their share in proportion to what they had
 * staked at the time of the sale.
 *
 *   RPC_URL=https://api.devnet.solana.com node scripts/e2e-rewards.mjs
 *
 * Two stakers deliberately hold different amounts, and one of them stakes only AFTER the
 * first sale, because the whole point of the accumulator is that a latecomer cannot reach
 * back for a fee that was paid before they arrived.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction, createInitializeMintInstruction, createMintToInstruction,
  getAssociatedTokenAddressSync, getMint, MINT_SIZE, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const idl = JSON.parse(fs.readFileSync("src/idl/takeover_escrow.json", "utf8"));
const PID = new PublicKey(idl.address);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const prog = (kp) => new Program(idl, new AnchorProvider(conn, new Wallet(kp), { commitment: "confirmed" }));
const idBytes = (s) => { const b = Buffer.alloc(16); Buffer.from(s).copy(b); return [...b]; };
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PID)[0];
const configPda = () => pda([Buffer.from("config")]);
const poolPda = () => pda([Buffer.from("reward_pool")]);
const vaultPda = () => pda([Buffer.from("reward_vault")]);
const stakePda = (owner) => pda([Buffer.from("stake"), owner.toBuffer()]);
const listingPda = (seller, id) => pda([Buffer.from("listing"), seller.toBuffer(), Buffer.from(idBytes(id))]);

const payerPath = process.env.PAYER ?? path.join(os.homedir(), ".config/solana/id.json");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(payerPath, "utf8"))));

async function retry(label, fn, tries = 5) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      const m = String(e?.message ?? e);
      if (i >= tries || !/Blockhash not found|block height|429|Too Many|timed out|fetch failed|ECONNRESET/i.test(m)) throw e;
      log(`  ${label} retry ${i}`); await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}
async function send(label, ix, signers) {
  return retry(label, async () => {
    const tx = new Transaction().add(...ix);
    tx.feePayer = signers[0].publicKey;
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    const sig = await conn.sendTransaction(tx, signers, { preflightCommitment: "confirmed" });
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    return sig;
  });
}
const fund = (kp, lamports) =>
  send("fund", [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: kp.publicKey, lamports })], [payer]);

const PRICE = Math.round(Number(process.env.PRICE_SOL ?? 0.1) * LAMPORTS_PER_SOL);

// ---------------------------------------------------------------- setup ----
const cfg = await prog(payer).account.config.fetch(configPda());
log(`config: fee ${cfg.feeBps / 100}%  holders ${cfg.rewardsBps / 100}%  treasury ${(cfg.feeBps - cfg.rewardsBps) / 100}%`);
if (cfg.rewardsBps === 0) throw new Error("rewards_bps is 0 — run update_config first");

// A stand-in for TAKEOVER until the real coin exists.
const mint = Keypair.generate();
await send("mint", [
  SystemProgram.createAccount({
    fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, space: MINT_SIZE,
    lamports: await conn.getMinimumBalanceForRentExemption(MINT_SIZE), programId: TOKEN_PROGRAM_ID,
  }),
  createInitializeMintInstruction(mint.publicKey, 6, payer.publicKey, null),
], [payer, mint]);
log("stand-in TAKEOVER mint", mint.publicKey.toBase58());

const pool = poolPda();
if (!(await conn.getAccountInfo(pool))) {
  await retry("init_reward_pool", () => prog(payer).methods.initRewardPool().accountsPartial({
    authority: payer.publicKey, config: configPda(), rewardPool: pool,
    mint: mint.publicKey, vault: vaultPda(), tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId, rent: new PublicKey("SysvarRent111111111111111111111111111111111"),
  }).rpc());
  log("reward pool opened");
} else {
  log("reward pool already exists");
}

// Two holders, deliberately unequal: 70 / 30.
const alice = Keypair.generate(), bob = Keypair.generate();
for (const [kp, amount] of [[alice, 700_000_000], [bob, 300_000_000]]) {
  await fund(kp, 0.05 * LAMPORTS_PER_SOL);
  const ata = getAssociatedTokenAddressSync(mint.publicKey, kp.publicKey);
  await send("mintTo", [
    createAssociatedTokenAccountInstruction(payer.publicKey, ata, kp.publicKey, mint.publicKey),
    createMintToInstruction(mint.publicKey, ata, payer.publicKey, amount),
  ], [payer]);
}
log("alice holds 700, bob holds 300");

const stakeIx = (kp, amount) => retry("stake", () => prog(kp).methods.stake(new BN(amount)).accountsPartial({
  owner: kp.publicKey, rewardPool: pool, vault: vaultPda(),
  from: getAssociatedTokenAddressSync(mint.publicKey, kp.publicKey),
  stake: stakePda(kp.publicKey), tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
}).rpc());

await stakeIx(alice, 700_000_000);
log("alice staked 700 — bob has not staked yet, on purpose");

// ------------------------------------------------------- sale number one ---
async function sell(label) {
  const seller = Keypair.generate(), buyer = Keypair.generate();
  await fund(seller, 0.04 * LAMPORTS_PER_SOL);
  await fund(buyer, PRICE + 0.04 * LAMPORTS_PER_SOL);
  const m = Keypair.generate();
  await send("mint", [
    SystemProgram.createAccount({ fromPubkey: seller.publicKey, newAccountPubkey: m.publicKey, space: MINT_SIZE,
      lamports: await conn.getMinimumBalanceForRentExemption(MINT_SIZE), programId: TOKEN_PROGRAM_ID }),
    createInitializeMintInstruction(m.publicKey, 6, seller.publicKey, null),
  ], [seller, m]);

  const id = label.slice(0, 8).padEnd(8, "x");
  const lp = listingPda(seller.publicKey, id);
  const sp = prog(seller);
  await retry("create_listing", () => sp.methods.createListing(idBytes(id), { tokenAuthority: {} }, new BN(PRICE), 1, 30)
    .accountsPartial({ config: configPda(), listing: lp, seller: seller.publicKey, mint: m.publicKey,
      systemProgram: SystemProgram.programId }).rpc());
  await retry("escrow", () => sp.methods.escrowAuthority(1).accountsPartial({ listing: lp, seller: seller.publicKey,
    mint: m.publicKey, metadata: null, tokenMetadataProgram: null, tokenProgram: TOKEN_PROGRAM_ID }).rpc());

  const before = { treasury: await conn.getBalance(new PublicKey(cfg.treasury)), pool: await conn.getBalance(pool) };
  await retry("buy_token", () => prog(buyer).methods.buyToken().accountsPartial({
    config: configPda(), listing: lp, buyer: buyer.publicKey, seller: seller.publicKey,
    treasury: new PublicKey(cfg.treasury), mint: m.publicKey, metadata: null, tokenMetadataProgram: null,
    rewardPool: pool, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).rpc());
  const after = { treasury: await conn.getBalance(new PublicKey(cfg.treasury)), pool: await conn.getBalance(pool) };

  const holders = after.pool - before.pool, treasury = after.treasury - before.treasury;
  const wantHolders = Math.floor(PRICE * cfg.rewardsBps / 10_000);
  const wantTreasury = Math.floor(PRICE * cfg.feeBps / 10_000) - wantHolders;
  log(`  ${label}: holders +${holders} (want ${wantHolders}), treasury +${treasury} (want ${wantTreasury})`);
  if (holders !== wantHolders) throw new Error(`holder cut wrong: ${holders} != ${wantHolders}`);
  if (treasury !== wantTreasury) throw new Error(`treasury cut wrong: ${treasury} != ${wantTreasury}`);
  const mi = await getMint(conn, m.publicKey);
  if (mi.mintAuthority?.toBase58() !== buyer.publicKey.toBase58()) throw new Error("buyer did not receive authority");
  return wantHolders;
}

const fee1 = await sell("sale-one");

// Bob arrives only now. He must NOT be owed anything from sale one.
await stakeIx(bob, 300_000_000);
log("bob staked 300 after the first sale");

const fee2 = await sell("sale-two");

// ------------------------------------------------------------- claiming ----
async function claim(kp, who) {
  const before = await conn.getBalance(kp.publicKey);
  await retry("claim", () => prog(kp).methods.claim().accountsPartial({
    owner: kp.publicKey, rewardPool: pool, stake: stakePda(kp.publicKey),
  }).rpc());
  const got = (await conn.getBalance(kp.publicKey)) - before;
  log(`  ${who} claimed ${got} lamports`);
  return got;
}

// alice had the pool to herself for sale one, then 70% of it for sale two.
const aliceWant = fee1 + Math.floor(fee2 * 700 / 1000);
const bobWant = Math.floor(fee2 * 300 / 1000);
const aliceGot = await claim(alice, "alice");
const bobGot = await claim(bob, "bob");

const near = (a, b) => Math.abs(a - b) <= 2500; // claim's own tx fee, plus rounding dust
if (!near(aliceGot, aliceWant)) throw new Error(`alice got ${aliceGot}, expected ~${aliceWant}`);
if (!near(bobGot, bobWant)) throw new Error(`bob got ${bobGot}, expected ~${bobWant}`);
if (bobGot >= fee1) throw new Error("bob was paid from a sale that happened before he staked");

log("");
log(`sale one fee to holders: ${fee1}  — alice alone was staked`);
log(`sale two fee to holders: ${fee2}  — split 70/30`);
log(`alice expected ~${aliceWant}, got ${aliceGot}`);
log(`bob   expected ~${bobWant}, got ${bobGot}  (correctly shut out of sale one)`);
log("REWARDS LIVE ✅  3% of every fee reaches stakers, in proportion, and only for sales they were staked for");
