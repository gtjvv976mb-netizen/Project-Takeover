/**
 * Puts real, buyable listings on a running site.
 *
 * This is not scripts/seed-demo.mjs. That one writes rows straight into a local sqlite
 * file: fine for looking at the layout, useless for trying the product, because nothing
 * backs those rows on chain and pressing Buy on one would fail. Every listing this script
 * creates is opened on the escrow program with real devnet mints whose authorities really
 * do move into the program's custody, so a stranger with a devnet wallet can buy one and
 * genuinely walk away holding it.
 *
 *   node scripts/seed-live.mjs https://project-takeover.onrender.com
 *
 * Funds come from the deploy wallet (~/.config/solana/id.json) because devnet's faucet is
 * rate-limited to the point of uselessness. Budget roughly 0.03 SOL per listing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { createInitializeMintInstruction, getMint, MINT_SIZE, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import nacl from "tweetnacl";
import bs58 from "bs58";

const BASE = process.argv[2] ?? "http://localhost:3000";
const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const idl = JSON.parse(fs.readFileSync("src/idl/takeover_escrow.json", "utf8"));
const conn = new Connection(RPC, "confirmed");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const authMsg = (action, id, ts) => `Takeover\naction: ${action}\nlisting: ${id ?? "-"}\nts: ${ts}`;
const auth = (kp, action, id) => {
  const timestamp = Date.now();
  return { pubkey: kp.publicKey.toBase58(), timestamp,
    signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(authMsg(action, id, timestamp)), kp.secretKey)) };
};
async function post(p, kp, action, id, body = {}) {
  // auth is re-signed on every attempt: the signature carries a timestamp the server
  // only accepts inside a five-minute window, so a retried stale one would be rejected.
  return retry(`POST ${p}`, async () => {
    const r = await fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, auth: kp ? auth(kp, action, id) : undefined }) });
    const j = await r.json();
    if (!r.ok) throw new Error(`${p}: ${j.error}`);
    return j;
  });
}
const progFor = (kp) => new Program(idl, new AnchorProvider(conn, new Wallet(kp), { commitment: "confirmed" }));
const idBytes = (s) => { const b = Buffer.alloc(16); Buffer.from(s).copy(b); return [...b]; };
const listingPda = (seller, id, pid) => PublicKey.findProgramAddressSync(
  [Buffer.from("listing"), seller.toBuffer(), Buffer.from(idBytes(id))], pid)[0];
const configPda = (pid) => PublicKey.findProgramAddressSync([Buffer.from("config")], pid)[0];

const payerPath = process.env.PAYER ?? path.join(os.homedir(), ".config/solana/id.json");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(payerPath, "utf8"))));

/**
 * Public devnet drops transactions for sport — mostly "Blockhash not found" from a node
 * that is a few slots behind the one that issued the hash. Every send goes through here
 * so one flaky node cannot abandon a half-built listing on chain.
 */
async function retry(label, fn, tries = 5) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      const msg = String(e?.message ?? e);
      const transient = /Blockhash not found|block height exceeded|429|Too Many Requests|timed out|fetch failed|ECONNRESET|socket hang up/i.test(msg);
      if (!transient || i >= tries) throw e;
      log(`  ${label}: ${msg.split("\n")[0].slice(0, 60)} — retry ${i}/${tries - 1}`);
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

/** Fresh blockhash per attempt, otherwise a retry just replays the stale one. */
async function send(label, instructions, signers) {
  return retry(label, async () => {
    const tx = new Transaction().add(...instructions);
    tx.feePayer = signers[0].publicKey;
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    const sig = await conn.sendTransaction(tx, signers, { preflightCommitment: "confirmed" });
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    return sig;
  });
}

async function fund(kp, lamports) {
  return send("fund", [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: kp.publicKey, lamports })], [payer]);
}

/**
 * Prices stay small on purpose. Someone trying the site has whatever devnet SOL they
 * scraped out of a faucet, and a listing they cannot afford is a listing they cannot try.
 */
const TOKENS = [
  { title: "Sunset Terminal", sol: 0.02, auth: ["mint", "freeze"],
    desc: "A terminal-themed SPL token I built over a weekend and never promoted. Mint and freeze authority are both here — take it and do something better with it than I did." },
  { title: "Ledger Nine", sol: 0.05, auth: ["mint"],
    desc: "Supply is fixed and the ticker is clean. I am selling the mint authority only; freeze was revoked on day one, which is exactly what you want if you plan to build on it." },
  { title: "Cold Open", sol: 0.035, auth: ["mint", "freeze"],
    desc: "Shipped it, got bored, moved on. Full control of the token goes to whoever wants to run it. No holders to answer to yet, so you get a clean start." },
];
const PROJECTS = [
  { title: "Dockside Docs", sol: 0.04,
    desc: "A small documentation site with 40-odd pages, a domain, and the analytics account. Runs itself on a static host for about a dollar a month.",
    deliverables: "GitHub repo transfer, domain, Cloudflare account, and the Discord with 120 members.", links: ["https://example.com/dockside"] },
  { title: "Foghorn Analytics", sol: 0.08,
    desc: "A dashboard that reads Solana program logs and charts them. Working code, a paying user, and a Twitter account with a real following.",
    deliverables: "Repo, domain, the X account, and a written handover call.", links: ["https://example.com/foghorn"] },
];

