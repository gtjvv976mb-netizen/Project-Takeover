import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import type { SignedRequest } from "./types";

export const AUTH_WINDOW_MS = 5 * 60 * 1000;

/** Canonical message the wallet signs. Must match buildAuthMessage on the client. */
export function buildAuthMessage(action: string, listingId: string | null, timestamp: number): string {
  return `Takeover\naction: ${action}\nlisting: ${listingId ?? "-"}\nts: ${timestamp}`;
}

export function verifySigned(req: SignedRequest, action: string, listingId: string | null): PublicKey {
  if (!req || typeof req.pubkey !== "string" || typeof req.signature !== "string" || typeof req.timestamp !== "number") {
    throw new AuthError("Missing signature fields");
  }
  if (Math.abs(Date.now() - req.timestamp) > AUTH_WINDOW_MS) throw new AuthError("Signature expired");
  let pk: PublicKey;
  try { pk = new PublicKey(req.pubkey); } catch { throw new AuthError("Bad pubkey"); }
  const msg = new TextEncoder().encode(buildAuthMessage(action, listingId, req.timestamp));
  let sig: Uint8Array;
  try { sig = bs58.decode(req.signature); } catch { throw new AuthError("Bad signature encoding"); }
  if (!nacl.sign.detached.verify(msg, sig, pk.toBytes())) throw new AuthError("Invalid signature");
  return pk;
}

export class AuthError extends Error {
  status = 401;
}

export function isAdmin(pubkey: string): boolean {
  const admins = (process.env.ADMIN_PUBKEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return admins.includes(pubkey);
}
