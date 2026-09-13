/**
 * Fetch the on-chain programs the tests need to run against.
 *
 *   node scripts/fetch-fixtures.mjs
 *
 * `tests/metadata.test.ts` boots a bank with Metaplex Token Metadata loaded, because the
 * escrow calls into it to move a token's metadata authority. The binary is gitignored —
 * it is 800 KB of somebody else's program — so a fresh clone does not have it and the
 * suite dies with "Program file data not available for mpl_token_metadata", which reads
 * like a bug in this repository and is not one.
 *
 * The bytes come from the account itself rather than from a release page, so what the
 * tests run against is what mainnet runs. Already-present files are left alone.
 */
import fs from "node:fs";
import path from "node:path";
import { Connection, PublicKey } from "@solana/web3.js";

const BPF_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const RPC = process.env.FIXTURE_RPC_URL ?? "https://api.mainnet-beta.solana.com";

const FIXTURES = [
  { name: "mpl_token_metadata", id: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s" },
];

const conn = new Connection(RPC, "confirmed");
const dir = "tests/fixtures";
fs.mkdirSync(dir, { recursive: true });

let fetched = 0;
for (const { name, id } of FIXTURES) {
  const out = path.join(dir, `${name}.so`);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) {
    console.log(`  have  ${out}  ${fs.statSync(out).size.toLocaleString()} bytes`);
    continue;
  }
  const programId = new PublicKey(id);
  const [programData] = PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_LOADER);
  const info = await conn.getAccountInfo(programData, "confirmed");
  if (!info) {
    console.error(`error: no program data for ${name} (${id}) on ${RPC}`);
    process.exit(1);
  }
  // ProgramData layout: 4-byte tag, 8-byte slot, 1-byte Option discriminant, 32-byte
  // authority, then the ELF.
  const elf = info.data.subarray(45);
  if (elf.subarray(0, 4).toString("hex") !== "7f454c46") {
    console.error(`error: ${name} did not start with an ELF header — layout may have changed`);
    process.exit(1);
  }
  fs.writeFileSync(out, elf);
  console.log(`  wrote ${out}  ${elf.length.toLocaleString()} bytes  (from ${id})`);
  fetched++;
}
if (fetched) console.log(`\n${fetched} fixture${fetched > 1 ? "s" : ""} fetched. They are gitignored; this is safe to re-run.`);
