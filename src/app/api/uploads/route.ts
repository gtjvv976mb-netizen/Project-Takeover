import { verifySigned } from "@/lib/auth";
import { handleError, HttpError, json } from "@/lib/api-utils";
import { referencedImages } from "@/lib/db";
import { ACCEPTED_LABEL, MAX_UPLOAD_BYTES, saveImage, sweepOrphans } from "@/lib/uploads";
import type { SignedRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * A cover uploaded before the thing it covers exists.
 *
 * Every listing must arrive with a cover image, and a listing is created in one signed
 * JSON request — so the picture cannot ride along inside it. The seller sends the file
 * here first, gets back the name it was stored under, and passes that name when they
 * create the listing. The names are content hashes, so the same picture uploaded twice
 * costs one file, and a name is useless to anyone who did not produce the bytes.
 *
 * The obvious risk is somebody filling the disk with pictures that never become listings.
 * Three things bound it: the upload is signed, so it is attributable; a wallet may only
 * upload so often; and anything still unreferenced a day later is swept away below.
 */

/** Per-wallet upload times, newest last. In memory on purpose — see RATE below. */
const recent = new Map<string, number[]>();
/**
 * A speed bump, not sybil resistance: wallets are free, so anybody determined enough can
 * spread uploads across new keys. It is here to stop one wallet from looping, which is
 * what an accident or a bored script actually looks like. Losing the map on restart is
 * fine for that job and not worth a table.
 */
const RATE = { windowMs: 10 * 60_000, max: 30 };

function rateLimit(wallet: string) {
  const now = Date.now();
  const hits = (recent.get(wallet) ?? []).filter((t) => now - t < RATE.windowMs);
  if (hits.length >= RATE.max) {
    throw new HttpError(429, "That is a lot of images in a short time. Wait a few minutes and try again.");
  }
  hits.push(now);
  recent.set(wallet, hits);
  // Keep the map from growing without bound on a long-lived process.
  if (recent.size > 5_000) for (const [k, v] of recent) if (v[v.length - 1] < now - RATE.windowMs) recent.delete(k);
}

/** Sweep at most once an hour, on the back of a request rather than on a timer. */
let sweptAt = 0;
function maybeSweep() {
  if (Date.now() - sweptAt < 60 * 60_000) return;
  sweptAt = Date.now();
  try { sweepOrphans(referencedImages()); } catch { /* the upload itself still succeeded */ }
}

export async function POST(req: Request) {
  try {
    const claimed = Number(req.headers.get("content-length") ?? 0);
    if (Number.isFinite(claimed) && claimed > MAX_UPLOAD_BYTES * 1.1) {
      throw new HttpError(413, "That image is over the 2 MB limit.");
    }

    let form: FormData;
    try { form = await req.formData(); }
    catch { throw new HttpError(400, "Could not read the upload."); }

    const authRaw = form.get("auth");
    if (typeof authRaw !== "string") throw new HttpError(400, "Missing signature");
    let auth: SignedRequest;
    try { auth = JSON.parse(authRaw) as SignedRequest; }
    catch { throw new HttpError(400, "Malformed signature"); }
    // Signed over no listing, because there is no listing yet. The signature proves a
    // person with a wallet asked for this, which is all that is being claimed here.
    const signer = verifySigned(auth, "upload", null).toBase58();
    rateLimit(signer);

    const file = form.get("file");
    if (!file || typeof file === "string") throw new HttpError(400, `Attach an image (${ACCEPTED_LABEL}).`);
    if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "That image is over the 2 MB limit.");

    const saved = saveImage(Buffer.from(await file.arrayBuffer()));
    if (!saved.ok) throw new HttpError(400, saved.error);

    maybeSweep();
    return json({ image: saved.name, url: `/api/uploads/${saved.name}`, bytes: saved.bytes });
  } catch (e) {
    return handleError(e);
  }
}
