export type ListingType = "token_authority" | "pump_creator" | "offchain";

export type ListingStatus =
  | "draft" // created; token_authority listings wait for authorities to be escrowed
  | "active" // listed and purchasable
  | "paid" // buyer's SOL is in escrow, waiting for handoff (pump_creator / offchain)
  | "sold" // settled: seller paid, asset delivered
  | "cancelled"
  | "disputed"
  | "refunded";

export type AuthorityKind = "mint" | "freeze" | "metadata_update";

export interface TokenAuthorityAsset {
  mint: string;
  authorities: AuthorityKind[]; // which authorities are included in the sale
}

export interface PumpCreatorAsset {
  mint: string;
  pumpUrl: string;
}

export interface OffchainAsset {
  category: "project" | "website" | "domain" | "socials" | "wallet_bundle" | "other";
  links: string[];
  deliverables: string; // what the buyer receives, in the seller's words
}

export type ListingAsset = TokenAuthorityAsset | PumpCreatorAsset | OffchainAsset;

export interface TokenInfo {
  mint: string;
  name?: string;
  symbol?: string;
  uri?: string;
  image?: string;
  decimals?: number;
  supply?: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  updateAuthority: string | null;
  pump?: {
    bondingCurve: string;
    creator: string | null;
    complete: boolean | null;
  } | null;
  holders?: {
    top: { address: string; amount: string }[]; // largest token accounts (max 20)
    top10Share: number; // 0..1 share of supply held by the 10 largest accounts
  } | null;
}

export interface BuilderProfile {
  wallet: string;
  name: string;
  bio: string;
  github: string;
  x: string;
  website: string;
  updatedAt: number;
}

export interface BuilderStats {
  listed: number;
  sold: number;
  earnedLamports: number;
  firstListedAt: number | null;
}

export const OFFCHAIN_CATEGORY_LABELS: Record<OffchainAsset["category"], string> = {
  project: "Full project (code + token + site)",
  website: "Website / landing page",
  domain: "Domain name",
  socials: "X / Telegram / Discord community",
  wallet_bundle: "Everything a project wallet controls",
  other: "Other",
};

export interface Listing {
  id: string;
  type: ListingType;
  title: string;
  description: string;
  priceLamports: number;
  seller: string;
  buyer: string | null;
  status: ListingStatus;
  asset: ListingAsset;
  mint: string | null;
  token: TokenInfo | null; // snapshot at creation time (name/symbol/image)
  escrowSig: string | null;
  paymentSig: string | null;
  settlementSig: string | null;
  deliveryNote: string | null;
  disputeReason: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ListingEvent {
  id: number;
  listingId: string;
  kind: string;
  data: Record<string, unknown>;
  createdAt: number;
}

export interface AppConfig {
  network: "devnet" | "mainnet-beta" | "testnet";
  rpcUrl: string;
  /** The on-chain escrow program. Funds live in accounts it owns; no key exists for them. */
  programId: string;
  /** Where the platform fee goes. */
  treasury: string;
  feeBps: number;
  appName: string;
}

export interface SignedRequest {
  pubkey: string;
  signature: string; // base58
  timestamp: number; // ms
}

export const LAMPORTS_PER_SOL = 1_000_000_000;

export function formatSol(lamports: number, digits = 3): string {
  return (lamports / LAMPORTS_PER_SOL).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

export function shortKey(key: string | null | undefined, n = 4): string {
  if (!key) return "—";
  return `${key.slice(0, n)}…${key.slice(-n)}`;
}

export const TYPE_LABELS: Record<ListingType, string> = {
  token_authority: "Token authorities",
  pump_creator: "pump.fun coin ownership",
  offchain: "Site / socials / other",
};

export const STATUS_LABELS: Record<ListingStatus, string> = {
  draft: "Awaiting escrow",
  active: "For sale",
  paid: "Paid · awaiting handoff",
  sold: "Sold",
  cancelled: "Cancelled",
  disputed: "Disputed",
  refunded: "Refunded",
};
