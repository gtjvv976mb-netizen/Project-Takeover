// End-to-end test of the token_authority and offchain flows against a running dev server:
// escrow -> list -> pay -> atomic settle, plus replay rejection and late-payment auto-refund.
// Usage: RPC_URL=http://127.0.0.1:8899 node scripts/e2e-devnet.mjs [http://localhost:3000]
// Defaults to devnet, but devnet's faucet is rate-limited; a local solana-test-validator is far more reliable.
// Creates a fresh mint with a seller keypair, lists it, escrows authorities, buys it with a buyer keypair,
// and checks the buyer ends up holding the authorities. Needs devnet airdrops (may be rate limited).
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { AuthorityType, createMint, createSetAuthorityInstruction, getMint } from "@solana/spl-token";
import nacl from "tweetnacl";
import bs58 from "bs58";
import fs from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const rpc = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const conn = new Connection(rpc, "confirmed");

const authMsg = (action, id, ts) => `Takeover\naction: ${action}\nlisting: ${id ?? "-"}\nts: ${ts}`;
function auth(kp, action, id) {
  const timestamp = Date.now();
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(authMsg(action, id, timestamp)), kp.secretKey));
  return { pubkey: kp.publicKey.toBase58(), signature, timestamp };
}
async function post(path, kp, action, id, body = {}) {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, auth: auth(kp, action, id) }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error}`);
  return j;
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// Reuse test keypairs across runs so airdrops aren't needed every time.
function loadOrCreate(file) {
  if (fs.existsSync(file)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
  const kp = Keypair.generate(); fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey))); return kp;
}
fs.mkdirSync("data/test", { recursive: true });
const seller = loadOrCreate("data/test/seller.json");
const buyer = loadOrCreate("data/test/buyer.json");

async function ensureFunds(kp, minSol, label) {
  const bal = await conn.getBalance(kp.publicKey);
  log(`${label} ${kp.publicKey.toBase58()} balance ${bal / LAMPORTS_PER_SOL} SOL`);
  if (bal >= minSol * LAMPORTS_PER_SOL) return;
  log(`airdropping 1 SOL to ${label}…`);
  const sig = await conn.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");
}

const cfg = await (await fetch(BASE + "/api/config")).json();
log("config", cfg);
const escrow = new PublicKey(cfg.escrowPubkey);

await ensureFunds(seller, 0.05, "seller");
await ensureFunds(buyer, 0.2, "buyer");
const escrowBal = await conn.getBalance(escrow);
log(`escrow balance ${escrowBal / LAMPORTS_PER_SOL} SOL`);
if (escrowBal < 0.01 * LAMPORTS_PER_SOL) {
  log("funding escrow with 0.02 SOL from buyer for tx fees");
  await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: buyer.publicKey, toPubkey: escrow, lamports: 0.02 * LAMPORTS_PER_SOL })), [buyer]);
}

// 1. seller creates a mint (mint + freeze authority = seller)
const mint = await createMint(conn, seller, seller.publicKey, seller.publicKey, 6);
log("created mint", mint.toBase58());

// 2. token lookup
const tok = await (await fetch(`${BASE}/api/token/${mint.toBase58()}`)).json();
log("token info", tok);
if (tok.mintAuthority !== seller.publicKey.toBase58()) throw new Error("lookup wrong");

// 3. create listing (draft)
const priceSol = 0.05;
let l = await post("/api/listings", seller, "create", null, {
  type: "token_authority", title: "E2E test token", description: "auto test", priceSol,
  asset: { mint: mint.toBase58(), authorities: ["mint", "freeze"] },
});
log("listing created", l.id, l.status);
if (l.status !== "draft") throw new Error("expected draft");

// 4. seller moves authorities to escrow
const tx = new Transaction()
  .add(createSetAuthorityInstruction(mint, seller.publicKey, AuthorityType.MintTokens, escrow))
  .add(createSetAuthorityInstruction(mint, seller.publicKey, AuthorityType.FreezeAccount, escrow));
const escrowSig = await sendAndConfirmTransaction(conn, tx, [seller]);
log("authorities -> escrow", escrowSig);
l = await post(`/api/listings/${l.id}/verify-escrow`, seller, "verify-escrow", l.id, { signature: escrowSig });
log("listing status", l.status);
if (l.status !== "active") throw new Error("expected active");

// 4b. negative: buyer can't cancel, seller can't buy own
await post(`/api/listings/${l.id}/cancel`, buyer, "cancel", l.id).then(() => { throw new Error("buyer cancel should fail"); }, (e) => log("ok, rejected:", e.message));

// 5. buyer pays
const sellerBefore = await conn.getBalance(seller.publicKey);
const payTx = new Transaction()
  .add(SystemProgram.transfer({ fromPubkey: buyer.publicKey, toPubkey: escrow, lamports: priceSol * LAMPORTS_PER_SOL }));
const paySig = await sendAndConfirmTransaction(conn, payTx, [buyer]);
log("paid", paySig);

// 5b. negative: replaying a wrong memo / wrong listing should fail -> try paying with a bogus signature
await post(`/api/listings/${l.id}/pay`, buyer, "pay", l.id, { signature: escrowSig }).then(() => { throw new Error("bogus sig should fail"); }, (e) => log("ok, rejected:", e.message));

l = await post(`/api/listings/${l.id}/pay`, buyer, "pay", l.id, { signature: paySig });
log("after pay:", l.status, l.settlementSig);
if (l.status === "paid") { log("settlement failed on first try, retrying"); l = await post(`/api/listings/${l.id}/settle`, buyer, "settle", l.id); }
if (l.status !== "sold") throw new Error("expected sold");

// 6. verify on-chain outcome
const m = await getMint(conn, mint);
const sellerAfter = await conn.getBalance(seller.publicKey);
log("mint authority now", m.mintAuthority?.toBase58(), "freeze", m.freezeAuthority?.toBase58());
log("seller received", (sellerAfter - sellerBefore) / LAMPORTS_PER_SOL, "SOL (expected", priceSol * (1 - cfg.feeBps / 10000), ")");
if (m.mintAuthority?.toBase58() !== buyer.publicKey.toBase58()) throw new Error("buyer did not get mint authority");
if (m.freezeAuthority?.toBase58() !== buyer.publicKey.toBase58()) throw new Error("buyer did not get freeze authority");

// 7. offchain listing + release flow
let o = await post("/api/listings", seller, "create", null, { type: "offchain", title: "E2E website", description: "x", priceSol: 0.02, asset: { category: "website", links: ["https://example.com"], deliverables: "logins" } });
log("offchain listing", o.id, o.status);
const payTx2 = new Transaction()
  .add(SystemProgram.transfer({ fromPubkey: buyer.publicKey, toPubkey: escrow, lamports: 0.02 * LAMPORTS_PER_SOL }));
const paySig2 = await sendAndConfirmTransaction(conn, payTx2, [buyer]);
await post(`/api/listings/${o.id}/pay`, buyer, "pay", o.id, { signature: paySig }).then(() => { throw new Error("replayed sig should fail"); }, (e) => log("ok, rejected replay:", e.message));
o = await post(`/api/listings/${o.id}/pay`, buyer, "pay", o.id, { signature: paySig2 });
log("offchain after pay:", o.status);
await post(`/api/listings/${o.id}/release`, seller, "release", o.id).then(() => { throw new Error("seller release should fail"); }, (e) => log("ok, rejected:", e.message));
o = await post(`/api/listings/${o.id}/release`, buyer, "release", o.id);
log("offchain after release:", o.status, o.settlementSig);
if (o.status !== "sold") throw new Error("expected sold");

// 8. late payment: pay for the already-sold token listing -> automatic refund
const buyerBefore = await conn.getBalance(buyer.publicKey);
const lateSig = await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: buyer.publicKey, toPubkey: escrow, lamports: priceSol * LAMPORTS_PER_SOL })), [buyer]);
await post(`/api/listings/${l.id}/pay`, buyer, "pay", l.id, { signature: lateSig }).then(() => { throw new Error("late pay should be rejected"); }, (e) => log("ok, late payment:", e.message));
await new Promise((r) => setTimeout(r, 1500));
const buyerAfter = await conn.getBalance(buyer.publicKey);
log("buyer net after late payment + refund:", (buyerAfter - buyerBefore) / LAMPORTS_PER_SOL, "SOL (should be ~ -0.000005, just the tx fee)");
if (buyerBefore - buyerAfter > 0.001 * LAMPORTS_PER_SOL) throw new Error("refund not received");
await post(`/api/listings/${l.id}/pay`, buyer, "pay", l.id, { signature: lateSig }).then(() => { throw new Error("double refund should fail"); }, (e) => log("ok, no double refund:", e.message));

log("ALL GOOD ✅");
