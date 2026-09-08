"use client";
import bs58 from "bs58";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { buildAuthMessage } from "@/lib/auth";
import type { AppConfig, Listing, ListingEvent, SignedRequest, TokenInfo } from "@/lib/types";

async function parse<T>(res: Response): Promise<T> {
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error ?? `Request failed (${res.status})`);
  return j as T;
}

export async function signAuth(wallet: WalletContextState, action: string, listingId: string | null): Promise<SignedRequest> {
  if (!wallet.publicKey || !wallet.signMessage) throw new Error("Connect a wallet that supports message signing");
  const timestamp = Date.now();
  const sig = await wallet.signMessage(new TextEncoder().encode(buildAuthMessage(action, listingId, timestamp)));
  return { pubkey: wallet.publicKey.toBase58(), signature: bs58.encode(sig), timestamp };
}

export async function signedPost<T = Listing>(wallet: WalletContextState, url: string, action: string, listingId: string | null, body: Record<string, unknown> = {}): Promise<T> {
  const auth = await signAuth(wallet, action, listingId);
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, auth }) });
  return parse<T>(res);
}

export const api = {
  config: () => fetch("/api/config").then((r) => parse<AppConfig>(r)),
  token: (mint: string) => fetch(`/api/token/${mint}`).then((r) => parse<TokenInfo>(r)),
  listings: (q: Record<string, string> = {}) => fetch(`/api/listings?${new URLSearchParams(q)}`).then((r) => parse<Listing[]>(r)),
  listing: (id: string) => fetch(`/api/listings/${id}`).then((r) => parse<{ listing: Listing; events: ListingEvent[] }>(r)),
};
