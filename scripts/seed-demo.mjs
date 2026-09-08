// Seeds a demo set of listings into the local sqlite db so the site can be reviewed
// with content. Dev only — `node scripts/seed-demo.mjs --clear` removes them again.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.DB_PATH ?? "data/takeover.db");
if (process.argv.includes("--clear")) {
  db.prepare("DELETE FROM events WHERE listing_id LIKE 'demo%'").run();
  db.prepare("DELETE FROM listings WHERE id LIKE 'demo%'").run();
  console.log("demo listings removed");
  process.exit(0);
}
const ROWS = [
  ["Sunset Terminal", "SUNT", "token_authority", 0.4], ["Ledger Nine", "LDG9", "token_authority", 1.2],
  ["Cold Open", "COLD", "token_authority", 3.5], ["Marginal", "MRGN", "token_authority", 12],
  ["Quiet Riot Labs", "QRIT", "token_authority", 44],
  ["Pelican Protocol", "PELI", "pump_creator", 0.6], ["Doubloon", "DBLN", "pump_creator", 2.1],
  ["Static Cling", "STAT", "pump_creator", 5.5], ["Night Shift", "NSFT", "pump_creator", 18],
  ["Overcast", "OVCT", "pump_creator", 90],
  ["Dockside Docs", "DOCK", "offchain", 0.9], ["Chartroom", "CHRT", "offchain", 4.2],
  ["Foghorn Analytics", "FOGH", "offchain", 15], ["Field Notes", "FLDN", "offchain", 60],
];
const SELLERS = ["1ZKhvcorPXZ1Wopbtd4tzMzfxDVHUe4YbGz3vqLMy7r", "4Th7TN6gEkEBVZqzQaa1cHfSzosPXnU12bFYj2DQJ3jf"];
const now = 1757000000000;
ROWS.forEach(([name, symbol, type, sol], i) => {
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
    ? { category: "project", links: ["https://example.com"], deliverables: "repo, domain, socials, admin roles" }
    : type === "pump_creator" ? { mint: token.mint, pumpUrl: `https://pump.fun/coin/${token.mint}` }
    : { mint: token.mint, authorities: ["mint", "metadata_update"] };
  db.prepare(`INSERT OR REPLACE INTO listings (id,type,title,description,price_lamports,seller,buyer,status,asset_json,mint,token_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, type, name, `${name} is a demo listing used to review the site with content in it.`,
    Math.round(sol * 1e9), SELLERS[i % 2], status === "active" ? null : SELLERS[(i + 1) % 2],
    status, JSON.stringify(asset), token?.mint ?? null, token ? JSON.stringify(token) : null, now + i * 1000, now + i * 1000);
  db.prepare(`INSERT INTO events (listing_id, kind, data_json, created_at) VALUES (?,?,'{}',?)`).run(id, "escrowed", now + i * 1000);
});
console.log(`seeded ${ROWS.length} demo listings`);
