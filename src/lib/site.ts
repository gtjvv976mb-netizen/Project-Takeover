/**
 * The absolute base for canonical links, Open Graph URLs, robots.txt and the sitemap.
 *
 * Blank or scheme-less values make `new URL` throw, and this is read at import time, so a
 * mistyped variable would stop the site booting rather than just spoiling a link preview.
 * The fallback is the production domain, so a missing variable degrades to a correct
 * answer rather than a broken one.
 */
const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
export const SITE_URL = raw && /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, "") : "https://project-takeover.com";
