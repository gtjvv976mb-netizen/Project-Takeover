// Shared by the browser and the server: what a domain proof looks like, without doing one.
//
// The DNS lookup itself is server-only (`src/lib/domain-proof.ts`), but the seller needs
// to see the exact record they must publish *before* anything has been checked, and the
// rules for what counts as a host are worth testing without a network.

/** The TXT value a domain must publish. Contains the wallet so one proof cannot be reused by another seller. */
export function expectedTxt(wallet: string): string {
  return `takeover-verify=${wallet}`;
}

/**
 * Reduce a URL to the registrable host, lowercased and without a port or `www.`.
 *
 * Returns null for anything with no TXT record a seller could own: an IP literal, a
 * single-label host, or a scheme we cannot reason about. Callers treat null as "not
 * verifiable", never as "failed" — a listing that links only to a Discord invite is
 * unproven, not fraudulent.
 */
export function hostOf(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":")) return null;
  return host;
}

export type DomainProof = {
  host: string;
  verified: boolean;
  /** Why not, when not. Shown to the seller, never used to accuse them publicly. */
  detail: string;
};
