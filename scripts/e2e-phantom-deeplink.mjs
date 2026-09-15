/**
 * The phone flow, end to end, with a stand-in for the Phantom app.
 *
 *   node scripts/e2e-phantom-deeplink.mjs [siteUrl]        (default http://127.0.0.1:3350)
 *
 * Everything the site does is real: the Wallet Standard registration, the modal, the
 * encrypted links, the return page, the cross-tab handoff, and the signatures the API
 * verifies. What is faked is the other end — the Phantom app — which here is a Playwright
 * route on phantom.app that decrypts each request with the shared key, signs it with a
 * keypair, and answers the way Phantom does: a redirect to the site carrying the
 * encrypted reply.
 *
 * iOS opens that redirect in a new Safari tab, so that is how it is opened here: the
 * asking tab stays put and must finish on its own. The same-tab variant (some Android
 * browsers) and the rejection path are covered too.
 */
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { chromium } from "playwright-core";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";

const BASE = (process.argv[2] ?? "http://127.0.0.1:3350").replace(/\/$/, "");
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 20_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(150);
  }
}

/** Phantom's half: one x25519 key for transport, one ed25519 key that is "the wallet". */
class FakePhantom {
  constructor() {
    this.enc = nacl.box.keyPair();
    this.wallet = Keypair.generate();
    this.session = bs58.encode(nacl.randomBytes(32));
    this.shared = null;
    this.calls = [];
    this.reject = false;
  }
  get short() { const k = this.wallet.publicKey.toBase58(); return `${k.slice(0, 4)}..${k.slice(-4)}`; }
  reply(href) {
    const u = new URL(href);
    const method = u.pathname.split("/").pop();
    const p = u.searchParams;
    const redirect = new URL(p.get("redirect_link"));
    assert.ok(redirect.pathname.startsWith("/wallet/return/"), `redirect_link goes to the return page: ${redirect}`);
    const call = { method, redirect: null };
    this.calls.push(call);
    if (this.reject) {
      redirect.searchParams.set("errorCode", "4001");
      redirect.searchParams.set("errorMessage", "User rejected the request.");
      return (call.redirect = redirect.toString());
    }
    const dappPub = bs58.decode(p.get("dapp_encryption_public_key"));
    if (method === "connect") {
      assert.equal(p.get("app_url"), new URL(BASE).origin);
      assert.ok(["mainnet-beta", "devnet", "testnet"].includes(p.get("cluster")), "cluster named");
      this.shared = nacl.box.before(dappPub, this.enc.secretKey);
      const { nonce, data } = this.encrypt({ public_key: this.wallet.publicKey.toBase58(), session: this.session });
      redirect.searchParams.set("phantom_encryption_public_key", bs58.encode(this.enc.publicKey));
      redirect.searchParams.set("nonce", nonce);
      redirect.searchParams.set("data", data);
      return (call.redirect = redirect.toString());
    }
    const payload = this.decrypt(p.get("payload"), p.get("nonce"));
    assert.equal(payload.session, this.session, "the session token from connect rides in every later request");
    let out;
    if (method === "signMessage") {
      const msg = bs58.decode(payload.message);
      call.message = Buffer.from(msg).toString("utf8");
      out = { signature: bs58.encode(nacl.sign.detached(msg, this.wallet.secretKey)) };
    } else if (method === "signTransaction") {
      const tx = Transaction.from(bs58.decode(payload.transaction));
      tx.partialSign(this.wallet);
      out = { transaction: bs58.encode(tx.serialize({ requireAllSignatures: false })) };
    } else if (method === "signAllTransactions") {
      out = { transactions: payload.transactions.map((t) => { const tx = Transaction.from(bs58.decode(t)); tx.partialSign(this.wallet); return bs58.encode(tx.serialize({ requireAllSignatures: false })); }) };
    } else {
      throw new Error(`unexpected deep link ${method}`);
    }
    const { nonce, data } = this.encrypt(out);
    redirect.searchParams.set("nonce", nonce);
    redirect.searchParams.set("data", data);
    return (call.redirect = redirect.toString());
  }
  encrypt(obj) {
    const nonce = nacl.randomBytes(24);
    return { nonce: bs58.encode(nonce), data: bs58.encode(nacl.box.after(Buffer.from(JSON.stringify(obj)), nonce, this.shared)) };
  }
  decrypt(payload, nonce) {
    const opened = nacl.box.open.after(bs58.decode(payload), bs58.decode(nonce), this.shared);
    assert.ok(opened, "Phantom could open the payload");
    return JSON.parse(Buffer.from(opened).toString());
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium", headless: true });
const failures = [];

async function phone(opts = {}) {
  const ctx = await browser.newContext({ userAgent: IPHONE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...opts });
  return ctx;
}
/** `sameTab`: answer with a 302 (the asking page navigates). Otherwise 204: the page stays, as under iOS. */
async function playPhantom(ctx, phantom, { sameTab = false } = {}) {
  await ctx.route("https://phantom.app/**", async (route) => {
    const redirect = phantom.reply(route.request().url());
    if (sameTab) return route.fulfill({ status: 302, headers: { location: redirect } });
    return route.fulfill({ status: 204 });
  });
}
function watch(page, tag) {
  page.on("pageerror", (e) => failures.push(`[${tag} pageerror] ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) log(`[${tag} console.error] ${m.text().slice(0, 200)}`); });
}
async function connectFrom(page) {
  await page.getByRole("button", { name: /select wallet/i }).first().click();
  await page.getByRole("button", { name: /^Phantom/ }).first().click();
}

/* ------------------------------------------------------- 1. the iPhone path */
{
  log("1. iPhone Safari: connect, sign a message, sign a transaction — reply lands in another tab");
  const ctx = await phone();
  const phantom = new FakePhantom();
  await playPhantom(ctx, phantom);
  const A = await ctx.newPage();
  watch(A, "A");
  await A.goto(`${BASE}/requests`, { waitUntil: "networkidle" });
  assert.ok(await A.getByText("On an iPhone?").count(), "the phone hint shows in Safari");

  await connectFrom(A);
  await until(() => phantom.calls.length === 1, "the connect link");
  assert.equal(phantom.calls[0].method, "connect");
  assert.equal(A.url(), `${BASE}/requests`, "the asking tab stayed where it was");
  assert.ok(await A.getByText("Waiting for Phantom").isVisible(), "the waiting sheet is up");

  const B = await ctx.newPage();
  watch(B, "B");
  await B.goto(phantom.calls[0].redirect);
  await B.waitForURL(`${BASE}/requests`, { timeout: 15_000 });
  log("   return tab went back to /requests");
  await until(async () => (await A.getByText("Waiting for Phantom").count()) === 0, "the waiting sheet to close");
  await until(async () => (await A.getByRole("button", { name: phantom.short }).count()) > 0, "tab A to show the address");
  log(`   tab A connected as ${phantom.short}`);
  await until(async () => (await B.getByRole("button", { name: phantom.short }).count()) > 0, "tab B to auto-connect from the shared session");
  log("   tab B auto-connected from the same session");
  await B.close();

  // A signed API request: post a build request from tab A.
  const posted = [];
  A.on("response", (r) => { if (r.url().endsWith("/api/requests") && r.request().method() === "POST") posted.push(r.status()); });
  await A.getByRole("button", { name: "Post what you need" }).first().click();
  await A.getByPlaceholder(/Telegram bot/).fill("Deep-link test request");
  await A.getByPlaceholder(/What it should do/).fill("A request posted from an iPhone through the Phantom deep-link flow, to prove the signature round trip works end to end.");
  await A.getByPlaceholder("5").fill("1");
  await A.getByRole("button", { name: "Post it" }).click();
  await until(() => phantom.calls.length === 2, "the signMessage link");
  assert.equal(phantom.calls[1].method, "signMessage");
  assert.match(phantom.calls[1].message, /^Takeover\naction: request\n/, "Phantom was asked to sign the site's auth message");
  const C = await ctx.newPage();
  watch(C, "C");
  await C.goto(phantom.calls[1].redirect);
  await C.getByText("Now switch back to the tab you came from.").waitFor({ timeout: 10_000 }).catch(async () => {
    throw new Error(`the return tab did not say to switch back; it shows:\n${(await C.innerText("body")).slice(0, 600)}`);
  });
  await until(() => posted.length > 0, "tab A to post the request with Phantom's signature");
  assert.equal(posted[0], 201, `the API accepted the signature (got ${posted[0]})`);
  await A.waitForURL(/\/requests\/[^/]+$/, { timeout: 15_000 });
  log(`   tab A posted the request and moved to ${new URL(A.url()).pathname}`);
  await until(async () => (await C.getByText("That tab has picked it up").count()) > 0, "the return tab to notice the pickup");
  log("   return tab shows the pickup");
  await C.close();

  // A transaction, through the wallet object the adapter uses.
  const tx = new Transaction({ feePayer: phantom.wallet.publicKey, recentBlockhash: bs58.encode(nacl.randomBytes(32)) })
    .add(SystemProgram.transfer({ fromPubkey: phantom.wallet.publicKey, toPubkey: phantom.wallet.publicKey, lamports: 1 }));
  const unsigned = Array.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
  const signedP = A.evaluate(async (bytes) => {
    const wallets = [];
    window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: { register: (...ws) => wallets.push(...ws) } }));
    const w = wallets.find((x) => x.name === "Phantom");
    if (!w) throw new Error("no Phantom wallet registered");
    const [out] = await w.features["solana:signTransaction"].signTransaction({ transaction: new Uint8Array(bytes), account: w.accounts[0] });
    return Array.from(out.signedTransaction);
  }, unsigned);
  await until(() => phantom.calls.length === 3, "the signTransaction link");
  assert.equal(phantom.calls[2].method, "signTransaction");
  const D = await ctx.newPage();
  await D.goto(phantom.calls[2].redirect);
  const signed = Transaction.from(Uint8Array.from(await signedP));
  assert.ok(signed.verifySignatures(), "the transaction came back fully signed by the wallet");
  log("   signed transaction verified");
  await D.close();

  // Two at once goes through signAllTransactions.
  const twoP = A.evaluate(async (bytes) => {
    const wallets = [];
    window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: { register: (...ws) => wallets.push(...ws) } }));
    const w = wallets.find((x) => x.name === "Phantom");
    const outs = await w.features["solana:signTransaction"].signTransaction({ transaction: new Uint8Array(bytes), account: w.accounts[0] }, { transaction: new Uint8Array(bytes), account: w.accounts[0] });
    return outs.map((o) => Array.from(o.signedTransaction));
  }, unsigned);
  await until(() => phantom.calls.length === 4, "the signAllTransactions link");
  assert.equal(phantom.calls[3].method, "signAllTransactions");
  const E = await ctx.newPage();
  await E.goto(phantom.calls[3].redirect);
  const two = await twoP;
  assert.equal(two.length, 2);
  assert.ok(two.every((b) => Transaction.from(Uint8Array.from(b)).verifySignatures()));
  log("   two transactions signed in one trip");
  await E.close();

  // Disconnect is local and immediate.
  await A.getByRole("button", { name: phantom.short }).click();
  await A.getByRole("menuitem", { name: /disconnect/i }).click();
  // The adapter keeps Phantom selected after a disconnect, so the button reads "Connect".
  await until(async () => (await A.getByRole("button", { name: /^(connect|select wallet)$/i }).count()) > 0, "disconnect");
  assert.equal(await A.evaluate(() => localStorage.getItem("takeover-phantom-session")), null, "session cleared");
  log("   disconnected");
  await ctx.close();
}

/* ------------------------------------------------------ 2. same-tab return */
{
  log("2. Browser that returns in the same tab: connect lands back where it started");
  const ctx = await phone();
  const phantom = new FakePhantom();
  await playPhantom(ctx, phantom, { sameTab: true });
  const A = await ctx.newPage();
  watch(A, "A2");
  await A.goto(`${BASE}/builders`, { waitUntil: "networkidle" });
  await connectFrom(A);
  await A.waitForURL(`${BASE}/builders`, { timeout: 20_000 });
  await until(async () => (await A.getByRole("button", { name: phantom.short }).count()) > 0, "same-tab connect");
  log(`   connected as ${phantom.short} after the round trip`);
  await ctx.close();
}

/* ------------------------------------------------------------ 3. rejection */
{
  log("3. Rejected in Phantom: the asking tab is told, nothing else changes");
  const ctx = await phone();
  const phantom = new FakePhantom();
  phantom.reject = true;
  await playPhantom(ctx, phantom);
  const A = await ctx.newPage();
  watch(A, "A3");
  await A.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await connectFrom(A);
  await until(() => phantom.calls.length === 1, "the connect link");
  const B = await ctx.newPage();
  await B.goto(phantom.calls[0].redirect);
  await B.getByText("You cancelled it in Phantom").waitFor({ timeout: 10_000 }).catch(async () => {
    throw new Error(`the return tab did not explain the rejection; it shows:\n${(await B.innerText("body")).slice(0, 600)}`);
  });
  await until(async () => (await A.getByText("Waiting for Phantom").count()) === 0, "the waiting sheet to close");
  // The adapter deselects the wallet on a failed connect, so the button returns to "Select Wallet".
  await until(async () => (await A.getByRole("button", { name: /^(connect|select wallet)$/i }).count()) > 0, "the wallet button to come back");
  assert.equal(await A.evaluate(() => localStorage.getItem("takeover-phantom-session")), null);
  log("   rejection handled");
  await ctx.close();
}

/* ------------------------------------------------- 4. where it is not offered */
{
  log("4. Not offered on a desktop, nor inside a home-screen app");
  const desk = await browser.newContext({ userAgent: DESKTOP, viewport: { width: 1280, height: 900 } });
  const P = await desk.newPage();
  await P.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await P.getByRole("button", { name: /select wallet/i }).first().click();
  await sleep(500);
  assert.equal(await P.getByRole("button", { name: /^Phantom/ }).count(), 0, "no deep-link Phantom on a desktop");
  assert.equal(await P.getByText("On an iPhone?").count(), 0);
  await desk.close();

  const app = await phone();
  await app.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); });
  const Q = await app.newPage();
  await Q.goto(`${BASE}/`, { waitUntil: "networkidle" });
  assert.ok(await Q.getByText("Wallets can't connect from a home-screen app on iPhone.").count(), "the home-screen banner explains");
  await Q.getByRole("button", { name: /select wallet/i }).first().click();
  await sleep(500);
  assert.equal(await Q.getByRole("button", { name: /^Phantom/ }).count(), 0, "no deep-link Phantom in the installed app");
  await app.close();
  log("   gated correctly");
}

await browser.close();
if (failures.length) {
  console.error("\npage errors:");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
log("all phone flows passed");
