/**
 * Upload a built program to a buffer the Squads multisig can upgrade from.
 *
 *   node scripts/write-buffer.mjs target/deploy/takeover_escrow.so --vault <SQUADS_VAULT> --dry-run
 *   node scripts/write-buffer.mjs target/deploy/takeover_escrow.so --vault <SQUADS_VAULT> --yes
 *
 * Paid for and signed by PAYER (a keypair file; defaults to ~/.config/solana/id.json),
 * against RPC_URL (defaults to mainnet's public endpoint, which is fine from a machine
 * but slow; a provider URL is better). Nothing here needs the Solana CLI.
 *
 * An upgrade through Squads has two halves. The multisig can only point the program at
 * bytes that are already on chain, in a buffer account whose authority is the vault —
 * and getting 450 KB into a buffer is several hundred transactions, which is what the
 * CLI's `program write-buffer` does and what this does without it. The second half, the
 * upgrade itself, is proposed and approved in the Squads app; this script ends by
 * printing exactly what to enter there.
 *
 * Every write is idempotent — a chunk written twice lands in the same place — so a run
 * that dies halfway can be re-run with `--buffer <file>` and picks up the same account.
 * The buffer's own keypair is saved beside the data so that is always possible. When
 * every byte is up, the account is read back and compared to the file before the
 * authority is handed over, because a buffer that differs from the build by one byte is
 * a program nobody reviewed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { BPF_LOADER, BUFFER_HEADER, initializeBufferIx, setAuthorityIx, writeIx } from "./loader-ix.mjs";

/** Bytes per Write. A transaction is 1232 bytes; this leaves room for the envelope. */
const CHUNK = 900;
/** Writes in flight at once. The public endpoint tolerates this; a provider will take more. */
const PARALLEL = 8;

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const flag = (name) => argv.includes(`--${name}`);
const soPath = argv.find((a) => !a.startsWith("--") && a.endsWith(".so"));
const die = (m) => { console.error(`error: ${m}`); process.exit(1); };

if (!soPath) die("usage: node scripts/write-buffer.mjs <program.so> --vault <SQUADS_VAULT> [--rpc URL] [--keypair FILE] [--buffer FILE] [--dry-run] [--yes]");
if (!fs.existsSync(soPath)) die(`no such file: ${soPath}`);
const vaultRaw = arg("vault");
if (!vaultRaw) die("--vault <SQUADS_VAULT> is required: the buffer's authority is handed to it at the end");
let vault;
try { vault = new PublicKey(vaultRaw); } catch { die(`--vault is not a public key: ${vaultRaw}`); }

const RPC = arg("rpc") ?? process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const conn = new Connection(RPC, "confirmed");
const keyPath = arg("keypair") ?? process.env.PAYER ?? path.join(os.homedir(), ".config/solana/id.json");

const program = fs.readFileSync(soPath);
const sha = crypto.createHash("sha256").update(program).digest("hex");
const space = BUFFER_HEADER + program.length;
const chunks = Math.ceil(program.length / CHUNK);

/* ------------------------------------------------------------------ sending */

