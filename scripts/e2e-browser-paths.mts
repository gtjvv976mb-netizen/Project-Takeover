/**
 * Drives the exact functions the browser runs, against devnet.
 *
 *   RPC_URL=https://api.devnet.solana.com npx tsx scripts/e2e-browser-paths.mts [siteUrl]
 *
 * Every other e2e script in here builds its own transactions. That is why they all kept
 * passing on the day the website was broken: rotating the treasury desynced the site from
 * the chain and every purchase would have failed with BadTreasury, while the scripts —
 * which read the treasury straight from the config account — sailed through. A test that
 * does not use the same code as the thing it is testing is not testing it.
 *
 * So this imports `src/lib/client/program.ts` itself, and takes the treasury from the
 * site's own /api/config exactly as the listing page does. If those two ever disagree
 * again, this fails where it matters.
 *
 * The only thing faked is the wallet adapter, which is a browser object and cannot exist
 * in node. A keypair stands in for the extension; every account, instruction and address
 * below is produced by the real client code.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { createInitializeMintInstruction, getMint, MINT_SIZE, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import {
  buyTokenOnChain, createListingOnChain, escrowAuthorityOnChain,
  fundOnChain, makeOfferOnChain, acceptOfferOnChain, releaseOnChain, cancelOnChain,
} from "../src/lib/client/program";

const SITE = process.argv[2] ?? "http://localhost:3000";
const conn = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** The wallet adapter is a browser object; a keypair is the smallest honest stand-in. */
function walletFor(kp: Keypair): WalletContextState {
  const sign = async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
    (tx as Transaction).partialSign(kp);
    return tx;
  };
  return {
    publicKey: kp.publicKey,
    signTransaction: sign,
    signAllTransactions: async (txs: Transaction[]) => { for (const t of txs) await sign(t); return txs; },
  } as unknown as WalletContextState;
}

const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
  fs.readFileSync(process.env.PAYER ?? path.join(os.homedir(), ".config/solana/id.json"), "utf8"))));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function retry<T>(label: string, fn: () => Promise<T>, tries = 8): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      const m = String((e as Error)?.message ?? e);
      if (i >= tries || !/Blockhash not found|block height|429|Too Many|timed out|fetch failed|ECONNRESET/i.test(m)) throw e;
      log(`  ${label} retry ${i}`); await sleep(Math.min(1200 * i, 8000));
    }
  }
}
type Ix = Parameters<Transaction["add"]>[0];
async function send(ix: Ix[], signers: Keypair[]) {
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
const fund = (kp: Keypair, lamports: number) =>
  send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: kp.publicKey, lamports })], [payer]);

