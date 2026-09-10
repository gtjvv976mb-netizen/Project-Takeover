/**
 * Hand the config authority over, in two steps.
 *
 *   node scripts/authority.mjs status
 *   node scripts/authority.mjs nominate <PUBKEY>            # signed by the current authority
 *   node scripts/authority.mjs accept --keypair <PATH>      # signed by the successor
 *   node scripts/authority.mjs cancel                       # withdraw a pending nomination
 *
 * The config authority decides the fee, the treasury and the arbitrator. Handing it to a
 * multisig is the point of this script; handing it to a mistyped address would freeze all
 * three forever, which is why nothing moves until the successor signs for itself.
 *
 * The upgrade authority is a different power and this script does not touch it. That one
 * is `solana program set-upgrade-authority`, and it should go to a multisig or be burned
 * with --final. See KEYS.md.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const idl = JSON.parse(fs.readFileSync("src/idl/takeover_escrow.json", "utf8"));
const PID = new PublicKey(idl.address);
const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], PID)[0];
const pendingPda = PublicKey.findProgramAddressSync([Buffer.from("pending_authority")], PID)[0];

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const load = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
const defaultKey = process.env.PAYER ?? path.join(os.homedir(), ".config/solana/id.json");
const prog = (kp) => new Program(idl, new AnchorProvider(conn, new Wallet(kp), { commitment: "confirmed" }));

async function status() {
  const p = prog(load(defaultKey));
  const c = await p.account.config.fetch(configPda);
  // No pending account at all is the normal state; it only exists mid-handover.
  const pend = await p.account.pendingAuthority.fetchNullable(pendingPda);
  console.log(`  config account : ${configPda.toBase58()}`);
  console.log(`  authority      : ${c.authority.toBase58()}`);
  console.log(`  pending        : ${pend ? pend.newAuthority.toBase58() : "— none —"}`);
  console.log(`  treasury       : ${c.treasury.toBase58()}`);
  console.log(`  arbitrator     : ${c.arbitrator.toBase58()}`);
  console.log(`  fee            : ${c.feeBps / 100}%`);
  return c;
}

switch (cmd) {
  case "status":
    await status();
    break;

  case "nominate": {
    const target = argv[1];
    if (!target) throw new Error("usage: nominate <PUBKEY>");
    const signer = load(flag("keypair", defaultKey));
    await prog(signer).methods.nominateAuthority(new PublicKey(target))
      .accountsPartial({ config: configPda, pending: pendingPda, authority: signer.publicKey, systemProgram: SystemProgram.programId })
      .rpc();
    console.log(`nominated ${target}\n`);
    await status();
    console.log("\nNothing has changed yet. The successor must run `accept` with its own key.");
    break;
  }

  case "accept": {
    const signer = load(flag("keypair", defaultKey));
    await prog(signer).methods.acceptAuthority()
      .accountsPartial({ config: configPda, pending: pendingPda, newAuthority: signer.publicKey })
      .rpc();
    console.log(`accepted as ${signer.publicKey.toBase58()}\n`);
    await status();
    break;
  }

  case "cancel": {
    const signer = load(flag("keypair", defaultKey));
    // The program treats the default pubkey as "no nomination", so nominating it withdraws.
    await prog(signer).methods.nominateAuthority(PublicKey.default)
      .accountsPartial({ config: configPda, authority: signer.publicKey, systemProgram: SystemProgram.programId })
      .rpc();
    console.log("nomination withdrawn\n");
    await status();
    break;
  }

  default:
    console.log(fs.readFileSync(new URL(import.meta.url)).toString().split("*/")[0].replace(/^\/\*\*?|^ \* ?/gm, ""));
    process.exit(cmd ? 1 : 0);
}
