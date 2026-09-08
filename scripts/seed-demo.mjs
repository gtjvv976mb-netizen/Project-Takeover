// Seeds a demo fleet into the local sqlite db so the harbour can be reviewed with
// ships in it. Dev only — `node scripts/seed-demo.mjs --clear` removes them again.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.DB_PATH ?? "data/takeover.db");
const clear = process.argv.includes("--clear");
if (clear) {
  db.prepare("DELETE FROM events WHERE listing_id LIKE 'demo%'").run();
  db.prepare("DELETE FROM listings WHERE id LIKE 'demo%'").run();
  console.log("demo fleet removed");
  process.exit(0);
}
const NAMES = [
  ["Nautilus", "NAUT", "token_authority", 0.4], ["Kraken Cash", "KRKN", "token_authority", 1.2],
  ["Salt Dog", "SALT", "token_authority", 3.5], ["Bluewater", "BLUE", "token_authority", 12],
  ["Harbormaster", "HARB", "token_authority", 44],
  ["Pelican", "PELI", "pump_creator", 0.6], ["Doubloon", "DBLN", "pump_creator", 2.1],
  ["Barnacle Bill", "BARN", "pump_creator", 5.5], ["Siren Song", "SIRN", "pump_creator", 18],
  ["Leviathan", "LEVI", "pump_creator", 90],
  ["Dockside", "DOCK", "offchain", 0.9], ["Chartroom", "CHRT", "offchain", 4.2],
  ["Foghorn", "FOGH", "offchain", 15], ["Lighthouse Labs", "LTHS", "offchain", 60],
];
const SELLERS = ["1ZKhvcorPXZ1Wopbtd4tzMzfxDVHUe4YbGz3vqLMy7r", "4Th7TN6gEkEBVZqzQaa1cHfSzosPXnU12bFYj2DQJ3jf"];
const now = 1757000000000;
NAMES.forEach(([name, symbol, type, sol], i) => {
  const id = `demo${String(i).padStart(4, "0")}`;
  const status = i % 7 === 3 ? "paid" : i % 11 === 5 ? "sold" : "active";
  const token = type === "offchain" ? null : {
    mint: `Demo${symbol}1111111111111111111111111111111`, name, symbol, decimals: 6,
    supply: "1000000000000000", mintAuthority: i % 3 ? null : SELLERS[i % 2],
    freezeAuthority: null, updateAuthority: i % 2 ? SELLERS[i % 2] : null,
    pump: type === "pump_creator" ? { bondingCurve: "bc", creator: SELLERS[i % 2], complete: i % 2 === 0 } : null,
    holders: { top: Array.from({ length: 10 }, (_, k) => ({ address: `h${k}`, amount: String(Math.floor(9e14 / (k + 1))) })), top10Share: 0.12 + (i % 5) * 0.09 },
  };
  const asset = type === "offchain"
    ? { category: "project", links: ["https://example.com"], deliverables: "repo, domain, socials" }
    : type === "pump_creator" ? { mint: token.mint, pumpUrl: `https://pump.fun/coin/${token.mint}` }
    : { mint: token.mint, authorities: ["mint", "metadata_update"] };
  db.prepare(`INSERT OR REPLACE INTO listings (id,type,title,description,price_lamports,seller,buyer,status,asset_json,mint,token_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, type, name, `${name} is a demo listing used to review the harbour with ships in it.`,
    Math.round(sol * 1e9), SELLERS[i % 2], status === "active" ? null : SELLERS[(i + 1) % 2],
    status, JSON.stringify(asset), token?.mint ?? null, token ? JSON.stringify(token) : null, now + i * 1000, now + i * 1000);
  db.prepare(`INSERT INTO events (listing_id, kind, data_json, created_at) VALUES (?,?,'{}',?)`).run(id, "escrowed", now + i * 1000);
});
console.log(`seeded ${NAMES.length} demo vessels`);