async function freshMint(owner: Keypair, withFreeze = true) {
  const mint = Keypair.generate();
  await send([
    SystemProgram.createAccount({
      fromPubkey: owner.publicKey, newAccountPubkey: mint.publicKey, space: MINT_SIZE,
      lamports: await retry("rent", () => conn.getMinimumBalanceForRentExemption(MINT_SIZE)),
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(mint.publicKey, 6, owner.publicKey, withFreeze ? owner.publicKey : null),
  ], [owner, mint]);
  return mint.publicKey;
}

const PRICE = Math.round(Number(process.env.PRICE_SOL ?? 0.02) * LAMPORTS_PER_SOL);
const rid = () => Math.random().toString(36).slice(2, 10);

// The site's own view of the treasury — the value the listing page hands to buyTokenOnChain.
const cfg = await (await fetch(`${SITE}/api/config`)).json();
log(`site ${SITE}`);
log(`site says treasury ${cfg.treasury}, fee ${cfg.feeBps / 100}%`);

let failures = 0;
async function step(name: string, fn: () => Promise<void>) {
  try { await fn(); log(`✓ ${name}`); }
  catch (e) { failures++; log(`✗ ${name}\n    ${String((e as Error)?.message ?? e).split("\n")[0]}`); }
}

// ---------------------------------------------------------------- token sale
await step("token listing: create → escrow → buy, all through the browser code", async () => {
  const seller = Keypair.generate(), buyer = Keypair.generate();
  await fund(seller, 0.05 * LAMPORTS_PER_SOL);
  await fund(buyer, PRICE + 0.04 * LAMPORTS_PER_SOL);
  const mint = await freshMint(seller);
  const id = rid();

  await retry("create", () => createListingOnChain(conn, walletFor(seller), {
    id, type: "token_authority", priceLamports: PRICE, authorities: ["mint", "freeze"], mint: mint.toBase58(),
  }));
  for (const a of ["mint", "freeze"] as const) {
    await retry("escrow", () => escrowAuthorityOnChain(conn, walletFor(seller), { id, mint: mint.toBase58(), which: a }));
  }
  // exactly what src/app/listings/[id]/page.tsx passes
  await retry("buy", () => buyTokenOnChain(conn, walletFor(buyer), {
    id, seller: seller.publicKey.toBase58(), treasury: cfg.treasury, mint: mint.toBase58(), includesMetadata: false,
  }));

  const m = await retry("getMint", () => getMint(conn, mint));
  assert.equal(m.mintAuthority?.toBase58(), buyer.publicKey.toBase58(), "buyer must hold mint authority");
  assert.equal(m.freezeAuthority?.toBase58(), buyer.publicKey.toBase58(), "buyer must hold freeze authority");
});

// ------------------------------------------------------------------- cancel
await step("token listing: a seller can cancel and get the controls back", async () => {
  const seller = Keypair.generate();
  await fund(seller, 0.05 * LAMPORTS_PER_SOL);
  const mint = await freshMint(seller, false);
  const id = rid();
  await retry("create", () => createListingOnChain(conn, walletFor(seller), {
    id, type: "token_authority", priceLamports: PRICE, authorities: ["mint"], mint: mint.toBase58(),
  }));
  await retry("escrow", () => escrowAuthorityOnChain(conn, walletFor(seller), { id, mint: mint.toBase58(), which: "mint" }));
  await retry("cancel", () => cancelOnChain(conn, walletFor(seller), { id, mint: mint.toBase58(), includesMetadata: false }));
  const m = await retry("getMint", () => getMint(conn, mint));
  assert.equal(m.mintAuthority?.toBase58(), seller.publicKey.toBase58(), "authority must come home");
});

// ------------------------------------------------------------- funded offer
await step("funded offer: make → accept, from a holder who never listed", async () => {
  const owner = Keypair.generate(), bidder = Keypair.generate();
  await fund(owner, 0.04 * LAMPORTS_PER_SOL);
  await fund(bidder, PRICE + 0.05 * LAMPORTS_PER_SOL);
  const mint = await freshMint(owner, false);
  const id = rid();

  await retry("makeOffer", () => makeOfferOnChain(conn, walletFor(bidder), {
    id, mint: mint.toBase58(), priceLamports: PRICE, authorities: ["mint"], expiryDays: 7,
  }));
  await retry("acceptOffer", () => acceptOfferOnChain(conn, walletFor(owner), {
    id, buyer: bidder.publicKey.toBase58(), treasury: cfg.treasury, mint: mint.toBase58(), includesMetadata: false,
  }));

  const m = await retry("getMint", () => getMint(conn, mint));
  assert.equal(m.mintAuthority?.toBase58(), bidder.publicKey.toBase58(), "bidder must end up holding it");
});

// ------------------------------------------------------- escrowed project
await step("project listing: fund → release pays the seller", async () => {
  const seller = Keypair.generate(), buyer = Keypair.generate();
  await fund(seller, 0.03 * LAMPORTS_PER_SOL);
  await fund(buyer, PRICE + 0.04 * LAMPORTS_PER_SOL);
  const id = rid();
  await retry("create", () => createListingOnChain(conn, walletFor(seller), {
    id, type: "offchain", priceLamports: PRICE, authorities: [], deliveryDays: 7,
  }));
  await retry("fund", () => fundOnChain(conn, walletFor(buyer), { id, seller: seller.publicKey.toBase58() }));
  const before = await retry("bal", () => conn.getBalance(seller.publicKey));
  await retry("release", () => releaseOnChain(conn, walletFor(buyer), {
    id, seller: seller.publicKey.toBase58(), buyer: buyer.publicKey.toBase58(), treasury: cfg.treasury,
  }));
  const gained = (await retry("bal", () => conn.getBalance(seller.publicKey))) - before;
  const expected = PRICE - Math.floor((PRICE * cfg.feeBps) / 10_000);
  assert.equal(gained, expected, `seller should net ${expected}, got ${gained}`);
});

console.log();
log(failures === 0
  ? "BROWSER PATHS OK ✅  every flow the site offers works with the code the site runs"
  : `${failures} browser path(s) BROKEN ✗`);
process.exit(failures ? 1 : 0);
