/**
 * Give the program a fresh address, in every place that has to agree.
 *
 *   node scripts/new-program-id.mjs                 # show what would change
 *   node scripts/new-program-id.mjs --yes           # generate and write
 *   node scripts/new-program-id.mjs --keypair <PATH> --yes   # use a keypair you already have
 *
 * The program's address is not a deployment detail. Anchor bakes it into the binary with
 * `declare_id!` and refuses to run if the address it is deployed at does not match, so a
 * binary built for one address cannot simply be deployed to another. The same address
 * also appears in the IDL the website builds transactions from and in Anchor.toml. Miss
 * one and the failure is a site that builds transactions the program rejects — the exact
 * class of bug that cost this project an afternoon once before, and which it now has a
 * preflight to catch.
 *
 * So this writes all three together, from one keypair, and prints the address that must
 * then be used everywhere else.
 *
 * You need this when the original program keypair is gone. It is not recoverable: the
 * address IS the public key, and without the private half nobody can ever deploy to or
 * upgrade that address again. Back up what this generates, in more than one place.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { Keypair, PublicKey } from "@solana/web3.js";

const argv = process.argv.slice(2);
const yes = argv.includes("--yes");
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };

const SOURCE = "programs/takeover-escrow/src/lib.rs";
const IDL = "src/idl/takeover_escrow.json";
const ANCHOR = "Anchor.toml";
const KEYPAIR_OUT = "target/deploy/takeover_escrow-keypair.json";

const current = JSON.parse(fs.readFileSync(IDL, "utf8")).address;

let keypair;
const given = flag("keypair");
if (given) {
  keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(given, "utf8"))));
  console.log(`using the keypair at ${given}`);
} else if (fs.existsSync(KEYPAIR_OUT)) {
  keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_OUT, "utf8"))));
  console.log(`using the existing keypair at ${KEYPAIR_OUT}`);
} else {
  keypair = Keypair.generate();
  console.log("generating a new program keypair");
}
const next = keypair.publicKey.toBase58();

console.log(`\n  from ${current}`);
console.log(`  to   ${next}\n`);
if (current === next) { console.log("Already this address; nothing to change."); process.exit(0); }

const edits = [
  [SOURCE, (s) => s.replace(/declare_id!\("[^"]+"\)/, `declare_id!("${next}")`)],
  [IDL, (s) => { const j = JSON.parse(s); j.address = next; return JSON.stringify(j, null, 2) + "\n"; }],
  [ANCHOR, (s) => s.replace(/takeover_escrow = "[^"]+"/, `takeover_escrow = "${next}"`)],
];

for (const [file, fn] of edits) {
  const before = fs.readFileSync(file, "utf8");
  const after = fn(before);
  if (before === after) { console.error(`error: nothing to replace in ${file} — check it by hand`); process.exit(1); }
  console.log(`  would rewrite ${file}`);
  if (yes) fs.writeFileSync(file, after);
}

if (!yes) { console.log("\nre-run with --yes to write these, and to save the keypair."); process.exit(0); }

fs.mkdirSync("target/deploy", { recursive: true });
if (!given && !fs.existsSync(KEYPAIR_OUT)) {
  fs.writeFileSync(KEYPAIR_OUT, JSON.stringify([...keypair.secretKey]));
  fs.chmodSync(KEYPAIR_OUT, 0o600);
  console.log(`\nwrote ${KEYPAIR_OUT} (mode 600)`);
}

// A binary built for the old address is now a liability: deploying it would be rejected
// by its own declare_id! check, after paying the rent.
if (fs.existsSync("target/deploy/takeover_escrow.so")) {
  fs.rmSync("target/deploy/takeover_escrow.so");
  console.log("removed the stale binary built for the old address — rebuild before deploying");
}

void PublicKey; void execFileSync;
console.log(`
Program address is now ${next}

  1. BACK UP ${KEYPAIR_OUT}. Losing it means this address can never be
     upgraded by anyone, ever. Put a copy somewhere that is not this laptop.
  2. npm run program:build        # rebuild, so the binary carries the new declare_id!
  3. npm run program:test         # 46 tests, against the rebuilt binary
  4. Deploy, then run scripts/init-program.mjs and the authority handover.

The website reads the address from ${IDL}, so commit that change too or the
deployed site will keep talking to the old program.`);
