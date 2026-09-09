// Shared between browser and server: program id, PDA derivation, and the mapping
// between the database's listing ids and the on-chain accounts they point at.
//
// The IDL is committed under src/idl/ rather than read from target/, because target/ is
// a build artefact that is not in git and the app must build from a clean clone.
// scripts/build-program.sh refreshes this copy whenever the program is rebuilt.
import { PublicKey } from "@solana/web3.js";
import idl from "../idl/takeover_escrow.json";
import type { AuthorityKind, ListingStatus, ListingType } from "./types";

export const IDL = idl;
export const PROGRAM_ID = new PublicKey(idl.address);

export const AUTH_BIT: Record<AuthorityKind, number> = {
  mint: 1 << 0,
  freeze: 1 << 1,
  metadata_update: 1 << 2,
};

export function authoritiesToBits(list: AuthorityKind[]): number {
  return list.reduce((acc, a) => acc | AUTH_BIT[a], 0);
}

export function bitsToAuthorities(bits: number): AuthorityKind[] {
  return (Object.keys(AUTH_BIT) as AuthorityKind[]).filter((a) => bits & AUTH_BIT[a]);
}

/** The program's `Kind` enum, as Anchor expects it in an instruction argument. */
export const KIND_ARG: Record<ListingType, Record<string, Record<string, never>>> = {
  token_authority: { tokenAuthority: {} },
  pump_creator: { pumpCreator: {} },
  offchain: { offchain: {} },
};

/** Statuses as the program orders them, mapped back onto the site's vocabulary. */
export const ON_CHAIN_STATUS: ListingStatus[] = [
  "draft",
  "active",
  "paid",
  "sold",
  "cancelled",
  "disputed",
  "refunded",
];

/**
 * Map the program's Status enum onto the site's vocabulary.
 *
 * The raw BorshAccountsCoder keeps Rust's capitalisation ({ Active: {} }) while the
 * typed Program client lower-cases it ({ active: {} }), so normalise before matching.
 */
export function statusFromAccount(s: Record<string, unknown>): ListingStatus {
  const key = (Object.keys(s)[0] ?? "").toLowerCase();
  const map: Record<string, ListingStatus> = {
    draft: "draft",
    active: "active",
    funded: "paid",
    completed: "sold",
    cancelled: "cancelled",
    disputed: "disputed",
    refunded: "refunded",
  };
  return map[key] ?? "draft";
}

/**
 * A listing's 16-byte on-chain id. The database id is a short hex string, so it is
 * padded into the fixed-width array the program uses as a PDA seed. Deterministic in
 * both directions, so a row and its account always find each other.
 */
export function listingIdBytes(id: string): Uint8Array {
  const out = new Uint8Array(16);
  const raw = new TextEncoder().encode(id);
  out.set(raw.subarray(0, 16));
  return out;
}

export function configPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];
}

export function listingPda(seller: PublicKey, id: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("listing"), seller.toBuffer(), Buffer.from(listingIdBytes(id))],
    PROGRAM_ID,
  )[0];
}

export const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

export function metadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID,
  )[0];
}
