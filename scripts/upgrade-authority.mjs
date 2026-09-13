/**
 * Who can replace the escrow program, and handing that power away.
 *
 *   node scripts/upgrade-authority.mjs status
 *   node scripts/upgrade-authority.mjs transfer <VAULT> --multisig <MULTISIG> --yes
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
 * A Squads vault is only signable on the network where its multisig account lives. A
 * vault created in the Squads app on mainnet does not exist on devnet, and handing a
 * devnet program to it would leave nobody able to sign for it ever again — the same
 * permanent loss as a typo, reached by a plausible mistake. So a transfer to any address
 * off the ed25519 curve is refused unless --multisig names a Squads multisig that exists
 * on the network being written to and whose vault the destination actually is.
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
const flag = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const MULTISIG = (() => { try { const v = flag("multisig") ?? process.env.SQUADS_MULTISIG; return v ? new PublicKey(v) : null; } catch { return null; } })();
const vaultOf = (ms, i) => PublicKey.findProgramAddressSync(
  [Buffer.from("multisig"), ms.toBuffer(), Buffer.from("vault"), Buffer.from([i])], SQUADS_V4)[0];

async function current() {
  const info = await conn.getAccountInfo(programData);
  if (!info || info.data.length < 45) throw new Error(`no ProgramData for ${PID.toBase58()} on ${RPC}`);
  if (info.data[12] !== 1) return null;
  return new PublicKey(info.data.subarray(13, 45));
}

async function custodyOf(pubkey) {
  const info = await conn.getAccountInfo(pubkey).catch(() => null);
  if (info?.owner.equals(SQUADS_V4)) return "a Squads multisig account, not a vault";
  // On the curve means a keypair exists for it, whoever holds it. That is a wallet, and
  // no amount of multisig context changes it.
  if (PublicKey.isOnCurve(pubkey.toBytes())) return "a single wallet";
  if (MULTISIG && isVaultOf(pubkey, MULTISIG) !== null) return "a Squads multisig vault";
  return "a program-derived address";
}

/** Which vault index of `ms` this is, or null. */
function isVaultOf(target, ms) {
  for (let i = 0; i < 8; i++) if (vaultOf(ms, i).equals(target)) return i;
  return null;
}

/**
 * Can anything on THIS network actually sign for `target`?
 *
 * An ordinary wallet always can: somebody holds its private key. A program-derived
 * address can only be signed for by its owning program, which needs its own state on
 * this network — so a mainnet Squads vault is inert on devnet, and handing a program to
 * one there is indistinguishable from destroying its upgradeability.
 */
async function verifyVault(target) {
  if (PublicKey.isOnCurve(target.toBytes())) return { ok: true, why: "an ordinary wallet: its private key exists" };
  if (!MULTISIG) return { ok: false, why: "it is a program-derived address and no --multisig was given, so this cannot be checked" };
  const ms = await conn.getAccountInfo(MULTISIG).catch(() => null);
  if (!ms) return { ok: false, why: `multisig ${MULTISIG.toBase58()} does not exist on this network — a vault of it cannot sign here` };
  if (!ms.owner.equals(SQUADS_V4)) return { ok: false, why: `${MULTISIG.toBase58()} exists but is not a Squads multisig (owner ${ms.owner.toBase58()})` };
  const i = isVaultOf(target, MULTISIG);
  if (i === null) return { ok: false, why: `not a vault (0-7) of multisig ${MULTISIG.toBase58()}` };
  const b = ms.data;
  let o = 8 + 32 + 32;
  const threshold = b.readUInt16LE(o); o += 2;
  const timeLock = b.readUInt32LE(o); o += 4;
  o += 16; o += b[o] === 1 ? 33 : 1; o += 1;
  const members = b.readUInt32LE(o);
  const shape = `${threshold}-of-${members}${timeLock ? `, ${Math.round(timeLock / 3600)}h time lock` : ", no time lock"}`;
  return {
    ok: true,
    weak: threshold < 2,
    why: `vault ${i} of Squads multisig ${MULTISIG.toBase58()} (${shape}), which exists on this network`,
  };
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

  if (newAuthority) {
    const custody = await custodyOf(newAuthority);
    const check = await verifyVault(newAuthority);
    console.log(`about to hand the upgrade authority of ${PID.toBase58()}`);
    console.log(`  from    ${auth.toBase58()}`);
    console.log(`  to      ${newAuthority.toBase58()} (${custody})`);
    console.log(`  network ${RPC.replace(/\?api-key=.*/, "?api-key=***")}`);
    console.log(`  signable here: ${check.ok ? "yes" : "NO"} — ${check.why}`);
    if (!check.ok) {
      console.error("\nrefusing: nothing on this network could sign for that address, so this would");
      console.error("destroy the program's upgradeability as surely as a typo would. Pass --multisig");
      console.error("<MULTISIG> to prove the destination is its vault, or create the multisig on this");
      console.error("network first. --force overrides, and you should not need it.");
      if (!argv.includes("--force")) process.exit(1);
      console.error("\n--force given; continuing anyway.");
    }
    if (custody === "a single wallet") {
      console.log("  ! that is an ordinary wallet, so this only moves the problem to another key.");
    }
    if (check.weak) {
      console.log("\n  ! that multisig needs only one approval, so one key still proposes, approves and");
      console.log("    executes alone. Moving the upgrade authority there changes the diagram, not the");
      console.log("    trust: the site would still be trusting a single key. Raise the threshold to at");
      console.log("    least 2 of 3 in the Squads app first, and add a time lock while you are there.");
      if (!argv.includes("--force")) { console.error("\nrefusing. --force overrides."); process.exit(1); }
      console.error("  --force given; continuing anyway.");
    }
  } else {
    console.log(`about to make ${PID.toBase58()} IMMUTABLE. This cannot be undone. A bug found afterwards`);
    console.log("can only be fixed by deploying a new program and migrating every listing to it.");
  }
  if (!yes) { console.log("\nre-run with --yes to send."); return; }

  // The key is only needed to actually send. Checking a destination should never
  // require one, so that a dry run works from any machine.
  if (!fs.existsSync(keyPath)) throw new Error(`no keypair at ${keyPath} — set PAYER to the upgrade authority's key file`);
  const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))));
  if (!signer.publicKey.equals(auth)) throw new Error(`the upgrade authority is ${auth.toBase58()}, but ${keyPath} is ${signer.publicKey.toBase58()}`);

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
