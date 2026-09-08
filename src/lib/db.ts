import path from "node:path";
import fs from "node:fs";
import type { BuilderProfile, BuilderStats, Listing, ListingEvent, ListingStatus } from "./types";

// node:sqlite is a Node 22.13+/24 built-in. We resolve it through
// process.getBuiltinModule so the Next.js bundler leaves it alone.
type SqliteModule = typeof import("node:sqlite");
const sqlite = (process as unknown as { getBuiltinModule: (n: string) => SqliteModule })
  .getBuiltinModule("node:sqlite");

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, "takeover.db");

declare global {
  var __takeoverDb: InstanceType<SqliteModule["DatabaseSync"]> | undefined;
}

function open() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new sqlite.DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_lamports INTEGER NOT NULL,
      seller TEXT NOT NULL,
      buyer TEXT,
      status TEXT NOT NULL,
      asset_json TEXT NOT NULL,
      mint TEXT,
      token_json TEXT,
      escrow_sig TEXT,
      payment_sig TEXT UNIQUE,
      settlement_sig TEXT,
      delivery_note TEXT,
      dispute_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
    CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings(seller);
    CREATE INDEX IF NOT EXISTS idx_listings_buyer ON listings(buyer);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_listing ON events(listing_id);
    CREATE TABLE IF NOT EXISTS builders (
      wallet TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      github TEXT NOT NULL DEFAULT '',
      x TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS used_signatures (
      signature TEXT PRIMARY KEY,
      purpose TEXT NOT NULL,
      listing_id TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

export function db() {
  if (!globalThis.__takeoverDb) globalThis.__takeoverDb = open();
  return globalThis.__takeoverDb;
}

type Row = Record<string, string | number | null>;

function rowToListing(r: Row): Listing {
  return {
    id: r.id as string,
    type: r.type as Listing["type"],
    title: r.title as string,
    description: r.description as string,
    priceLamports: Number(r.price_lamports),
    seller: r.seller as string,
    buyer: (r.buyer as string) ?? null,
    status: r.status as ListingStatus,
    asset: JSON.parse(r.asset_json as string),
    mint: (r.mint as string) ?? null,
    token: r.token_json ? JSON.parse(r.token_json as string) : null,
    escrowSig: (r.escrow_sig as string) ?? null,
    paymentSig: (r.payment_sig as string) ?? null,
    settlementSig: (r.settlement_sig as string) ?? null,
    deliveryNote: (r.delivery_note as string) ?? null,
    disputeReason: (r.dispute_reason as string) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export function insertListing(l: Listing) {
  db()
    .prepare(
      `INSERT INTO listings (id,type,title,description,price_lamports,seller,buyer,status,asset_json,mint,token_json,
        escrow_sig,payment_sig,settlement_sig,delivery_note,dispute_reason,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      l.id, l.type, l.title, l.description, l.priceLamports, l.seller, l.buyer, l.status,
      JSON.stringify(l.asset), l.mint, l.token ? JSON.stringify(l.token) : null,
      l.escrowSig, l.paymentSig, l.settlementSig, l.deliveryNote, l.disputeReason,
      l.createdAt, l.updatedAt
    );
  addEvent(l.id, "created", { seller: l.seller, type: l.type });
}

export function getListing(id: string): Listing | null {
  const r = db().prepare(`SELECT * FROM listings WHERE id = ?`).get(id) as Row | undefined;
  return r ? rowToListing(r) : null;
}

export function listListings(opts: { status?: ListingStatus | "all"; wallet?: string; type?: string } = {}): Listing[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.status && opts.status !== "all") { where.push("status = ?"); params.push(opts.status); }
  if (opts.type) { where.push("type = ?"); params.push(opts.type); }
  if (opts.wallet) { where.push("(seller = ? OR buyer = ?)"); params.push(opts.wallet, opts.wallet); }
  const sql = `SELECT * FROM listings ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT 200`;
  return (db().prepare(sql).all(...params) as Row[]).map(rowToListing);
}

export function updateListing(id: string, patch: Partial<Listing>, eventKind?: string, eventData: Record<string, unknown> = {}) {
  const map: Record<string, string> = {
    status: "status", buyer: "buyer", escrowSig: "escrow_sig", paymentSig: "payment_sig",
    settlementSig: "settlement_sig", deliveryNote: "delivery_note", disputeReason: "dispute_reason",
    title: "title", description: "description", priceLamports: "price_lamports",
  };
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [k, col] of Object.entries(map)) {
    if (k in patch) { sets.push(`${col} = ?`); params.push((patch as Record<string, string | number | null>)[k] ?? null); }
  }
  if ("asset" in patch) { sets.push("asset_json = ?"); params.push(JSON.stringify(patch.asset)); }
  if ("token" in patch) { sets.push("token_json = ?"); params.push(patch.token ? JSON.stringify(patch.token) : null); }
  sets.push("updated_at = ?"); params.push(Date.now());
  params.push(id);
  db().prepare(`UPDATE listings SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  if (eventKind) addEvent(id, eventKind, eventData);
}

export function addEvent(listingId: string, kind: string, data: Record<string, unknown> = {}) {
  db().prepare(`INSERT INTO events (listing_id, kind, data_json, created_at) VALUES (?,?,?,?)`)
    .run(listingId, kind, JSON.stringify(data), Date.now());
}

export function listEvents(listingId: string): ListingEvent[] {
  return (db().prepare(`SELECT * FROM events WHERE listing_id = ? ORDER BY id ASC`).all(listingId) as Row[]).map((r) => ({
    id: Number(r.id),
    listingId: r.listing_id as string,
    kind: r.kind as string,
    data: JSON.parse(r.data_json as string),
    createdAt: Number(r.created_at),
  }));
}

/** Atomically claim a tx signature so it can only be consumed once (payment, refund). Returns false if already used. */
export function claimSignature(signature: string, purpose: string, listingId: string | null): boolean {
  try {
    db().prepare(`INSERT INTO used_signatures (signature, purpose, listing_id, created_at) VALUES (?,?,?,?)`).run(signature, purpose, listingId, Date.now());
    return true;
  } catch (e) {
    const code = (e as { errcode?: number; code?: string }).errcode ?? (e as { code?: string }).code;
    // SQLITE_CONSTRAINT (19) / SQLITE_CONSTRAINT_PRIMARYKEY (1555): already claimed. Anything else is a real failure.
    if (code === 19 || code === 1555 || code === "ERR_SQLITE_ERROR" && /UNIQUE|constraint/i.test((e as Error).message)) return false;
    throw e;
  }
}

export function getBuilder(wallet: string): BuilderProfile | null {
  const r = db().prepare(`SELECT * FROM builders WHERE wallet = ?`).get(wallet) as Row | undefined;
  if (!r) return null;
  return { wallet, name: r.name as string, bio: r.bio as string, github: r.github as string, x: r.x as string, website: r.website as string, updatedAt: Number(r.updated_at) };
}

export function upsertBuilder(p: Omit<BuilderProfile, "updatedAt">) {
  db().prepare(`INSERT INTO builders (wallet,name,bio,github,x,website,updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(wallet) DO UPDATE SET name=excluded.name, bio=excluded.bio, github=excluded.github, x=excluded.x, website=excluded.website, updated_at=excluded.updated_at`)
    .run(p.wallet, p.name, p.bio, p.github, p.x, p.website, Date.now());
}

export function builderStats(wallet: string): BuilderStats {
  const r = db().prepare(`SELECT COUNT(*) AS listed,
      SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) AS sold,
      SUM(CASE WHEN status = 'sold' THEN price_lamports ELSE 0 END) AS earned,
      MIN(created_at) AS first
    FROM listings WHERE seller = ? AND status != 'draft'`).get(wallet) as Row;
  return { listed: Number(r.listed ?? 0), sold: Number(r.sold ?? 0), earnedLamports: Number(r.earned ?? 0), firstListedAt: r.first ? Number(r.first) : null };
}

/** Builders ranked by sold deals, for the leaderboard. */
export function topBuilders(limit = 12): { wallet: string; profile: BuilderProfile | null; stats: BuilderStats }[] {
  const rows = db().prepare(`SELECT seller FROM listings WHERE status != 'draft' GROUP BY seller
    ORDER BY SUM(CASE WHEN status='sold' THEN 1 ELSE 0 END) DESC, COUNT(*) DESC LIMIT ?`).all(limit) as Row[];
  return rows.map((r) => ({ wallet: r.seller as string, profile: getBuilder(r.seller as string), stats: builderStats(r.seller as string) }));
}
