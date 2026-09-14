import { ACCEPT_ATTR, MAX_UPLOAD_BYTES } from "@/lib/uploads-shared";

/**
 * Make a picture the seller chose into one the service will take.
 *
 * Covers are compulsory, which only works if the picture somebody actually has on their
 * phone or their desktop goes up without an argument. A photo off a modern camera is
 * 4-12 MB and a PNG exported from a design tool is easily larger, so a plain 2 MB limit
 * refused most real images — and refused them after the upload, with the reason rendered
 * somewhere the seller was not looking. That is not a limit, it is a wall.
 *
 * So the browser does the work first: anything oversized, or larger than a cover is ever
 * displayed at, is drawn into a canvas at cover proportions and re-encoded. Only the
 * bytes that survive that are sent. A file already small enough is passed through
 * untouched, so a seller who prepared a tidy 300 KB banner keeps exactly their bytes.
 *
 * Everything here runs in the browser. The server still enforces its own limit and still
 * decides what is an image by reading the bytes — this only avoids a refusal nobody
 * needed to see.
 */

/** Wider than any frame the site shows a cover in, on a 2x display. */
const MAX_EDGE = 2000;
/** Leaves room under the service's limit for the encoder to overshoot a little. */
const TARGET_BYTES = Math.floor(MAX_UPLOAD_BYTES * 0.9);

const ACCEPTED = new Set(ACCEPT_ATTR.split(","));

export type PreparedImage = { file: File; note: string | null };

/** Read a file into something drawable, preferring the decoder that does not need the DOM. */
async function decode(file: File): Promise<{ width: number; height: number; draw: CanvasImageSource; done: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(file);
    return { width: bmp.width, height: bmp.height, draw: bmp, done: () => bmp.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      // HEIC is the likely one here: an iPhone photo dropped straight in, which Safari can
      // read and other browsers cannot. Name a way out rather than just saying no.
      el.onerror = () => reject(new Error("This browser could not read that file as an image. If it is a HEIC photo, export it as JPEG first."));
      el.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight, draw: img, done: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * The picture to upload, and a line to show the seller if it was changed on the way.
 * Throws only when the file is not an image at all — never merely because it is big.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  // Already small and already a format we serve: send the seller's own bytes.
  if (file.size <= TARGET_BYTES && ACCEPTED.has(file.type)) return { file, note: null };

  // A GIF may be animated, and drawing it to a canvas would silently keep one frame.
  // Better to send it as it is and let the size limit speak than to destroy it quietly.
  if (file.type === "image/gif") {
    if (file.size <= MAX_UPLOAD_BYTES) return { file, note: null };
    throw new Error(`That GIF is ${(file.size / 1024 / 1024).toFixed(1)} MB and the limit is 2 MB. Animated images cannot be shrunk here — try a still picture, or a smaller GIF.`);
  }

  const { width, height, draw, done } = await decode(file);
  try {
    if (!width || !height) throw new Error("That file could not be read as an image.");
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser could not process the image. Try one under 2 MB.");
    ctx.drawImage(draw, 0, 0, w, h);

    // WebP first: it keeps transparency and is markedly smaller than JPEG at the same
    // quality. Browsers that cannot encode it hand back a PNG, which the fallback catches.
    for (const [type, qualities] of [["image/webp", [0.86, 0.72, 0.58]], ["image/jpeg", [0.85, 0.7, 0.55]]] as const) {
      for (const q of qualities) {
        const blob = await toBlob(canvas, type, q);
        if (!blob || blob.type !== type) break; // this encoder is not available
        if (blob.size <= TARGET_BYTES) {
          const ext = type === "image/webp" ? "webp" : "jpg";
          const shrunk = new File([blob], `cover.${ext}`, { type });
          const note = `Resized to ${w}×${h} and compressed to ${(blob.size / 1024).toFixed(0)} KB so it would fit.`;
          return { file: shrunk, note };
        }
      }
    }

    throw new Error("That image could not be compressed under 2 MB. Try a smaller one.");
  } finally {
    done();
  }
}