const created = [];

/** Re-runnable: whatever the last run managed to finish is left alone. */
const existing = new Set(
  (await (await fetch(`${BASE}/api/listings?status=all`)).json()).map((r) => r.title),
);
if (existing.size) log(`already live, skipping: ${[...existing].join(", ")}`);

const PID = await (async () => {
  const cfg = await (await fetch(BASE + "/api/config")).json();
  if (!cfg.programId) throw new Error("site reports no program id");
  if (cfg.escrowPubkey) throw new Error("site still exposes a custodial escrow wallet");
  log(`site: ${BASE}  program ${cfg.programId}  fee ${cfg.feeBps / 100}%`);
  return new PublicKey(cfg.programId);
})();

// A market with one seller in it looks like a test. Give each listing its own wallet so
// the builders page and the "N builders" counter mean something.
for (const spec of TOKENS) {
  if (existing.has(spec.title)) continue;
  const seller = Keypair.generate();
  await fund(seller, 0.035 * LAMPORTS_PER_SOL);
  const price = Math.round(spec.sol * LAMPORTS_PER_SOL);

  const mint = Keypair.generate();
  const wantsFreeze = spec.auth.includes("freeze");
  await send(`mint ${spec.title}`, [
    SystemProgram.createAccount({ fromPubkey: seller.publicKey, newAccountPubkey: mint.publicKey, space: MINT_SIZE,
      lamports: await conn.getMinimumBalanceForRentExemption(MINT_SIZE), programId: TOKEN_PROGRAM_ID }),
    // freeze authority is only set when the listing actually sells it, so a listing that
    // says "freeze was revoked" is telling the truth on chain rather than in prose.
    createInitializeMintInstruction(mint.publicKey, 6, seller.publicKey, wantsFreeze ? seller.publicKey : null),
  ], [seller, mint]);

  const row = await post("/api/listings", seller, "create", null, {
    type: "token_authority", title: spec.title, description: spec.desc, priceSol: spec.sol,
    asset: { mint: mint.publicKey.toBase58(), authorities: spec.auth },
  });

  const sp = progFor(seller);
  const pda = listingPda(seller.publicKey, row.id, PID);
  const wanted = (spec.auth.includes("mint") ? 1 : 0) | (wantsFreeze ? 2 : 0);
  await retry("createListing", () => sp.methods.createListing(idBytes(row.id), { tokenAuthority: {} }, new BN(price), wanted, 30)
    .accountsPartial({ config: configPda(PID), listing: pda, seller: seller.publicKey, mint: mint.publicKey, systemProgram: SystemProgram.programId }).rpc());
  for (const bit of [1, 2]) {
    if (!(wanted & bit)) continue;
    await retry(`escrowAuthority ${bit}`, () => sp.methods.escrowAuthority(bit).accountsPartial({ listing: pda, seller: seller.publicKey, mint: mint.publicKey,
      metadata: null, tokenMetadataProgram: null, tokenProgram: TOKEN_PROGRAM_ID }).rpc());
  }
  const m = await getMint(conn, mint.publicKey);
  if (m.mintAuthority?.toBase58() !== pda.toBase58()) throw new Error(`${spec.title}: program does not hold mint authority`);

  const synced = await post(`/api/listings/${row.id}/sync`, null, null, null);
  if (synced.listing.status !== "active") throw new Error(`${spec.title}: expected active, got ${synced.listing.status}`);
  log(`✓ ${spec.title.padEnd(18)} ${spec.sol} SOL  ${row.id}  controls held by the program`);
  created.push({ ...spec, id: row.id, mint: mint.publicKey.toBase58() });
}

for (const spec of PROJECTS) {
  if (existing.has(spec.title)) continue;
  const seller = Keypair.generate();
  await fund(seller, 0.02 * LAMPORTS_PER_SOL);
  const price = Math.round(spec.sol * LAMPORTS_PER_SOL);
  const row = await post("/api/listings", seller, "create", null, {
    type: "offchain", title: spec.title, description: spec.desc, priceSol: spec.sol,
    asset: { category: "project", links: spec.links, deliverables: spec.deliverables },
  });
  const sp = progFor(seller);
  await retry("createListing", () => sp.methods.createListing(idBytes(row.id), { offchain: {} }, new BN(price), 0, 30)
    .accountsPartial({ config: configPda(PID), listing: listingPda(seller.publicKey, row.id, PID),
      seller: seller.publicKey, mint: null, systemProgram: SystemProgram.programId }).rpc());
  const synced = await post(`/api/listings/${row.id}/sync`, null, null, null);
  log(`✓ ${spec.title.padEnd(18)} ${spec.sol} SOL  ${row.id}  ${synced.listing.status}`);
  created.push({ ...spec, id: row.id });
}

const left = await conn.getBalance(payer.publicKey);
log(`\n${created.length} listings live at ${BASE}`);
log(`deploy wallet: ${(left / LAMPORTS_PER_SOL).toFixed(4)} SOL left`);
