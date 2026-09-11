/**
 * Everything worth checking before spending real SOL.
 *
 *   node scripts/preflight.mjs                      # check devnet
 *   node scripts/preflight.mjs --mainnet            # check mainnet readiness
 *   node scripts/preflight.mjs --mainnet --site https://project-takeover.com
 *
 * A mainnet deploy costs about 5.3 SOL in rent that only comes back if the program is
 * closed, and a mistake found afterwards is a mistake you have paid for. Everything here
 * is cheap to check and expensive to get wrong.
 *
 * Exits non-zero if anything fails, so it can gate a deploy.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const MAINNET = process.argv.includes("--mainnet");
const NETWORK = MAINNET ? "mainnet-beta" : "devnet";
const RPC = process.env.RPC_URL ?? `https://api.${NETWORK}.solana.com`;
const siteArg = process.argv.indexOf("--site");
const SITE = siteArg >= 0 ? process.argv[siteArg + 1] : null;

const conn = new Connection(RPC, "confirmed");
const idl = JSON.parse(fs.readFileSync("src/idl/takeover_escrow.json", "utf8"));
const PID = new PublicKey(idl.address);
const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], PID)[0];
const BPF_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

let fails = 0, warns = 0;
const pass = (m, d = "") => console.log(`  \x1b[32m✓\x1b[0m ${m}${d ? `  ${d}` : ""}`);
const warn = (m, d = "") => { warns++; console.log(`  \x1b[33m!\x1b[0m ${m}${d ? `  ${d}` : ""}`); };
const fail = (m, d = "") => { fails++; console.log(`  \x1b[31m✗\x1b[0m ${m}${d ? `  ${d}` : ""}`); };
const head = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const deployKeyPath = process.env.PAYER ?? path.join(os.homedir(), ".config/solana/id.json");
const deployKey = fs.existsSync(deployKeyPath)
  ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(deployKeyPath, "utf8"))))
  : null;

console.log(`\npreflight — ${NETWORK} — ${RPC.replace(/\?api-key=.*/, "?api-key=***")}`);

/* ------------------------------------------------------------------ build */
head("Build");
{
  const so = "target/deploy/takeover_escrow.so";
  if (!fs.existsSync(so)) fail("program binary missing", "run scripts/build-program.sh");
  else {
    const size = fs.statSync(so).size;
    pass("program binary present", `${size.toLocaleString()} bytes`);
    // The IDL the app imports must describe the binary being deployed, or the site builds
    // transactions the program will reject.
    const built = "target/idl/takeover_escrow.json";
    if (fs.existsSync(built)) {
      const a = JSON.stringify(JSON.parse(fs.readFileSync(built, "utf8")).instructions.map((i) => i.name));
      const b = JSON.stringify(idl.instructions.map((i) => i.name));
      a === b ? pass("committed IDL matches the built one") : fail("src/idl is stale", "re-run scripts/build-program.sh");
    }
  }
  try {
    execSync("git diff --quiet -- programs/ src/idl/", { stdio: "ignore" });
    pass("no uncommitted program changes");
  } catch { fail("programs/ or src/idl/ has uncommitted changes", "commit before deploying"); }
}

/* ------------------------------------------------------------- on chain */
head("On chain");
const programInfo = await conn.getAccountInfo(PID).catch(() => null);
if (!programInfo) {
  MAINNET
    ? warn("program not deployed to mainnet yet", PID.toBase58())
    : fail("program not found", PID.toBase58());
} else {
  pass("program deployed", PID.toBase58());
  const [programData] = PublicKey.findProgramAddressSync([PID.toBuffer()], BPF_LOADER);
  const pd = await conn.getAccountInfo(programData).catch(() => null);
  if (pd && pd.data.length >= 45) {
    const upgradeable = pd.data[12] === 1;
    const authority = upgradeable ? new PublicKey(pd.data.subarray(13, 45)).toBase58() : null;
    if (!upgradeable) pass("program is IMMUTABLE", "nobody can replace it");
    else if (MAINNET && deployKey && authority === deployKey.publicKey.toBase58())
      fail("upgrade authority is the local deploy key", "a laptop key can replace the program and drain every escrow");
    else warn("program is upgradeable", `by ${authority}`);
  }
}

const cfgInfo = await conn.getAccountInfo(configPda).catch(() => null);
if (!cfgInfo) {
  MAINNET ? warn("config not initialised yet", "run scripts/init-program.mjs") : fail("config account missing");
} else {
  const d = cfgInfo.data;
  const authority = new PublicKey(d.subarray(8, 40)).toBase58();
  const arbitrator = new PublicKey(d.subarray(40, 72)).toBase58();
  const treasury = new PublicKey(d.subarray(72, 104)).toBase58();
  const feeBps = d.readUInt16LE(104);

  feeBps <= 500 ? pass("fee within the program's hard cap", `${feeBps / 100}%`) : fail("fee above cap", `${feeBps}`);

  const roles = { authority, arbitrator, treasury };
  const distinct = new Set(Object.values(roles)).size;
  distinct === 3
    ? pass("config authority, arbitrator and treasury are three different keys")
    : (MAINNET ? fail : warn)("roles share a key", JSON.stringify(roles, null, 0));

  if (MAINNET && deployKey) {
    for (const [role, key] of Object.entries(roles)) {
      if (key === deployKey.publicKey.toBase58())
        fail(`${role} is the local deploy key`, "its private key is a plaintext file on this machine");
    }
  }
}

/* ------------------------------------------------------------- funding */
head("Funding");
if (!deployKey) warn("no deploy keypair found", deployKeyPath);
else {
  const bal = await conn.getBalance(deployKey.publicKey).catch(() => 0);
  const sol = bal / LAMPORTS_PER_SOL;
  const need = programInfo ? 0.5 : 5.5; // a fresh deploy pays rent on the program account
  sol >= need
    ? pass("deploy wallet funded", `${sol.toFixed(3)} SOL`)
    : (MAINNET ? fail : warn)("deploy wallet short", `${sol.toFixed(3)} SOL, needs ~${need}`);
}

/* ----------------------------------------------------------------- site */
if (SITE) {
  head("Site");
  try {
    const cfg = await (await fetch(`${SITE}/api/config`, { signal: AbortSignal.timeout(30_000) })).json();
    cfg.network === NETWORK
      ? pass("site network matches", cfg.network)
      : fail("site is on the wrong network", `site says ${cfg.network}, checking ${NETWORK}`);

    cfg.programId === PID.toBase58()
      ? pass("site points at this program")
      : fail("site points at a different program", cfg.programId);

    // The browser builds buy_token with the treasury the site hands it and the program
    // compares it against its own config. A mismatch rejects every purchase.
    if (cfgInfo) {
      const onChainTreasury = new PublicKey(cfgInfo.data.subarray(72, 104)).toBase58();
      cfg.treasury === onChainTreasury
        ? pass("site treasury matches the program's")
        : fail("site and program disagree on the treasury", `site ${cfg.treasury} vs chain ${onChainTreasury}`);
    }

    const h = await (await fetch(`${SITE}/api/health`, { signal: AbortSignal.timeout(30_000) })).json();
    if (!h.rpcReachable) fail("site cannot reach its RPC");
    else {
      pass("site can reach the cluster", `slot ${h.slot}`);

      // A site set to devnet with a mainnet RPC key answers every question confidently and
      // wrongly: mints are "not found", the program is "not deployed", listings vanish.
      // Nothing errors, so it looks like the site is broken rather than pointed elsewhere.
      // Slot heights differ by tens of millions between clusters, which makes this cheap
      // to catch and worth catching — it cost an afternoon once.
      const ours = await conn.getSlot("confirmed").catch(() => null);
      if (ours !== null) {
        const drift = Math.abs(ours - h.slot);
        drift < 5_000_000
          ? pass("site's RPC is on the same cluster as this check", `within ${drift.toLocaleString()} slots`)
          : fail(
              "site's RPC is on a DIFFERENT cluster",
              `site slot ${h.slot.toLocaleString()} vs ${NETWORK} ${ours.toLocaleString()} — check RPC_URL's network`,
            );
      }
    }
    if (h.programDeployed === false || h.programDeployed === null)
      fail("site's RPC cannot see the program", "usually means RPC_URL points at the wrong cluster");
  } catch (e) {
    fail("site unreachable", String(e.message ?? e).slice(0, 80));
  }
}

/* --------------------------------------------------------------- verdict */
console.log();
if (fails) {
  console.log(`\x1b[31m${fails} blocking problem${fails > 1 ? "s" : ""}\x1b[0m${warns ? `, ${warns} warning${warns > 1 ? "s" : ""}` : ""}. Do not deploy.`);
  process.exit(1);
}
console.log(warns ? `\x1b[33m${warns} warning${warns > 1 ? "s" : ""}\x1b[0m, nothing blocking.` : "\x1b[32mAll clear.\x1b[0m");
