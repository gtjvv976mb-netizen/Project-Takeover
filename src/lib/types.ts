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

/**
 * Who actually controls a pump.fun coin's creator role.
 *
 * Since pump.fun's fee-sharing update (January 2026) the `creator` field on the bonding
 * curve, and `coin_creator` on the graduated PumpSwap pool, can hold the address of a
 * *sharing config* rather than a wallet. The config has an admin who can split the
 * creator fees across up to ten wallets, hand the admin role on, or revoke it for good.
 * Comparing the raw field to a wallet therefore answers the wrong question: a seller can
 * "transfer" a config in which they still keep 90% of the fees. This resolves the field
 * to what it means.
 */
export interface PumpControl {
  /** The address the on-chain field actually holds. */
  raw: string;
  /** Which account it was read from. After graduation the pool is the one that pays. */
  source: "bonding_curve" | "pool";
  kind: "wallet" | "sharing_config";
  config: {
    address: string;
    admin: string;
    /** Once true the config can never change again — the role cannot be handed over. */
    adminRevoked: boolean;
    status: "active" | "paused" | "unknown";
    version: number;
    shareholders: { address: string; shareBps: number }[];
  } | null;
}

/** Whether one wallet holds the creator role outright, and if not, why not. */
export interface PumpControlVerdict {
  full: boolean;
  /** Basis points of the creator fee this wallet receives (10 000 = all of it). */
  shareBps: number;
  isAdmin: boolean;
  revoked: boolean;
  reason: string;
}

/**
 * Token-2022 extensions that change what "owning the authorities" means.
 *
 * A permanent delegate can move any holder's tokens, a transfer hook runs its own program
 * on every transfer, and a mint-close authority can close the mint and reinitialise the
 * address. None of those are visible from the mint and freeze authorities alone.
 */
export interface TokenExtensions {
  program: "spl-token" | "token-2022";
  /** Extension names as spl-token reports them, for display. */
  types: string[];
  permanentDelegate: string | null;
  transferHookProgram: string | null;
  mintCloseAuthority: string | null;
  /** Where the metadata pointer points; equal to the mint when metadata lives inside it. */
  metadataPointer: string | null;
  transferFeeBps: number | null;
  defaultFrozen: boolean;
  nonTransferable: boolean;
  risks: { level: "critical" | "warn"; code: string; text: string }[];
}

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
  /** Which program owns the mint and what extensions it carries. Absent on old snapshots. */
  extensions?: TokenExtensions;
  /** Where the update authority above was read from. Token-2022 mints can carry their own. */
  metadataSource?: "metaplex" | "token-2022" | null;
  pump?: {
    bondingCurve: string;
    /** The raw on-chain field. Prefer `control`, which says what it means. */
    creator: string | null;
    /** Resolved control of the creator role. Null when the curve could not be read. */
    control?: PumpControl | null;
    complete: boolean | null;
    /** SOL per token, from the bonding curve's virtual reserves. Null once graduated. */
    priceSol?: number | null;
    /** price x circulating supply, in SOL. */
    marketCapSol?: number | null;
    /** SOL actually sitting in the curve. */
    solRaised?: number | null;
    /** Rough progress toward graduating, 0 to 1. Approximate by design. */
    progress?: number | null;
  } | null;
  description?: string;
  /** Links the creator published in the token's own metadata. Public, self-declared. */
  socials?: { twitter?: string; telegram?: string; website?: string };
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

/** A token somebody wants to buy, whether or not its owner has ever visited the site. */
export interface WantedEntry {
  mint: string;
  addedBy: string;
  note: string;
  /** Indicative, non-binding, in lamports. 0 means "no figure given". */
  indicativeLamports: number;
  createdAt: number;
}

export interface WantedRow {
  mint: string;
  token: TokenInfo | null;
  interest: number;
  topIndicativeLamports: number;
  firstWantedAt: number;
  entries: WantedEntry[];
}

export interface AppConfig {
  network: "devnet" | "mainnet-beta" | "testnet";
  rpcUrl: string;
  /** The on-chain escrow program. Funds live in accounts it owns; no key exists for them. */
  programId: string;
  /** Where the platform fee goes. */
  treasury: string;
  /** The project's own pump.fun coin, if one has been launched. */
  tokenMint: string | null;
  tokenSymbol: string | null;
  feeBps: number;
  appName: string;
  /**
   * Who can replace the escrow program, or null once nobody can.
   *
   * The site's central claim is that no human can move an escrowed asset. That is true of
   * the escrow itself, and it stays true only while the code is not swapped underneath it,
   * so whoever holds this is worth stating rather than leaving for a reader to discover.
   * Null means the program has been made immutable and the claim is unconditional.
   */
  upgradeAuthority: string | null;
  /**
   * What kind of account holds the upgrade authority. "wallet" is a single key that can
   * replace the program alone; "squads" is a Squads v4 multisig, so an upgrade needs
   * several signers and, with a time lock, is visible before it lands; "program" is some
   * other program-owned account; null when immutable or unknown.
   */
  upgradeCustody: "wallet" | "squads" | "program" | null;
  /**
   * Is the escrow program actually deployed on the cluster this deployment points at?
   *
   * False means the site is claiming a network where nothing can be bought or sold: the
   * variable was changed before the program was deployed there, which looks like a
   * working marketplace and is not one. Null means the RPC did not answer in time, which
   * is not the same thing and must not be shown as a failure.
   */
  programDeployed: boolean | null;
  /** The Squads multisig the authorities are meant to live in, if one is declared. Public. */
  squadsMultisig: string | null;
  /**
   * That multisig's actual shape. A 1-of-1 is a single key with extra steps, so the
   * numbers are reported rather than the word: a reader can judge for themselves.
   */
  squads: { threshold: number; members: number; timeLockSeconds: number } | null;
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
