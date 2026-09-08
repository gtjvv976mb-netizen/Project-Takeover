// Deterministic harbor layout. Positions are a pure function of the listing data,
// so the same market always produces the same harbor and the camera can fly to a
// berth without waiting for a render.
import type { Listing, ListingType } from "@/lib/types";

export const PIER_X: Record<ListingType, number> = {
  token_authority: -24,
  pump_creator: 0,
  offchain: 24,
};

export const PIER_COLOR: Record<ListingType, string> = {
  token_authority: "#46e5a0", // lime
  pump_creator: "#ff8a4c", // ember
  offchain: "#4cc7ff", // circuit
};

export const PIER_LABEL: Record<ListingType, string> = {
  token_authority: "PIER 1 · TOKEN AUTHORITIES",
  pump_creator: "PIER 2 · PUMP.FUN OWNERSHIP",
  offchain: "PIER 3 · PROJECTS, SITES & SOCIALS",
};

export const PIER_ORDER: ListingType[] = ["token_authority", "pump_creator", "offchain"];

export const BERTH_SPACING = 8;
export const BERTH_OFFSET = 6; // distance from pier centreline to a moored hull
export const FIRST_BERTH_Z = 14;
export const MIN_BERTHS = 8;

/** Where berth `i` on a pier sits. Even berths to port, odd to starboard. */
export function berthPosition(type: ListingType, i: number): [number, number, number] {
  const side = i % 2 === 0 ? -1 : 1;
  const row = Math.floor(i / 2);
  return [PIER_X[type] + side * BERTH_OFFSET, 0, FIRST_BERTH_Z + row * BERTH_SPACING];
}

export interface Vessel {
  listing: Listing;
  type: ListingType;
  berth: number;
  position: [number, number, number];
  /** Ships face the open water (down -Z, toward the lock). Port side moored in. */
  heading: number;
  color: string;
  /** 0.75 … 1.6 — hull size scales with price, clamped so nothing dwarfs the pier. */
  scale: number;
  phase: number; // per-hull bob offset, derived from the id so it never re-randomises
}

export interface HarborLayout {
  vessels: Vessel[];
  /** Berths per pier, at least MIN_BERTHS, so the harbor never looks broken when empty. */
  berthCount: Record<ListingType, number>;
  /** Sold listings, moored out past the breakwater as a visible track record. */
  anchorage: { listing: Listing; position: [number, number, number]; scale: number }[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

function hashPhase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

/** Bigger price → bigger hull, but on a log curve so a 500 SOL ship is only ~2x a 0.5 SOL one. */
function hullScale(lamports: number): number {
  const sol = Math.max(lamports / 1e9, 0.01);
  return Math.min(1.6, Math.max(0.75, 0.75 + Math.log10(sol + 1) * 0.55));
}

export function buildLayout(listings: Listing[]): HarborLayout {
  const moored = listings.filter((l) => l.status === "active" || l.status === "paid" || l.status === "draft");
  const sold = listings.filter((l) => l.status === "sold");

  const vessels: Vessel[] = [];
  const berthCount: Record<ListingType, number> = {
    token_authority: MIN_BERTHS,
    pump_creator: MIN_BERTHS,
    offchain: MIN_BERTHS,
  };

  for (const type of PIER_ORDER) {
    // Cheapest nearest the quay, dearest out at the pier head: the pier reads as a price axis.
    const onPier = moored
      .filter((l) => l.type === type)
      .sort((a, b) => a.priceLamports - b.priceLamports || a.id.localeCompare(b.id));
    berthCount[type] = Math.max(MIN_BERTHS, onPier.length + 2);
    onPier.forEach((listing, i) => {
      const position = berthPosition(type, i);
      vessels.push({
        listing,
        type,
        berth: i,
        position,
        heading: i % 2 === 0 ? Math.PI : 0,
        color: PIER_COLOR[type],
        scale: hullScale(listing.priceLamports),
        phase: hashPhase(listing.id),
      });
    });
  }

  const anchorage = sold.slice(0, 40).map((listing, i) => {
    const spread = (i - (Math.min(sold.length, 40) - 1) / 2) * 9;
    const drift = hashPhase(listing.id);
    return {
      listing,
      position: [spread + drift * 6 - 3, 0, -80 - drift * 34] as [number, number, number],
      scale: hullScale(listing.priceLamports) * 0.85,
    };
  });

  const deepestRow = Math.max(...PIER_ORDER.map((t) => Math.ceil(berthCount[t] / 2)));
  return {
    vessels,
    berthCount,
    anchorage,
    bounds: {
      minX: PIER_X.token_authority - 22,
      maxX: PIER_X.offchain + 22,
      minZ: -60,
      maxZ: FIRST_BERTH_Z + deepestRow * BERTH_SPACING + 22,
    },
  };
}

export function pierLength(berths: number): number {
  return FIRST_BERTH_Z + Math.ceil(berths / 2) * BERTH_SPACING + 6;
}
