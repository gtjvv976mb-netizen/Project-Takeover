/**
 * The parts of the upload rules the browser also needs.
 *
 * `uploads.ts` reaches for node:fs, so a client component cannot import it without
 * dragging the filesystem into the browser bundle. These two constants are the ones the
 * picker needs, kept here and imported by the server module so the limit a form enforces
 * and the limit the route enforces can never drift apart.
 */

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB

/** What the file dialog offers. The real check reads the bytes; this only filters. */
export const ACCEPT_ATTR = "image/png,image/jpeg,image/webp,image/gif";

export const ACCEPTED_LABEL = "PNG, JPEG, WebP or GIF";
