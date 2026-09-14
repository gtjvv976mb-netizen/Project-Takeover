// No `server-only` guard here, for the same reason `db.ts` carries none: this module is
// reached only from route handlers — the browser goes through lib/client/api.ts — and the
// rules below are the security-critical part of accepting a stranger's file, so they are
// worth testing directly. `server-only` throws on import outside a server component,
// which would put the validation out of reach of the test suite.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Banner storage on the service's persistent disk.
 *
 * This is the one place the site accepts a file from a stranger, so the rules are
 * deliberately narrow: a small size cap, and a format decided by reading the bytes
 * rather than by believing the upload's Content-Type, which the client writes and can
 * therefore lie about. SVG is refused outright — it is a document that can carry script,
 * not a picture, and serving one from our own origin would hand an uploader our cookies.
 *
 * Files are named by the SHA-256 of their contents. That gives an unguessable name, makes
 * re-uploading the same picture free, and means a corrupted write can never quietly
 * masquerade as a good one.
 *
 * The `turbopackIgnore` comments on the fs calls are deliberate. These paths point at a
 * disk mounted outside the project (/var/data on Render) and are only known at runtime,
 * so the bundler cannot trace them; left unmarked it gives up and traces the entire
 * project into the server bundle, which bloats every deploy.
 */

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB

/** Magic numbers, checked against the head of the file. Order matters only for speed. */
const SIGNATURES: { ext: string; mime: string; match: (b: Buffer) => boolean }[] = [
  {
    ext: "png", mime: "image/png",
    match: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: "jpg", mime: "image/jpeg",
    match: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: "webp", mime: "image/webp",
    match: (b) => b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
  {
    ext: "gif", mime: "image/gif",
    match: (b) => b.length > 6 && ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("latin1")),
  },
];

export const ACCEPTED_LABEL = "PNG, JPEG, WebP or GIF";

/** The format these bytes actually are, or null if they are not a picture we serve. */
export function sniffImage(bytes: Buffer): { ext: string; mime: string } | null {
  const hit = SIGNATURES.find((s) => s.match(bytes));
  return hit ? { ext: hit.ext, mime: hit.mime } : null;
}

/**
 * Beside the database, so the banners live on the same persistent disk and survive a
 * deploy. On Render that is /var/data; in development it is ./data.
 */
export function uploadDir(): string {
  if (process.env.UPLOAD_DIR) return process.env.UPLOAD_DIR;
  const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), "data", "takeover.db");
  return path.join(path.dirname(dbPath), "uploads");
}

/**
 * A stored name is `<64 hex>.<ext>` and nothing else. Enforced on the way out of the
 * database as well as on the way in from a URL, so a bad row cannot walk the serving
 * route up out of the uploads directory.
 */
const NAME_RE = /^[0-9a-f]{64}\.(png|jpg|webp|gif)$/;

export function isStoredName(name: string): boolean {
  return NAME_RE.test(name);
}

export function mimeForName(name: string): string | null {
  const ext = name.split(".").pop();
  return SIGNATURES.find((s) => s.ext === ext)?.mime ?? null;
}

/** Absolute path of a stored file, or null if the name is not one of ours. */
export function storedPath(name: string): string | null {
  if (!isStoredName(name)) return null;
  const dir = uploadDir();
  const full = path.join(dir, name);
  // Belt and braces: the regex already forbids separators, but resolve and compare
  // anyway so this stays true if the name rule is ever loosened.
  return path.resolve(full).startsWith(path.resolve(/*turbopackIgnore: true*/ dir) + path.sep) ? full : null;
}

export type SaveResult =
  | { ok: true; name: string; mime: string; bytes: number }
  | { ok: false; error: string };

export function saveImage(bytes: Buffer): SaveResult {
  if (bytes.length === 0) return { ok: false, error: "That file is empty." };
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `That image is ${(bytes.length / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.` };
  }
  const kind = sniffImage(bytes);
  if (!kind) return { ok: false, error: `That file is not a ${ACCEPTED_LABEL} image.` };

  const name = `${crypto.createHash("sha256").update(bytes).digest("hex")}.${kind.ext}`;
  const dir = uploadDir();
  fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  const full = path.join(/*turbopackIgnore: true*/ dir, name);
  if (!fs.existsSync(/*turbopackIgnore: true*/ full)) {
    // Write beside the target and rename, so a reader never sees a half-written file
    // under a name that promises those exact bytes.
    const tmp = `${full}.${process.pid}.tmp`;
    fs.writeFileSync(/*turbopackIgnore: true*/ tmp, bytes);
    fs.renameSync(/*turbopackIgnore: true*/ tmp, full);
  }
  return { ok: true, name, mime: kind.mime, bytes: bytes.length };
}

/** Remove a stored file. Missing is success — the caller wanted it gone. */
export function deleteImage(name: string) {
  const full = storedPath(name);
  if (!full) return;
  try { fs.unlinkSync(/*turbopackIgnore: true*/ full); } catch { /* already gone */ }
}

export function readImage(name: string): Buffer | null {
  const full = storedPath(name);
  if (!full) return null;
  try { return fs.readFileSync(/*turbopackIgnore: true*/ full); } catch { return null; }
}
