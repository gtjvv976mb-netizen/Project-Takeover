/**
 * Is a Squads multisig actually fit to hold this program's powers?
 *
 *   node scripts/squads.mjs <MULTISIG_OR_VAULT_ADDRESS>
 *   RPC_URL=https://api.mainnet-beta.solana.com node scripts/squads.mjs <ADDRESS>
 *
 * Accepts either the multisig or one of its vaults, because the Squads app puts the
 * VAULT in its URL and the multisig address has to be read off the page — a confusion
 * that costs an afternoon the first time. Given a vault, the multisig it belongs to is
 * found by scanning Squads' accounts, which takes a few seconds.
 *
 * The question this answers is not "is it a multisig" but "does being in it mean
 * anything". A threshold of 1 does not: one key still proposes, approves and executes
 * alone, and with four members that is four single points of failure rather than one.
 * The preflight and the transfer script apply the same rule, so a squad that passes
 * here is a squad they will accept.
 */
import crypto from "node:crypto";
import bs58 from "bs58";
import { Connection, PublicKey } from "@solana/web3.js";

// Self-contained, like every other script here, so `node scripts/squads.mjs` works with
// no build step and no tsx. The same two readers exist in src/lib/solana-shared.ts for
// the site, and tests/pump.test.ts pins that copy against Squads' published layout.
const SQUADS_V4_PROGRAM_ID = new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");

/** Seeds ["multisig", multisig, "vault", index], per the Squads SDK. */
const squadsVaultPda = (multisig, index = 0) => PublicKey.findProgramAddressSync(
  [Buffer.from("multisig"), multisig.toBuffer(), Buffer.from("vault"), Buffer.from([index])],
  SQUADS_V4_PROGRAM_ID,
)[0];

/**
 * Multisig layout after the 8-byte discriminator: create_key, config_authority,
 * threshold u16, time_lock u32, transaction_index u64, stale_transaction_index u64,
 * Option<rent_collector>, bump u8, then a Borsh vec of {key, permissions u8}.
 */
function parseSquadsMultisig(data) {
  const b = Buffer.from(data);
  const disc = crypto.createHash("sha256").update("account:Multisig").digest().subarray(0, 8);
  if (b.length < 60 || !b.subarray(0, 8).equals(disc)) return null;
  let o = 8 + 32 + 32;
  const threshold = b.readUInt16LE(o); o += 2;
  const timeLock = b.readUInt32LE(o); o += 4;
  o += 16;
  o += b[o] === 1 ? 33 : 1;
  o += 1;
  if (o + 4 > b.length) return null;
  const memberCount = b.readUInt32LE(o); o += 4;
  const members = [];
  for (let i = 0; i < memberCount && o + 33 <= b.length; i++) {
    members.push(new PublicKey(b.subarray(o, o + 32)).toBase58());
    o += 33;
  }
  return { threshold, memberCount, timeLock, members };
}

const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const conn = new Connection(RPC, "confirmed");
const arg = process.argv[2];
if (!arg) { console.error("usage: node scripts/squads.mjs <MULTISIG_OR_VAULT_ADDRESS>"); process.exit(2); }

const target = new PublicKey(arg);
const pass = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); return 1; };
const warn = (m) => { console.log(`  \x1b[33m!\x1b[0m ${m}`); return 0; };

const info = await conn.getAccountInfo(target);
if (!info) { console.error(`error: ${target.toBase58()} does not exist on ${RPC}`); process.exit(1); }

let multisig = null;
if (info.owner.equals(SQUADS_V4_PROGRAM_ID)) {
  multisig = target;
} else {
  process.stderr.write("searching for the multisig this vault belongs to... ");
  const disc = crypto.createHash("sha256").update("account:Multisig").digest().subarray(0, 8);
  // Scanning every squad takes a few seconds. Worth it: the alternative is asking
  // someone to find an address the app never shows them.
  const all = await conn.getProgramAccounts(SQUADS_V4_PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(disc) } }],
    dataSlice: { offset: 0, length: 0 },
  });
  process.stderr.write(`${all.length} squads\n`);
  outer: for (const { pubkey } of all) {
    for (let i = 0; i < 8; i++) if (squadsVaultPda(pubkey, i).equals(target)) { multisig = pubkey; break outer; }
  }
  if (!multisig) { console.error(`error: ${target.toBase58()} is not a vault of any Squads multisig here`); process.exit(1); }
}

const ms = parseSquadsMultisig((await conn.getAccountInfo(multisig)).data);
if (!ms) { console.error("error: could not parse that multisig"); process.exit(1); }

console.log(`\nmultisig  ${multisig.toBase58()}`);
console.log(`vault 0   ${squadsVaultPda(multisig, 0).toBase58()}   <- the address that receives the powers`);
console.log(`network   ${RPC.replace(/\?api-key=.*/, "?api-key=***")}\n`);

let bad = 0;
const distinct = new Set(ms.members).size;
bad += ms.threshold >= 2
  ? (pass(`threshold ${ms.threshold} of ${ms.memberCount} — no single key can act alone`), 0)
  : fail(`threshold ${ms.threshold} of ${ms.memberCount} — ANY ONE of those ${ms.memberCount} keys can approve and execute alone, so this is ${ms.memberCount} single points of failure, not custody`);
bad += distinct === ms.memberCount
  ? (pass(`${distinct} distinct member keys`), 0)
  : fail(`only ${distinct} distinct keys among ${ms.memberCount} members`);
bad += ms.timeLock >= 3600
  ? (pass(`time lock ${(ms.timeLock / 3600).toFixed(1)}h — an approved change can be seen coming`), 0)
  : warn(`no time lock — an approved upgrade lands at once, with no warning to anyone holding a deal`);
ms.members.forEach((m, i) => console.log(`    member ${i}  ${m}`));

console.log();
if (bad) { console.log(`\x1b[31mNot fit to hold the upgrade authority yet.\x1b[0m Raise the threshold in the Squads app: Settings -> Change threshold.`); process.exit(1); }
console.log(`\x1b[32mFit to hold the upgrade authority.\x1b[0m Transfer to vault 0 above.`);
