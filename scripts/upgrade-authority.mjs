/**
 * Who can replace the escrow program, and handing that power away.
 *
 *   node scripts/upgrade-authority.mjs status
 *   node scripts/upgrade-authority.mjs transfer <SQUADS_VAULT_PUBKEY>   # to a multisig
 *   node scripts/upgrade-authority.mjs burn --yes                        # immutable, forever
 *
 * Signed by the current upgrade authority, read from PAYER or ~/.config/solana/id.json,
 * against RPC_URL (defaults to devnet). Every step prints what it is about to do and
 * refuses to send until `--yes` is passed, because the second command cannot be undone
 * and the first, sent to a mistyped address, freezes the program just as permanently.
 *
 * This is `solana program set-upgrade-authority` without needing the CLI installed. The
 * loader's SetAuthority instruction is the u32 4, with the ProgramData account, the
 * current authority as signer, and optionally the new authority. Leaving the new
 * authority out is what makes a program immutable.
 *
 * The upgrade authority is the one power in this project bounded by nothing but who
 * holds it: a new deployment could reassign every escrowed authority and drain every
 * escrowed lamport. KEYS.md says why the answer is a Squads multisig now and `--final`
 * after the audit, and the preflight fails a mainnet deploy that has done neither.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction, TransactionInstruction } from "@solana/web3.js";

const BPF_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const SQUADS_V4 = new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");
const SYSTEM = new PublicKey("11111111111111111111111111111111");

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const idl = JSON.parse(fs.readFileSync("src/idl/takeover_escrow.json", "utf8"));
const PID = new PublicKey(idl.address);
const [programData] = PublicKey.findProgramAddressSync([PID.toBuffer()], BPF_LOADER);

const argv = process.argv.slice(2);
const cmd = argv[0];
const yes = argv.includes("--yes");
const keyPath = process.env.PAYER ?? path.join(os.homedir(), ".config/solana/id.json");

async function current() {
  const info = await conn.getAccountInfo(programData);
  if (!info || info.data.length < 45) throw new Error(`no ProgramData for ${PID.toBase58()} on ${RPC}`);
  if (info.data[12] !== 1) return null;
  return new PublicKey(info.data.subarray(13, 45));
}

async function custodyOf(pubkey) {
  const info = await conn.getAccountInfo(pubkey).catch(() => null);
  if (!info || info.owner.equals(SYSTEM)) return "a single wallet";
  if (info.owner.equals(SQUADS_V4)) return "a Squads multisig";
  return `an account owned by ${info.owner.toBase58()}`;
}

/** BPF upgradeable loader `SetAuthority`: u32 LE instruction index 4. */
function setAuthorityIx(currentAuthority, newAuthority) {
  const keys = [
    { pubkey: programData, isSigner: false, isWritable: true },
    { pubkey: currentAuthority, isSigner: true, isWritable: false },
  ];
  if (newAuthority) keys.push({ pubkey: newAuthority, isSigner: false, isWritable: false });
  const data = Buffer.alloc(4);
  data.writeUInt32LE(4);
  return new TransactionInstruction({ programId: BPF_LOADER, keys, data });
}

async function status() {
  const auth = await current();
  console.log(`program   ${PID.toBase58()}`);
  console.log(`rpc       ${RPC.replace(/\?api-key=.*/, "?api-key=***")}`);
  if (!auth) { console.log("upgrade   IMMUTABLE — nobody can replace this program"); return; }
  console.log(`upgrade   ${auth.toBase58()} (${await custodyOf(auth)})`);
}

async function change(newAuthority) {
  const auth = await current();
  if (!auth) throw new Error("the program is already immutable");
  const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))));
  if (!signer.publicKey.equals(auth)) throw new Error(`the upgrade authority is ${auth.toBase58()}, but ${keyPath} is ${signer.publicKey.toBase58()}`);

  if (newAuthority) {
    const custody = await custodyOf(newAuthority);
    console.log(`about to hand the upgrade authority of ${PID.toBase58()}`);
    console.log(`  from ${auth.toBase58()}`);
    console.log(`  to   ${newAuthority.toBase58()} (${custody})`);
    if (custody !== "a Squads multisig") {
      console.log("  ! that address is not a Squads multisig. If it is a wallet, this only moves the problem;");
      console.log("    if it is a typo, the program can never be upgraded again and nobody can fix that.");
    }
  } else {
    console.log(`about to make ${PID.toBase58()} IMMUTABLE. This cannot be undone. A bug found afterwards`);
    console.log("can only be fixed by deploying a new program and migrating every listing to it.");
  }
  if (!yes) { console.log("\nre-run with --yes to send."); return; }

  const tx = new Transaction().add(setAuthorityIx(auth, newAuthority));
  const sig = await sendAndConfirmTransaction(conn, tx, [signer], { commitment: "confirmed" });
  console.log(`sent ${sig}`);
  await status();
}

try {
  if (cmd === "status") await status();
  else if (cmd === "transfer") {
    const to = argv[1];
    if (!to || to.startsWith("--")) throw new Error("usage: transfer <NEW_AUTHORITY_PUBKEY> [--yes]");
    await change(new PublicKey(to));
  } else if (cmd === "burn") await change(null);
  else {
    console.log("usage: node scripts/upgrade-authority.mjs status | transfer <PUBKEY> [--yes] | burn [--yes]");
    process.exit(2);
  }
} catch (e) {
  console.error(`error: ${e.message ?? e}`);
  process.exit(1);
}
