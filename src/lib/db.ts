import path from "node:path";
import fs from "node:fs";
import type { BuildRequest, BuilderCard, BuilderProfile, BuilderStats, ForumComment, ForumPost, Listing, ListingEvent, ListingReport, ListingStatus, Proposal, Reputation, Review, TokenInfo, WantedEntry, WantedRow } from "./types";

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
    CREATE TABLE IF NOT EXISTS wanted (
      mint TEXT NOT NULL,
      added_by TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      indicative_lamports INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (mint, added_by)
    );
    CREATE INDEX IF NOT EXISTS idx_wanted_mint ON wanted(mint);
    CREATE TABLE IF NOT EXISTS token_cache (
      mint TEXT PRIMARY KEY,
      token_json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS builders (
      wallet TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      github TEXT NOT NULL DEFAULT '',
      x TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id TEXT NOT NULL,
      reporter TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER,
      UNIQUE (listing_id, reporter)
    );
    CREATE INDEX IF NOT EXISTS idx_reports_listing ON reports(listing_id);
    CREATE TABLE IF NOT EXISTS used_signatures (
      signature TEXT PRIMARY KEY,
      purpose TEXT NOT NULL,
      listing_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      poster TEXT NOT NULL,
      title TEXT NOT NULL,
      brief TEXT NOT NULL,
      category TEXT NOT NULL,
      budget_lamports INTEGER NOT NULL,
      delivery_days INTEGER NOT NULL,
      status TEXT NOT NULL,
      awarded_dev TEXT,
      listing_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
    CREATE INDEX IF NOT EXISTS idx_requests_poster ON requests(poster);
    CREATE TABLE IF NOT EXISTS proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      dev TEXT NOT NULL,
      pitch TEXT NOT NULL,
      price_lamports INTEGER NOT NULL,
      delivery_days INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      -- One live proposal per developer per request: a second is an edit of the first,
      -- not a second bid, so nobody can flood a request with variations of themselves.
      UNIQUE (request_id, dev)
    );
    CREATE INDEX IF NOT EXISTS idx_proposals_request ON proposals(request_id);
    CREATE INDEX IF NOT EXISTS idx_proposals_dev ON proposals(dev);
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      section TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      removed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_posts_section ON posts(section, created_at);
    CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author);
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id TEXT NOT NULL,
      parent_id INTEGER,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      removed_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
    CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author);
    -- Votes are the rows; a score is always SUM(value) over them rather than a counter
    -- kept alongside. A counter drifts the first time anything fails halfway, and a
    -- score nobody can reconcile is worse than no score.
    CREATE TABLE IF NOT EXISTS votes (
      target TEXT NOT NULL,
      voter TEXT NOT NULL,
      value INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (target, voter)
    );
    CREATE INDEX IF NOT EXISTS idx_votes_target ON votes(target);
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id TEXT NOT NULL,
      reviewer TEXT NOT NULL,
      subject TEXT NOT NULL,
      role TEXT NOT NULL,
      rating INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      -- One per person per deal. A deal has two sides, so it can carry two reviews and
      -- never three; writing again edits your own rather than adding to it.
      UNIQUE (listing_id, reviewer)
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_subject ON reviews(subject);
    CREATE INDEX IF NOT EXISTS idx_reviews_listing ON reviews(listing_id);
  `);
  addColumns(db, "listings", { image: "TEXT" });
  addColumns(db, "builders", { skills: "TEXT", open_to_work: "INTEGER" });
  return db;
}

/**
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, so a column
 * added after a deploy never reaches the live database on its own. Adding it here keeps
 * the schema in one file rather than in a migrations folder nobody runs; SQLite's
 * ALTER TABLE ADD COLUMN is cheap and does not rewrite the table.
 */
function addColumns(
  db: InstanceType<SqliteModule["DatabaseSync"]>,
  table: string,
  columns: Record<string, string>,
) {
  const present = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
  );
  for (const [name, decl] of Object.entries(columns)) {
    if (!present.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${decl}`);
  }
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
    image: (r.image as string) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/** Point a listing at a stored banner, or clear it with null. */
export function setListingImage(id: string, image: string | null) {
  db().prepare("UPDATE listings SET image = ?, updated_at = ? WHERE id = ?").run(image, Date.now(), id);
}

