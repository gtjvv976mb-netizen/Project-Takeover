import { isAdmin, verifySigned } from "@/lib/auth";
import { handleError, HttpError, json, readSigned, requireListing } from "@/lib/api-utils";
import { imageRefCount, setListingImage, type ImageSlot } from "@/lib/db";
import { ACCEPTED_LABEL, deleteImage, MAX_UPLOAD_BYTES, saveImage } from "@/lib/uploads";
import type { SignedRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * One of the listing's two pictures: the wide `banner` on its own page, or the `thumb`
 * on its card in the market. They are different shapes doing different jobs, so they are
 * stored and replaced separately.
 *
 * Only the seller may set either, and the signature is over this listing's id, so a
 * signature collected for one listing cannot be replayed against another.
 */
function slotOf(form: FormData): ImageSlot {
  const raw = form.get("slot");
  if (raw === "thumb") return "thumb";
  // Anything else is the banner, which is what the only caller sent before this existed.
  return "banner";
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const listing = requireListing(id);

    // Refuse an oversized body before `formData()` pulls it into memory. The header is
    // the client's claim, so the real bytes are measured again below — this only stops
    // an honest large upload from being buffered first.
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
    const signer = verifySigned(auth, "image", id).toBase58();
    if (signer !== listing.seller) throw new HttpError(403, "Only the seller can change this listing's pictures");

    const file = form.get("file");
    if (!file || typeof file === "string") throw new HttpError(400, `Attach an image (${ACCEPTED_LABEL}).`);
    if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "That image is over the 2 MB limit.");

    const saved = saveImage(Buffer.from(await file.arrayBuffer()));
    if (!saved.ok) throw new HttpError(400, saved.error);

    const slot = slotOf(form);
    const previous = slot === "thumb" ? listing.thumb : listing.image;
    setListingImage(id, saved.name, slot);
    // Drop the old picture only once nothing else points at it: identical uploads share
    // one file, so another listing — or this listing's other slot — may still use these
    // exact bytes.
    if (previous && previous !== saved.name && imageRefCount(previous) === 0) deleteImage(previous);

    return json({ slot, image: saved.name, url: `/api/uploads/${saved.name}`, bytes: saved.bytes });
  } catch (e) {
    return handleError(e);
  }
}

/** Remove one picture. The seller may; so may an admin, for something that should not be up. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const listing = requireListing(id);
    const { body, signer } = await readSigned<{ slot?: string }>(req, "image", id);
    if (signer !== listing.seller && !isAdmin(signer)) {
      throw new HttpError(403, "Only the seller can change this listing's pictures");
    }
    const slot: ImageSlot = body.slot === "thumb" ? "thumb" : "banner";
    const current = slot === "thumb" ? listing.thumb : listing.image;
    if (current) {
      setListingImage(id, null, slot);
      if (imageRefCount(current) === 0) deleteImage(current);
    }
    return json({ slot, image: null });
  } catch (e) {
    return handleError(e);
  }
}
