/**
 * One-time setup of the escrow program's config account: the fee, the treasury that
 * receives it, and the arbitrator allowed to decide disputes.
 *
 * Usage: node scripts/init-program.mjs [--fee-bps 200] [--arbitrator <pubkey>] [--treasury <pubkey>]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const idl = JSON.parse(fs.readFileSync("target/idl/takeover_escrow.json", "utf8"));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const keyPath = arg("keypair", path.join(os.homedir(), ".config/solana/id.json"));
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))));

const connection = new Connection(rpc, "confirmed");
const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
const program = new Program(idl, provider);

const feeBps = Number(arg("fee-bps", 200));
const arbitrator = new PublicKey(arg("arbitrator", payer.publicKey.toBase58()));
const treasury = new PublicKey(arg("treasury", payer.publicKey.toBase58()));
const config = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];

const existing = await connection.getAccountInfo(config);
if (existing) {
  console.log(`config already exists at ${config.toBase58()} — updating`);
  await program.methods.updateConfig(feeBps, arbitrator, treasury)
    .accountsPartial({ config, authority: payer.publicKey }).rpc();
} else {
  await program.methods.initialize(feeBps, arbitrator, treasury)
    .accountsPartial({ config, authority: payer.publicKey, systemProgram: SystemProgram.programId }).rpc();
}

const c = await program.account.config.fetch(config);
console.log(JSON.stringify({
  rpc, programId: program.programId.toBase58(), config: config.toBase58(),
  feeBps: c.feeBps, arbitrator: c.arbitrator.toBase58(), treasury: c.treasury.toBase58(),
}, null, 2));
void BN;
