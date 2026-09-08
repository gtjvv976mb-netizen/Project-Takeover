import { NextResponse } from "next/server";
import { AuthError, verifySigned } from "./auth";
import { getListing } from "./db";
import type { Listing, SignedRequest } from "./types";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function handleError(e: unknown) {
  const status = e instanceof AuthError ? 401 : e instanceof HttpError ? e.status : 400;
  const message = e instanceof Error ? e.message : String(e);
  if (status >= 500) console.error(e);
  return json({ error: message }, status);
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function readSigned<T = Record<string, unknown>>(req: Request, action: string, listingId: string | null) {
  const body = (await req.json()) as { auth: SignedRequest } & T;
  const signer = verifySigned(body.auth, action, listingId);
  return { body, signer: signer.toBase58() };
}

export function requireListing(id: string): Listing {
  const l = getListing(id);
  if (!l) throw new HttpError(404, "Listing not found");
  return l;
}

export function requireStatus(l: Listing, ...allowed: Listing["status"][]) {
  if (!allowed.includes(l.status)) throw new HttpError(409, `Listing is ${l.status}; expected ${allowed.join(" or ")}`);
}
