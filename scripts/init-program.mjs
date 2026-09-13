/**
 * Setup and later adjustment of the escrow program's config account: the fee, the
 * treasury that receives it, and the arbitrator allowed to decide disputes.
 *
 * Usage: node scripts/init-program.mjs [--fee-bps 200] [--arbitrator <pubkey>]
 *          [--treasury <pubkey>] [--keypair <path>] [--dry-run] [--yes]
 *
 * The on-chain instruction writes all three fields at once, so an omitted flag is not
 * "leave it alone" as far as the program is concerned — this script has to supply a
 * value. On a config that already exists it supplies the value already on chain, so
 * changing the fee cannot silently move the arbitrator or the treasury. Changing either
 * of those two on an existing config is a deliberate act and needs --yes.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @coral-xyz/anchor is CommonJS; named ESM imports off it fail on current Node.
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const { AnchorProvider, Program, Wallet } = anchor;

const MAX_FEE_BPS = 500; // mirrors the program's own ceiling

// src/idl is the committed one the site itself loads and `new-program-id.mjs` rotates.
// target/idl is a build artifact that survives a program-id change, so a stale copy of
// it would point this script at a program nobody is using any more.
const idl = JSON.parse(fs.readFileSync("src/idl/takeover_escrow.json", "utf8"));
const builtPath = "target/idl/takeover_escrow.json";
if (fs.existsSync(builtPath)) {
  const built = JSON.parse(fs.readFileSync(builtPath, "utf8")).address;
  if (built !== idl.address) {
    console.warn(`note: ${builtPath} is a stale build at ${built}; using ${idl.address}`);
  }
}
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const die = (msg) => { console.error(msg); process.exit(1); };

const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const keyPath = arg("keypair", path.join(os.homedir(), ".config/solana/id.json"));
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))));

const connection = new Connection(rpc, "confirmed");
const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
const program = new Program(idl, provider);

const config = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];
const existing = await connection.getAccountInfo(config);
const current = existing ? await program.account.config.fetch(config) : null;

// Defaults: whatever is already on chain, or the payer when there is nothing yet.
const fallbackKey = current ? null : payer.publicKey.toBase58();
const feeBps = Number(arg("fee-bps", current ? current.feeBps : 200));
const arbitrator = new PublicKey(arg("arbitrator", current ? current.arbitrator.toBase58() : fallbackKey));
const treasury = new PublicKey(arg("treasury", current ? current.treasury.toBase58() : fallbackKey));

if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > MAX_FEE_BPS) {
  die(`--fee-bps must be a whole number between 0 and ${MAX_FEE_BPS} (${MAX_FEE_BPS / 100}%); got ${arg("fee-bps")}`);
}

const dryRun = process.argv.includes("--dry-run");

if (current) {
  const changes = [
    ["fee_bps", current.feeBps, feeBps],
    ["arbitrator", current.arbitrator.toBase58(), arbitrator.toBase58()],
    ["treasury", current.treasury.toBase58(), treasury.toBase58()],
  ].filter(([, was, now]) => String(was) !== String(now));

  if (!changes.length) {
    console.log(`config ${config.toBase58()} already matches — nothing to do`);
    process.exit(0);
  }
  console.log(`config ${config.toBase58()} — ${dryRun ? "would update" : "updating"}:`);
  for (const [field, was, now] of changes) console.log(`  ${field}: ${was} -> ${now}`);

  // Check what was asked for before checking who is asking: "this moves your treasury"
  // is the more alarming of the two, and worth seeing even on a run that cannot sign.
  const roleChange = changes.some(([field]) => field !== "fee_bps");
  if (roleChange && !process.argv.includes("--yes")) {
    die("\nThis moves the arbitrator or the treasury, not just the fee. Re-run with --yes\n"
      + "if that is what you meant.");
  }

  const held = current.authority.toBase58();
  if (held !== payer.publicKey.toBase58()) {
    die(`\nThe config authority is ${held}, not ${payer.publicKey.toBase58()}.\n`
      + "This script signs with a single keypair, so it cannot make this change. If the\n"
      + "authority is a multisig, propose the update_config instruction there instead.");
  }
  if (dryRun) { console.log("\n--dry-run: nothing sent"); process.exit(0); }
  await program.methods.updateConfig(feeBps, arbitrator, treasury)
    .accountsPartial({ config, authority: payer.publicKey }).rpc();
} else {
  console.log(`config ${config.toBase58()} does not exist — ${dryRun ? "would initialize" : "initializing"} with:`);
  console.log(`  fee_bps: ${feeBps}\n  arbitrator: ${arbitrator.toBase58()}\n  treasury: ${treasury.toBase58()}`);
  if (dryRun) { console.log("\n--dry-run: nothing sent"); process.exit(0); }
  await program.methods.initialize(feeBps, arbitrator, treasury)
    .accountsPartial({ config, authority: payer.publicKey, systemProgram: SystemProgram.programId }).rpc();
}

const c = await program.account.config.fetch(config);
console.log(JSON.stringify({
  rpc, programId: program.programId.toBase58(), config: config.toBase58(),
  authority: c.authority.toBase58(),
  feeBps: c.feeBps, arbitrator: c.arbitrator.toBase58(), treasury: c.treasury.toBase58(),
}, null, 2));