/** Confirm by asking, not subscribing: works through any HTTP endpoint, proxy included. */
async function confirm(sig, lastValidBlockHeight) {
  for (;;) {
    const { value: [s] } = await conn.getSignatureStatuses([sig]);
    if (s?.err) throw new Error(`transaction ${sig} failed: ${JSON.stringify(s.err)}`);
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return;
    if ((await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) throw new Error(`transaction ${sig} expired before it confirmed`);
    await new Promise((r) => setTimeout(r, 800));
  }
}

async function send(ixs, signers, label) {
  for (let attempt = 1; ; attempt++) {
    try {
      const latest = await conn.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: signers[0].publicKey, ...latest }).add(...ixs);
      tx.sign(...signers);
      const sig = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed", maxRetries: 3 });
      await confirm(sig, latest.lastValidBlockHeight);
      return sig;
    } catch (e) {
      // Expiry and rate limiting are the two failures that resolve themselves; a program
      // error does not, and a third strike on anything is worth a human looking.
      if (attempt >= 3 || /failed:/.test(e.message)) throw new Error(`${label}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

/* --------------------------------------------------------------------- run */

const rent = await conn.getMinimumBalanceForRentExemption(space);
// Roughly: one signature per write plus the two bookend transactions, at the base fee.
const fees = (chunks + 2) * 5000;
const network = RPC.includes("devnet") ? "devnet" : RPC.includes("testnet") ? "testnet" : "mainnet (or a mainnet provider)";

console.log(`program   ${soPath}`);
console.log(`bytes     ${program.length.toLocaleString()}  sha256 ${sha}`);
console.log(`buffer    ${space.toLocaleString()} bytes on chain, ${chunks} writes of ${CHUNK} bytes`);
console.log(`rent      ${(rent / LAMPORTS_PER_SOL).toFixed(4)} SOL (returned to the vault's spill account when the upgrade executes)`);
console.log(`fees      ~${(fees / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
console.log(`vault     ${vault.toBase58()}  (becomes the buffer's authority)`);
console.log(`network   ${network} via ${RPC.replace(/\?api-key=.*/, "?api-key=***")}`);

if (flag("dry-run")) { console.log("\n--dry-run: nothing sent"); process.exit(0); }
if (!flag("yes")) { console.log("\nre-run with --yes to send."); process.exit(0); }

if (!fs.existsSync(keyPath)) die(`no keypair at ${keyPath} — set PAYER or --keypair to a funded key`);
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))));
const balance = await conn.getBalance(payer.publicKey);
console.log(`payer     ${payer.publicKey.toBase58()}  ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
if (balance < rent + fees) die(`the payer needs about ${((rent + fees) / LAMPORTS_PER_SOL).toFixed(3)} SOL and has ${(balance / LAMPORTS_PER_SOL).toFixed(3)}`);

// The buffer's keypair is saved first, so nothing that goes wrong later can strand a
// funded account nobody can address.
let bufferKp;
const resumeFile = arg("buffer");
if (resumeFile) {
  bufferKp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(resumeFile, "utf8"))));
  console.log(`resuming  ${bufferKp.publicKey.toBase58()} from ${resumeFile}`);
} else {
  bufferKp = Keypair.generate();
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  const saved = path.join(dir, `buffer-${bufferKp.publicKey.toBase58()}.json`);
  fs.writeFileSync(saved, JSON.stringify([...bufferKp.secretKey]), { mode: 0o600 });
  console.log(`buffer    ${bufferKp.publicKey.toBase58()}  (keypair saved to ${saved}; re-run with --buffer ${saved} to resume)`);
}
const buffer = bufferKp.publicKey;

const existing = await conn.getAccountInfo(buffer);
if (!existing) {
  console.log("\n==> creating and initialising the buffer");
  await send([
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: buffer, lamports: rent, space, programId: BPF_LOADER }),
    initializeBufferIx(buffer, payer.publicKey),
  ], [payer, bufferKp], "create buffer");
} else if (!existing.owner.equals(BPF_LOADER)) {
  die(`${buffer.toBase58()} exists and is not a loader buffer`);
} else {
  console.log("\n==> buffer already exists; writing over it");
}

console.log(`==> writing ${chunks} chunks, ${PARALLEL} at a time`);
let done = 0;
const offsets = Array.from({ length: chunks }, (_, i) => i * CHUNK);
for (let i = 0; i < offsets.length; i += PARALLEL) {
  await Promise.all(offsets.slice(i, i + PARALLEL).map(async (offset) => {
    const bytes = program.subarray(offset, offset + CHUNK);
    await send([writeIx(buffer, payer.publicKey, offset, bytes)], [payer], `write @${offset}`);
    done++;
  }));
  process.stdout.write(`\r    ${done}/${chunks}`);
}
console.log();

console.log("==> reading the buffer back");
const after = await conn.getAccountInfo(buffer);
const onchain = after.data.subarray(BUFFER_HEADER, BUFFER_HEADER + program.length);
const back = crypto.createHash("sha256").update(onchain).digest("hex");
if (back !== sha) die(`the buffer does not match the file (${back.slice(0, 12)}… vs ${sha.slice(0, 12)}…). Re-run with --buffer to rewrite it; do not upgrade from it.`);
console.log(`    matches the file: sha256 ${sha}`);

console.log(`==> handing the buffer's authority to the vault ${vault.toBase58()}`);
await send([setAuthorityIx(buffer, payer.publicKey, vault)], [payer], "set buffer authority");

console.log(`
done. In the Squads app, as any member:

  Developers → Programs → Upgrade
    program   EFtuX87WAqxfg3LkJE2rW79NC8Yka7RarJiSUGeSNPvu
    buffer    ${buffer.toBase58()}
    spill     any wallet (the buffer's rent is refunded there)

then 2 of 4 approve, the time lock runs, and execute. Until it executes the program on
chain is unchanged and every pump.fun listing still fails at "AccountOwnedByWrongProgram".
`);