/**
 * How many listings point at a stored file. Banners are content-addressed, so the same
 * bytes uploaded twice are one file with two referrers, and deleting one listing's
 * banner must not pull the picture out from under the other.
 */
export function imageRefCount(image: string): number {
  const r = db().prepare("SELECT COUNT(*) AS n FROM listings WHERE image = ?").get(image) as { n: number };
  return Number(r.n);
}

/** Every cover a listing still points at — what a sweep of the upload directory must keep. */
export function referencedImages(): Set<string> {
  const rows = db().prepare("SELECT DISTINCT image FROM listings WHERE image IS NOT NULL").all() as Row[];
  return new Set(rows.map((r) => String(r.image)));
}

export function insertListing(l: Listing) {
  db()
    .prepare(
      `INSERT INTO listings (id,type,title,description,price_lamports,seller,buyer,status,asset_json,mint,token_json,
        escrow_sig,payment_sig,settlement_sig,delivery_note,dispute_reason,image,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      l.id, l.type, l.title, l.description, l.priceLamports, l.seller, l.buyer, l.status,
      JSON.stringify(l.asset), l.mint, l.token ? JSON.stringify(l.token) : null,
      l.escrowSig, l.paymentSig, l.settlementSig, l.deliveryNote, l.disputeReason,
      l.image ?? null, l.createdAt, l.updatedAt
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

/**
 * File a report against a listing.
 *
 * One per wallet per listing, enforced by the unique index rather than by a read-then-write,
 * so two simultaneous reports cannot both pass a check and then both insert. A repeat from
 * the same wallet returns false rather than erroring: it is not a failure, it is a duplicate.
 */
export function addReport(listingId: string, reporter: string, reason: string): boolean {
  try {
    db().prepare(`INSERT INTO reports (listing_id, reporter, reason, created_at) VALUES (?,?,?,?)`)
      .run(listingId, reporter, reason, Date.now());
    addEvent(listingId, "reported", { reporter });
    return true;
  } catch (e) {
    const code = (e as { errcode?: number }).errcode;
    if (code === 19 || code === 2067 || /UNIQUE|constraint/i.test((e as Error).message)) return false;
    throw e;
  }
}

/** How many unresolved reports a listing carries. Shown to admins, and counted on the listing. */
export function reportCount(listingId: string): number {
  const r = db().prepare(`SELECT count(*) AS c FROM reports WHERE listing_id = ? AND resolved_at IS NULL`).get(listingId) as Row;
  return Number(r.c);
}

/** Every open report, newest first, for the admin view. */
export function openReports(limit = 100): ListingReport[] {
  return (db().prepare(
    `SELECT * FROM reports WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT ?`
  ).all(limit) as Row[]).map((r) => ({
    id: Number(r.id),
    listingId: r.listing_id as string,
    reporter: r.reporter as string,
    reason: r.reason as string,
    createdAt: Number(r.created_at),
    resolvedAt: r.resolved_at === null ? null : Number(r.resolved_at),
  }));
}

export function resolveReports(listingId: string) {
  db().prepare(`UPDATE reports SET resolved_at = ? WHERE listing_id = ? AND resolved_at IS NULL`).run(Date.now(), listingId);
}

export function getBuilder(wallet: string): BuilderProfile | null {
  const r = db().prepare(`SELECT * FROM builders WHERE wallet = ?`).get(wallet) as Row | undefined;
  if (!r) return null;
  return {
    wallet, name: r.name as string, bio: r.bio as string, github: r.github as string,
    x: r.x as string, website: r.website as string,
    skills: parseSkills(r.skills as string | null),
    openToWork: Number(r.open_to_work ?? 0) === 1,
    updatedAt: Number(r.updated_at),
  };
}

/** Stored as a comma-separated string, kept tidy on the way in and out. */
function parseSkills(raw: string | null): string[] {
  return (raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 12);
}

export function upsertBuilder(p: Omit<BuilderProfile, "updatedAt">) {
  const skills = [...new Set(parseSkills((p.skills ?? []).join(",")))].join(",");
  db().prepare(`INSERT INTO builders (wallet,name,bio,github,x,website,skills,open_to_work,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(wallet) DO UPDATE SET name=excluded.name, bio=excluded.bio, github=excluded.github,
      x=excluded.x, website=excluded.website, skills=excluded.skills,
      open_to_work=excluded.open_to_work, updated_at=excluded.updated_at`)
    .run(p.wallet, p.name, p.bio, p.github, p.x, p.website, skills, p.openToWork ? 1 : 0, Date.now());
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

/* ------------------------------------------------------------ wanted board */

export function addWanted(e: WantedEntry) {
  db().prepare(`INSERT INTO wanted (mint, added_by, note, indicative_lamports, created_at) VALUES (?,?,?,?,?)
    ON CONFLICT(mint, added_by) DO UPDATE SET note=excluded.note, indicative_lamports=excluded.indicative_lamports`)
    .run(e.mint, e.addedBy, e.note, e.indicativeLamports, e.createdAt);
}

export function removeWanted(mint: string, addedBy: string) {
  db().prepare(`DELETE FROM wanted WHERE mint = ? AND added_by = ?`).run(mint, addedBy);
}

export function wantedFor(mint: string): WantedEntry[] {
  return (db().prepare(`SELECT * FROM wanted WHERE mint = ? ORDER BY indicative_lamports DESC, created_at ASC`).all(mint) as Row[])
    .map((r) => ({
      mint: r.mint as string, addedBy: r.added_by as string, note: r.note as string,
      indicativeLamports: Number(r.indicative_lamports), createdAt: Number(r.created_at),
    }));
}

/** The board: every token somebody has asked for, most-wanted first. */
export function wantedBoard(limit = 60): WantedRow[] {
  const rows = db().prepare(`SELECT mint, COUNT(*) AS interest, MAX(indicative_lamports) AS top, MIN(created_at) AS first
    FROM wanted GROUP BY mint ORDER BY interest DESC, top DESC LIMIT ?`).all(limit) as Row[];
  return rows.map((r) => ({
    mint: r.mint as string,
    token: getCachedToken(r.mint as string),
    interest: Number(r.interest),
    topIndicativeLamports: Number(r.top ?? 0),
    firstWantedAt: Number(r.first),
    entries: [],
  }));
}

/** Chain reads are slow and rate-limited, so a token's dossier is cached. */
export function getCachedToken(mint: string, maxAgeMs = 10 * 60_000): TokenInfo | null {
  const r = db().prepare(`SELECT token_json, fetched_at FROM token_cache WHERE mint = ?`).get(mint) as Row | undefined;
  if (!r) return null;
  if (Date.now() - Number(r.fetched_at) > maxAgeMs) return JSON.parse(r.token_json as string) as TokenInfo;
  return JSON.parse(r.token_json as string) as TokenInfo;
}

export function cacheToken(mint: string, token: TokenInfo) {
  db().prepare(`INSERT INTO token_cache (mint, token_json, fetched_at) VALUES (?,?,?)
    ON CONFLICT(mint) DO UPDATE SET token_json=excluded.token_json, fetched_at=excluded.fetched_at`)
    .run(mint, JSON.stringify(token), Date.now());
}

export function isTokenCacheFresh(mint: string, maxAgeMs = 10 * 60_000): boolean {
  const r = db().prepare(`SELECT fetched_at FROM token_cache WHERE mint = ?`).get(mint) as Row | undefined;
  return !!r && Date.now() - Number(r.fetched_at) <= maxAgeMs;
}

/* ---------------------------------------------------------------- commissions */

function rowToRequest(r: Row): BuildRequest {
  return {
    id: r.id as string,
    poster: r.poster as string,
    title: r.title as string,
    brief: r.brief as string,
    category: r.category as BuildRequest["category"],
    budgetLamports: Number(r.budget_lamports),
    deliveryDays: Number(r.delivery_days),
    status: r.status as BuildRequest["status"],
    awardedDev: (r.awarded_dev as string) ?? null,
    listingId: (r.listing_id as string) ?? null,
    proposalCount: Number(r.proposal_count ?? 0),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function rowToProposal(r: Row): Proposal {
  return {
    id: Number(r.id),
    requestId: r.request_id as string,
    dev: r.dev as string,
    pitch: r.pitch as string,
    priceLamports: Number(r.price_lamports),
    deliveryDays: Number(r.delivery_days),
    status: r.status as Proposal["status"],
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/** Every read counts live proposals alongside the request, so a list never N+1s. */
const REQUEST_SELECT = `
  SELECT r.*, (
    SELECT COUNT(*) FROM proposals p WHERE p.request_id = r.id AND p.status != 'withdrawn'
  ) AS proposal_count
  FROM requests r`;

export function insertRequest(r: Omit<BuildRequest, "proposalCount">) {
  db().prepare(`INSERT INTO requests
      (id,poster,title,brief,category,budget_lamports,delivery_days,status,awarded_dev,listing_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(r.id, r.poster, r.title, r.brief, r.category, r.budgetLamports, r.deliveryDays,
      r.status, r.awardedDev, r.listingId, r.createdAt, r.updatedAt);
}

export function getRequest(id: string): BuildRequest | null {
  const r = db().prepare(`${REQUEST_SELECT} WHERE r.id = ?`).get(id) as Row | undefined;
  return r ? rowToRequest(r) : null;
}

export function listRequests(opts: { status?: BuildRequest["status"] | "all"; category?: string; poster?: string; dev?: string } = {}): BuildRequest[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.status && opts.status !== "all") { where.push("r.status = ?"); params.push(opts.status); }
  if (opts.category) { where.push("r.category = ?"); params.push(opts.category); }
  if (opts.poster) { where.push("r.poster = ?"); params.push(opts.poster); }
  // "requests I have bid on" — the other half of a developer's dashboard.
  if (opts.dev) { where.push("EXISTS (SELECT 1 FROM proposals p WHERE p.request_id = r.id AND p.dev = ? AND p.status != 'withdrawn')"); params.push(opts.dev); }
  const sql = `${REQUEST_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY r.created_at DESC LIMIT 200`;
  return (db().prepare(sql).all(...params) as Row[]).map(rowToRequest);
}

export function updateRequest(id: string, patch: Partial<Pick<BuildRequest, "status" | "awardedDev" | "listingId">>) {
  const map: Record<string, string> = { status: "status", awardedDev: "awarded_dev", listingId: "listing_id" };
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [k, col] of Object.entries(map)) {
    if (k in patch) { sets.push(`${col} = ?`); params.push((patch as Record<string, string | null>)[k] ?? null); }
  }
  if (!sets.length) return;
  sets.push("updated_at = ?"); params.push(Date.now());
  params.push(id);
  db().prepare(`UPDATE requests SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function listProposals(requestId: string): Proposal[] {
  return (db().prepare(
    `SELECT * FROM proposals WHERE request_id = ? AND status != 'withdrawn' ORDER BY created_at ASC`,
  ).all(requestId) as Row[]).map(rowToProposal);
}

export function getProposal(id: number): Proposal | null {
  const r = db().prepare(`SELECT * FROM proposals WHERE id = ?`).get(id) as Row | undefined;
  return r ? rowToProposal(r) : null;
}

/**
 * Place or replace a developer's proposal. The UNIQUE (request_id, dev) constraint makes
 * a second one an edit rather than a second bid, and re-opens a withdrawn one.
 */
export function upsertProposal(p: Omit<Proposal, "id" | "createdAt" | "updatedAt">): Proposal {
  const now = Date.now();
  db().prepare(`INSERT INTO proposals (request_id,dev,pitch,price_lamports,delivery_days,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(request_id, dev) DO UPDATE SET
      pitch=excluded.pitch, price_lamports=excluded.price_lamports,
      delivery_days=excluded.delivery_days, status=excluded.status, updated_at=excluded.updated_at`)
    .run(p.requestId, p.dev, p.pitch, p.priceLamports, p.deliveryDays, p.status, now, now);
  const r = db().prepare(`SELECT * FROM proposals WHERE request_id = ? AND dev = ?`).get(p.requestId, p.dev) as Row;
  return rowToProposal(r);
}

export function setProposalStatus(id: number, status: Proposal["status"]) {
  db().prepare(`UPDATE proposals SET status = ?, updated_at = ? WHERE id = ?`).run(status, Date.now(), id);
}

/**
 * Accept one proposal and award the request to its developer, in one transaction so a
 * request can never be left awarded to a proposal that is not itself accepted.
 */
export function awardRequest(requestId: string, proposalId: number, dev: string) {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    d.prepare(`UPDATE proposals SET status = 'accepted', updated_at = ? WHERE id = ?`).run(Date.now(), proposalId);
    d.prepare(`UPDATE requests SET status = 'awarded', awarded_dev = ?, updated_at = ? WHERE id = ?`)
      .run(dev, Date.now(), requestId);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

/* -------------------------------------------------------------------- forum */

/**
 * A post or comment plus its score, and how one wallet voted on it.
 *
 * `me` is threaded through the query rather than fetched separately so a page of
 * fifty comments is one statement, not fifty-one.
 */
const POST_SELECT = `
  SELECT p.*,
    COALESCE((SELECT SUM(value) FROM votes v WHERE v.target = 'post:' || p.id), 0) AS score,
    (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.removed_at IS NULL) AS comment_count,
    COALESCE((SELECT value FROM votes v WHERE v.target = 'post:' || p.id AND v.voter = ?), 0) AS my_vote
  FROM posts p`;

function rowToPost(r: Row): ForumPost {
  return {
    id: r.id as string,
    author: r.author as string,
    section: r.section as ForumPost["section"],
    title: r.title as string,
    body: r.body as string,
    score: Number(r.score ?? 0),
    commentCount: Number(r.comment_count ?? 0),
    myVote: Number(r.my_vote ?? 0),
    removedAt: r.removed_at ? Number(r.removed_at) : null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export function insertPost(p: Omit<ForumPost, "score" | "commentCount" | "myVote" | "removedAt">) {
  db().prepare(`INSERT INTO posts (id,author,section,title,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run(p.id, p.author, p.section, p.title, p.body, p.createdAt, p.updatedAt);
}

export function getPost(id: string, me = ""): ForumPost | null {
  const r = db().prepare(`${POST_SELECT} WHERE p.id = ?`).get(me, id) as Row | undefined;
  return r ? rowToPost(r) : null;
}

/**
 * `new` is plain recency. `top` is the raw score. `hot` decays a score against age so a
 * day-old thread with four votes does not outrank this morning's with three — the usual
 * trick, kept simple and computed in SQL so it cannot disagree with what is stored.
 */
export function listPosts(opts: { section?: string; sort?: "hot" | "new" | "top"; author?: string; me?: string; limit?: number } = {}): ForumPost[] {
  const where = ["p.removed_at IS NULL"];
  const params: (string | number)[] = [opts.me ?? ""];
  if (opts.section) { where.push("p.section = ?"); params.push(opts.section); }
  if (opts.author) { where.push("p.author = ?"); params.push(opts.author); }
  const order = opts.sort === "new" ? "p.created_at DESC"
    : opts.sort === "top" ? "score DESC, p.created_at DESC"
    : "(CAST(score AS REAL) + 1.0) / (((? - p.created_at) / 3600000.0) + 2.0) DESC, p.created_at DESC";
  const sql = `${POST_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?`;
  if (!opts.sort || opts.sort === "hot") params.push(Date.now());
  params.push(opts.limit ?? 100);
  return (db().prepare(sql).all(...params) as Row[]).map(rowToPost);
}

export function setPostRemoved(id: string, removed: boolean) {
  db().prepare(`UPDATE posts SET removed_at = ?, updated_at = ? WHERE id = ?`)
    .run(removed ? Date.now() : null, Date.now(), id);
}

function rowToComment(r: Row): ForumComment {
  return {
    id: Number(r.id),
    postId: r.post_id as string,
    parentId: r.parent_id ? Number(r.parent_id) : null,
    author: r.author as string,
    body: r.body as string,
    score: Number(r.score ?? 0),
    myVote: Number(r.my_vote ?? 0),
    removedAt: r.removed_at ? Number(r.removed_at) : null,
    createdAt: Number(r.created_at),
  };
}

export function insertComment(c: { postId: string; parentId: number | null; author: string; body: string }): ForumComment {
  const now = Date.now();
  const r = db().prepare(`INSERT INTO comments (post_id,parent_id,author,body,created_at) VALUES (?,?,?,?,?) RETURNING *`)
    .get(c.postId, c.parentId, c.author, c.body, now) as Row;
  return rowToComment(r);
}

export function listComments(postId: string, me = ""): ForumComment[] {
  return (db().prepare(`
    SELECT c.*,
      COALESCE((SELECT SUM(value) FROM votes v WHERE v.target = 'comment:' || c.id), 0) AS score,
      COALESCE((SELECT value FROM votes v WHERE v.target = 'comment:' || c.id AND v.voter = ?), 0) AS my_vote
    FROM comments c WHERE c.post_id = ? ORDER BY c.created_at ASC`).all(me, postId) as Row[])
    .map(rowToComment);
}

export function getComment(id: number): ForumComment | null {
  const r = db().prepare(`SELECT *, 0 AS score, 0 AS my_vote FROM comments WHERE id = ?`).get(id) as Row | undefined;
  return r ? rowToComment(r) : null;
}

export function setCommentRemoved(id: number, removed: boolean) {
  db().prepare(`UPDATE comments SET removed_at = ? WHERE id = ?`).run(removed ? Date.now() : null, id);
}

/**
 * Cast, change or clear a vote. Voting the same way twice clears it, which is what every
 * arrow on the internet does and what people expect from a second click.
 */
export function castVote(target: string, voter: string, value: 1 | -1 | 0) {
  if (value === 0) {
    db().prepare(`DELETE FROM votes WHERE target = ? AND voter = ?`).run(target, voter);
    return;
  }
  db().prepare(`INSERT INTO votes (target,voter,value,created_at) VALUES (?,?,?,?)
    ON CONFLICT(target,voter) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`)
    .run(target, voter, value, Date.now());
}

export function myVote(target: string, voter: string): number {
  const r = db().prepare(`SELECT value FROM votes WHERE target = ? AND voter = ?`).get(target, voter) as Row | undefined;
  return r ? Number(r.value) : 0;
}

export function scoreOf(target: string): number {
  const r = db().prepare(`SELECT COALESCE(SUM(value),0) AS s FROM votes WHERE target = ?`).get(target) as Row;
  return Number(r.s ?? 0);
}

/**
 * When this wallet last posted or commented. Used to rate-limit: a wallet costs nothing
 * to make, so this is a speed bump against flooding rather than real sybil resistance.
 */
export function lastWroteAt(wallet: string): number {
  const r = db().prepare(`SELECT MAX(t) AS t FROM (
      SELECT MAX(created_at) AS t FROM posts WHERE author = ?
      UNION ALL SELECT MAX(created_at) FROM comments WHERE author = ?
    )`).get(wallet, wallet) as Row;
  return Number(r.t ?? 0);
}

/* ------------------------------------------------------- builders directory */

/**
 * Everyone who has done anything here, with what they did kept in separate columns.
 *
 * Settled deals and SOL come from escrow and cannot be talked into existence. Posts and
 * forum score can be. They are never added together, because a single blended "score"
 * would let an afternoon of posting outrank a delivered project.
 */
export function builderDirectory(opts: { skill?: string; openOnly?: boolean; limit?: number } = {}): BuilderCard[] {
  const wallets = db().prepare(`
    SELECT wallet FROM (
      SELECT seller AS wallet FROM listings WHERE status != 'draft'
      UNION SELECT author FROM posts WHERE removed_at IS NULL
      UNION SELECT dev FROM proposals WHERE status != 'withdrawn'
      UNION SELECT wallet FROM builders
    ) GROUP BY wallet`).all() as Row[];

  const cards = wallets.map((w) => {
    const wallet = w.wallet as string;
    const counts = db().prepare(`
      SELECT
        (SELECT COUNT(*) FROM posts WHERE author = ? AND removed_at IS NULL) AS posts,
        (SELECT COALESCE(SUM(value),0) FROM votes v
           JOIN posts p ON v.target = 'post:' || p.id WHERE p.author = ?) AS forum_score,
        (SELECT COUNT(*) FROM requests WHERE awarded_dev = ?) AS commissions,
        (SELECT MAX(created_at) FROM posts WHERE author = ?) AS last_post
      `).get(wallet, wallet, wallet, wallet) as Row;
    return {
      wallet,
      profile: getBuilder(wallet),
      stats: builderStats(wallet),
      posts: Number(counts.posts ?? 0),
      forumScore: Number(counts.forum_score ?? 0),
      commissions: Number(counts.commissions ?? 0),
      reputation: reputationOf(wallet),
      lastSeen: counts.last_post ? Number(counts.last_post) : null,
    } satisfies BuilderCard;
  });

  const filtered = cards.filter((c) => {
    if (opts.openOnly && !c.profile?.openToWork) return false;
    if (opts.skill && !(c.profile?.skills ?? []).includes(opts.skill.toLowerCase())) return false;
    return true;
  });

  // Delivered work first, then commissions won, then everything else — so the directory
  // is ordered by what someone finished, not by how loudly they are around.
  filtered.sort((a, b) =>
    b.stats.sold - a.stats.sold ||
    b.commissions - a.commissions ||
    b.stats.listed - a.stats.listed ||
    b.forumScore - a.forumScore);
  return filtered.slice(0, opts.limit ?? 100);
}

/* --------------------------------------------------------------- reputation */

function rowToReview(r: Row): Review {
  return {
    id: Number(r.id),
    listingId: r.listing_id as string,
    reviewer: r.reviewer as string,
    subject: r.subject as string,
    role: r.role as Review["role"],
    rating: Number(r.rating),
    body: r.body as string,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/** Write or rewrite the signer's review of one deal. */
export function upsertReview(r: Omit<Review, "id" | "createdAt" | "updatedAt">): Review {
  const now = Date.now();
  db().prepare(`INSERT INTO reviews (listing_id,reviewer,subject,role,rating,body,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(listing_id, reviewer) DO UPDATE SET
      rating=excluded.rating, body=excluded.body, updated_at=excluded.updated_at`)
    .run(r.listingId, r.reviewer, r.subject, r.role, r.rating, r.body, now, now);
  const row = db().prepare(`SELECT * FROM reviews WHERE listing_id = ? AND reviewer = ?`)
    .get(r.listingId, r.reviewer) as Row;
  return rowToReview(row);
}

export function reviewsForListing(listingId: string): Review[] {
  return (db().prepare(`SELECT * FROM reviews WHERE listing_id = ? ORDER BY created_at ASC`).all(listingId) as Row[])
    .map(rowToReview);
}

export function reviewsAbout(wallet: string, limit = 50): Review[] {
  return (db().prepare(`SELECT * FROM reviews WHERE subject = ? ORDER BY created_at DESC LIMIT ?`)
    .all(wallet, limit) as Row[]).map(rowToReview);
}

export function myReviewOf(listingId: string, reviewer: string): Review | null {
  const r = db().prepare(`SELECT * FROM reviews WHERE listing_id = ? AND reviewer = ?`)
    .get(listingId, reviewer) as Row | undefined;
  return r ? rowToReview(r) : null;
}

/**
 * Everything a wallet's history says about them.
 *
 * Only terminal listings count. `sold` means the escrow paid out; `refunded` means it
 * went back to the buyer, which is the seller's failure and is counted against them
 * rather than quietly dropped. Drafts and cancellations never happened and are ignored.
 */
export function reputationOf(wallet: string): Reputation {
  const r = db().prepare(`
    SELECT
      (SELECT COUNT(*) FROM listings WHERE seller = ? AND status = 'sold') AS sold,
      (SELECT COUNT(*) FROM listings WHERE buyer = ? AND status = 'sold') AS bought,
      (SELECT COALESCE(SUM(price_lamports),0) FROM listings WHERE seller = ? AND status = 'sold') AS earned,
      (SELECT COALESCE(SUM(price_lamports),0) FROM listings WHERE buyer = ? AND status = 'sold') AS spent,
      (SELECT COUNT(*) FROM listings WHERE seller = ? AND status = 'refunded') AS refunded,
      (SELECT COUNT(*) FROM listings WHERE seller = ? AND status = 'disputed') AS disputed,
      (SELECT COUNT(*) FROM requests rq JOIN listings l ON rq.listing_id = l.id
         WHERE rq.awarded_dev = ? AND l.status = 'sold') AS commissions,
      (SELECT COUNT(*) FROM reviews WHERE subject = ?) AS rating_count,
      (SELECT AVG(rating) FROM reviews WHERE subject = ?) AS avg_rating,
      (SELECT MIN(created_at) FROM listings
         WHERE (seller = ? OR buyer = ?) AND status IN ('sold','refunded')) AS first_deal
  `).get(wallet, wallet, wallet, wallet, wallet, wallet, wallet, wallet, wallet, wallet, wallet) as Row;

  return {
    wallet,
    soldCount: Number(r.sold ?? 0),
    boughtCount: Number(r.bought ?? 0),
    commissionsDelivered: Number(r.commissions ?? 0),
    earnedLamports: Number(r.earned ?? 0),
    spentLamports: Number(r.spent ?? 0),
    refundedAgainst: Number(r.refunded ?? 0),
    disputedAgainst: Number(r.disputed ?? 0),
    ratingCount: Number(r.rating_count ?? 0),
    averageRating: r.avg_rating === null || r.avg_rating === undefined ? null : Number(r.avg_rating),
    firstDealAt: r.first_deal ? Number(r.first_deal) : null,
  };
}
