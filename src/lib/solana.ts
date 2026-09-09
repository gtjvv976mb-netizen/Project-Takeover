// SERVER ONLY — and deliberately powerless.
//
// This module reads the chain and nothing else. It holds no key, signs no transaction
// and can move no funds. Every action that transfers money or ownership is signed by
// the user's own wallet and executed by the on-chain program.
import "server-only";
import {
  Connection, PublicKey,
} from "@solana/web3.js";
import { getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { AppConfig, AuthorityKind, TokenInfo } from "./types";
import { PROGRAM_ID } from "./program";
import { bondingCurvePda, metadataPda, parseBondingCurve, parseMetadata, priceFromCurve } from "./solana-shared";

export const NETWORK = (process.env.SOLANA_NETWORK ?? "devnet") as AppConfig["network"];
/** Server-side RPC. May carry an API key; never sent to the browser. */
export const RPC_URL = process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL ?? `https://api.${NETWORK}.solana.com`;
/** Endpoint handed to wallets in the browser. Keep this one keyless / CORS-open. */
export const BROWSER_RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? `https://api.${NETWORK}.solana.com`;
export const FEE_BPS = Number(process.env.FEE_BPS ?? 500); // 5%, the program's hard ceiling
/** Receives the platform fee. Public: it never signs anything on this server. */
export const TREASURY = new PublicKey(process.env.TREASURY_PUBKEY ?? "11111111111111111111111111111111");
/** Roughly the SOL a pump.fun curve holds at graduation. Configurable: it has changed. */
export const GRADUATION_SOL = Number(process.env.PUMP_GRADUATION_SOL ?? 85);
/** This project's own pump.fun coin. Everything token-related hides until it is set. */
export const TOKEN_MINT = process.env.NEXT_PUBLIC_TOKEN_MINT?.trim() || null;
export const TOKEN_SYMBOL = process.env.NEXT_PUBLIC_TOKEN_SYMBOL?.trim() || null;

export const APP_NAME = process.env.APP_NAME ?? process.env.NEXT_PUBLIC_APP_NAME ?? "Project: Takeover";

declare global {
  var __takeoverConn: Connection | undefined;
}

export function connection(): Connection {
  if (!globalThis.__takeoverConn) globalThis.__takeoverConn = new Connection(RPC_URL, "confirmed");
  return globalThis.__takeoverConn;
}


export function appConfig(): AppConfig {
  return {
    network: NETWORK,
    rpcUrl: BROWSER_RPC_URL,
    programId: PROGRAM_ID.toBase58(),
    tokenMint: TOKEN_MINT,
    tokenSymbol: TOKEN_SYMBOL,
    treasury: TREASURY.toBase58(),
    feeBps: FEE_BPS,
    appName: APP_NAME,
  };
}

export function feeFor(priceLamports: number): number {
  return Math.floor((priceLamports * FEE_BPS) / 10_000);
}

// ---------- token inspection ----------

async function tokenProgramFor(mint: PublicKey): Promise<PublicKey> {
  const info = await connection().getAccountInfo(mint);
  if (!info) throw new Error("Mint account not found");
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  throw new Error("Account is not an SPL token mint");
}

export async function fetchTokenInfo(mintStr: string): Promise<TokenInfo> {
  const mint = new PublicKey(mintStr);
  const conn = connection();
  const program = await tokenProgramFor(mint);
  const m = await getMint(conn, mint, "confirmed", program);
  const info: TokenInfo = {
    mint: mintStr,
    decimals: m.decimals,
    supply: m.supply.toString(),
    mintAuthority: m.mintAuthority?.toBase58() ?? null,
    freezeAuthority: m.freezeAuthority?.toBase58() ?? null,
    updateAuthority: null,
    pump: null,
  };
  const [meta, curve] = await conn.getMultipleAccountsInfo([metadataPda(mint), bondingCurvePda(mint)]);
  if (meta) {
    const p = parseMetadata(meta.data);
    info.updateAuthority = p.updateAuthority.toBase58();
    info.name = p.name; info.symbol = p.symbol; info.uri = p.uri;
    if (p.uri) {
      try {
        const res = await fetch(p.uri, { signal: AbortSignal.timeout(4000) });
        const j = (await res.json()) as {
          image?: string; name?: string; symbol?: string; description?: string;
          twitter?: string; telegram?: string; website?: string;
        };
        if (j.image) info.image = j.image;
        if (!info.name && j.name) info.name = j.name;
        if (!info.symbol && j.symbol) info.symbol = j.symbol;
        if (j.description) info.description = j.description;
        // Creators publish these themselves when they launch, so they are the honest
        // way to reach a dev who never signed up here.
        const link = (v?: string) => (v && /^https?:\/\//.test(v) ? v.slice(0, 300) : undefined);
        const socials = { twitter: link(j.twitter), telegram: link(j.telegram), website: link(j.website) };
        if (socials.twitter || socials.telegram || socials.website) info.socials = socials;
      } catch { /* off-chain metadata unreachable; fine */ }
    }
  }
  if (curve) {
    const c = parseBondingCurve(curve.data);
    const priceSol = c && !c.complete ? priceFromCurve(c, m.decimals) : null;
    const supply = Number(m.supply) / 10 ** m.decimals;
    const solRaised = c ? Number(c.realSolReserves) / 1e9 : null;
    info.pump = {
      bondingCurve: bondingCurvePda(mint).toBase58(),
      creator: c?.creator?.toBase58() ?? null,
      complete: c?.complete ?? null,
      priceSol,
      marketCapSol: priceSol !== null ? priceSol * supply : null,
      solRaised,
      // pump.fun has moved this threshold before, so treat it as a hint, not a fact.
      progress: solRaised !== null ? Math.min(1, solRaised / GRADUATION_SOL) : null,
    };
  }
  try {
    const largest = await conn.getTokenLargestAccounts(mint);
    const top = largest.value.map((a) => ({ address: a.address.toBase58(), amount: a.amount }));
    const supply = Number(m.supply);
    const top10 = top.slice(0, 10).reduce((acc, a) => acc + Number(a.amount), 0);
    info.holders = { top, top10Share: supply > 0 ? top10 / supply : 0 };
  } catch { info.holders = null; }
  return info;
}

/** Which of the requested authorities are currently held by `holder`. */
export async function authoritiesHeldBy(mintStr: string, wanted: AuthorityKind[], holder: PublicKey) {
  const t = await fetchTokenInfo(mintStr);
  const h = holder.toBase58();
  const held: AuthorityKind[] = [];
  const missing: AuthorityKind[] = [];
  for (const a of wanted) {
    const cur = a === "mint" ? t.mintAuthority : a === "freeze" ? t.freezeAuthority : t.updateAuthority;
    (cur === h ? held : missing).push(a);
  }
  return { held, missing, token: t };
}

// ---------- escrow-side transactions ----------








// ---------- payment verification ----------


/** For pump.fun listings: is the bonding curve's creator now `wallet`? */
export async function pumpCreatorIs(mintStr: string, wallet: string): Promise<{ ok: boolean; creator: string | null }> {
  const info = await connection().getAccountInfo(bondingCurvePda(new PublicKey(mintStr)));
  if (!info) return { ok: false, creator: null };
  const c = parseBondingCurve(info.data);
  const creator = c?.creator?.toBase58() ?? null;
  return { ok: creator === wallet, creator };
}
