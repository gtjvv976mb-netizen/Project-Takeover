// SERVER ONLY — and deliberately powerless.
//
// This module reads the chain and nothing else. It holds no key, signs no transaction
// and can move no funds. Every action that transfers money or ownership is signed by
// the user's own wallet and executed by the on-chain program.
import "server-only";
import {
  Connection, PublicKey, SystemProgram,
} from "@solana/web3.js";
import {
  unpackMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ExtensionType, AccountState,
  getExtensionTypes, getPermanentDelegate, getTransferHook, getMintCloseAuthority, getMetadataPointerState,
  getTransferFeeConfig, getDefaultAccountState, getNonTransferable, getTokenMetadata,
} from "@solana/spl-token";
import type { AppConfig, AuthorityKind, PumpControl, TokenExtensions, TokenInfo } from "./types";
import { PROGRAM_ID, configPda } from "./program";
import {
  bondingCurvePda, canonicalPoolPda, metadataPda, parseBondingCurve, parseMetadata, parsePool, parseSharingConfig,
  priceFromCurve, pumpControlOf, sharingConfigPda, SQUADS_V4_PROGRAM_ID, WSOL_MINT,
} from "./solana-shared";

/**
 * Read an environment variable, treating blank as absent.
 *
 * `??` only falls back on undefined, so an empty string sails straight through it and into
 * whatever parses the value next. `new Connection("")`, `new PublicKey("")` and
 * `new URL("")` all throw, and because these are module-level constants the throw happens
 * at import time: the process never starts and every request 502s. Render hands out empty
 * strings readily — a `sync: false` blueprint var with nothing set in the dashboard is one
 * way — so no deployment mistake should be able to take the whole site down.
 */
function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** Fall back rather than throw. A bad address costs a feature; a throw costs the site. */
function pubkeyOr(value: string | undefined, fallback: string): PublicKey {
  try {
    return new PublicKey(value ?? fallback);
  } catch {
    return new PublicKey(fallback);
  }
}

const httpOr = (value: string | undefined, fallback: string) =>
  value && /^https?:\/\//i.test(value) ? value : fallback;

export const NETWORK = (env("SOLANA_NETWORK") ?? "devnet") as AppConfig["network"];
/** Server-side RPC. May carry an API key; never sent to the browser. */
export const RPC_URL = httpOr(env("RPC_URL") ?? env("NEXT_PUBLIC_RPC_URL"), `https://api.${NETWORK}.solana.com`);
/** Endpoint handed to wallets in the browser. Keep this one keyless / CORS-open. */
export const BROWSER_RPC_URL = httpOr(env("NEXT_PUBLIC_RPC_URL"), `https://api.${NETWORK}.solana.com`);
/** Fallback only. The program's own config is authoritative — see `chainConfig()`. */
const feeRaw = Number(env("FEE_BPS") ?? 500);
export const FEE_BPS = Number.isFinite(feeRaw) && feeRaw >= 0 ? feeRaw : 500; // 5%, the program's hard ceiling
/** Fallback only, same reason. Public: it never signs anything on this server. */
export const TREASURY = pubkeyOr(env("TREASURY_PUBKEY"), "11111111111111111111111111111111");
/** Roughly the SOL a pump.fun curve holds at graduation. Configurable: it has changed. */
const gradRaw = Number(env("PUMP_GRADUATION_SOL") ?? 85);
export const GRADUATION_SOL = Number.isFinite(gradRaw) && gradRaw > 0 ? gradRaw : 85;
/** This project's own pump.fun coin. Everything token-related hides until it is set. */
export const TOKEN_MINT = env("NEXT_PUBLIC_TOKEN_MINT") ?? null;
export const TOKEN_SYMBOL = env("NEXT_PUBLIC_TOKEN_SYMBOL") ?? null;

export const APP_NAME = env("APP_NAME") ?? env("NEXT_PUBLIC_APP_NAME") ?? "Project: Takeover";

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
    upgradeAuthority: null,
    upgradeCustody: null,
  };
}

/** The loader that owns every upgradeable program's ProgramData account. */
const BPF_UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

/**
 * Read who may replace the escrow program.
 *
 * Returns null when the program is immutable — either because it was finalised, or
 * because it was deployed with a loader that has no upgrade path at all. Both mean the
 * same thing to a user: nobody can swap the code.
 *
 * ProgramData layout: 4-byte enum tag (3), 8-byte deploy slot, then Option<Pubkey> as a
 * 1-byte discriminant followed by 32 bytes.
 */
async function upgradeAuthority(): Promise<{ authority: string | null; custody: AppConfig["upgradeCustody"] }> {
  const [programData] = PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], BPF_UPGRADEABLE_LOADER);
  const info = await connection().getAccountInfo(programData, "confirmed");
  if (!info || info.data.length < 45) return { authority: null, custody: null };
  const hasAuthority = info.data[12] === 1;
  if (!hasAuthority) return { authority: null, custody: null };
  const authority = new PublicKey(info.data.subarray(13, 45));
  return { authority: authority.toBase58(), custody: await custodyOf(authority) };
}

/**
 * What kind of thing holds a key power.
 *
 * A plain wallet is one signature away from anything. A Squads multisig needs several,
 * and with a time lock the change is visible before it lands. The site states which it
 * is rather than letting "held by <address>" stand in for either.
 */
export async function custodyOf(authority: PublicKey): Promise<AppConfig["upgradeCustody"]> {
  const info = await connection().getAccountInfo(authority, "confirmed").catch(() => null);
  // A wallet that has never received lamports has no account at all; it is still a wallet.
  if (!info || info.owner.equals(SystemProgram.programId)) return "wallet";
  if (info.owner.equals(SQUADS_V4_PROGRAM_ID)) return "squads";
  return "program";
}

/**
 * The same config, but with the treasury and fee read from the program instead of from
 * this server's environment.
 *
 * These two used to come only from env vars, which meant rotating the treasury on chain
 * silently desynced the site: the browser kept building `buy_token` with the old address,
 * the program compared it against the new one, and every purchase failed with
 * BadTreasury. Worse, the e2e scripts read the treasury from the chain directly, so they
 * carried on passing while the actual website was broken.
 *
 * The program is the only thing that can be right about its own fee and treasury, so ask
 * it. Env vars stay as a fallback for the moment before `initialize` has ever run.
 */
let cached: { at: number; cfg: AppConfig } | null = null;

export async function chainConfig(): Promise<AppConfig> {
  const base = appConfig();
  if (cached && Date.now() - cached.at < 30_000) return cached.cfg;
  try {
    const [info, upgrader] = await Promise.all([
      connection().getAccountInfo(configPda(), "confirmed"),
      upgradeAuthority().catch(() => null),
    ]);
    if (info) {
      // discriminator(8) authority(32) arbitrator(32) treasury(32) fee_bps(2)
      const treasury = new PublicKey(info.data.subarray(72, 104)).toBase58();
      const feeBps = info.data.readUInt16LE(104);
      const cfg = { ...base, treasury, feeBps, upgradeAuthority: upgrader?.authority ?? null, upgradeCustody: upgrader?.custody ?? null };
      cached = { at: Date.now(), cfg };
      return cfg;
    }
  } catch {
    // fall through to the env-var view rather than failing the whole page
  }
  return base;
}

export function feeFor(priceLamports: number): number {
  return Math.floor((priceLamports * FEE_BPS) / 10_000);
}

// ---------- token inspection ----------

/**
 * Give up on a slow extra rather than let it hold the page hostage.
 *
 * Everything this guards is decoration — the holder distribution, an off-chain image. The
 * page is worth serving without them, and public devnet will happily spend eight seconds
 * in 429 backoff on a single call if allowed to.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise.catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), ms)),
  ]);
}

function tokenProgramOf(owner: PublicKey): PublicKey {
  if (owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  throw new Error("Account is not an SPL token mint");
}

/**
 * Read what a Token-2022 mint can do beyond minting and freezing.
 *
 * The mint and freeze authorities used to be the whole story, and for a legacy SPL mint
 * they still are. A Token-2022 mint can also carry a permanent delegate that moves any
 * holder's tokens, a transfer hook that runs its own program on every transfer, or a
 * close authority that can retire the mint and reinitialise the address. A buyer of "the
 * authorities" who does not also get those has bought less than it looks like.
 */
function inspectExtensions(m: ReturnType<typeof unpackMint>, program: PublicKey): TokenExtensions {
  if (!program.equals(TOKEN_2022_PROGRAM_ID)) {
    return {
      program: "spl-token", types: [], permanentDelegate: null, transferHookProgram: null, mintCloseAuthority: null,
      metadataPointer: null, transferFeeBps: null, defaultFrozen: false, nonTransferable: false, risks: [],
    };
  }
  const types = m.tlvData.length ? getExtensionTypes(m.tlvData) : [];
  const nameOf = (t: ExtensionType) => ExtensionType[t] ?? String(t);
  const pd = getPermanentDelegate(m)?.delegate ?? null;
  const hook = getTransferHook(m)?.programId ?? null;
  const close = getMintCloseAuthority(m)?.closeAuthority ?? null;
  const pointer = getMetadataPointerState(m)?.metadataAddress ?? null;
  const fee = getTransferFeeConfig(m)?.newerTransferFee.transferFeeBasisPoints ?? null;
  const frozen = getDefaultAccountState(m)?.state === AccountState.Frozen;
  const nonTransferable = getNonTransferable(m) !== null;
  const isDefault = (k: PublicKey | null) => !k || k.equals(PublicKey.default);

  const risks: TokenExtensions["risks"] = [];
  if (!isDefault(pd)) risks.push({ level: "critical", code: "permanent_delegate", text: `A permanent delegate (${pd!.toBase58()}) can move or burn any holder's tokens at any time, whoever holds the mint authority.` });
  if (!isDefault(hook)) risks.push({ level: "critical", code: "transfer_hook", text: `Every transfer runs program ${hook!.toBase58()}, which can block or tax transfers and is controlled outside the authorities being sold.` });
  if (!isDefault(close)) risks.push({ level: "critical", code: "mint_close_authority", text: `${close!.toBase58()} can close this mint and reinitialise the same address as a different token.` });
  if (nonTransferable) risks.push({ level: "critical", code: "non_transferable", text: "Tokens of this mint cannot be transferred at all." });
  if (frozen) risks.push({ level: "warn", code: "default_frozen", text: "New token accounts start frozen; the freeze authority must thaw each one before it can trade." });
  if (fee) risks.push({ level: "warn", code: "transfer_fee", text: `Every transfer pays a ${(fee / 100).toFixed(2)}% fee to the mint's fee authority.` });
  if (pointer && pointer.equals(m.address)) risks.push({ level: "warn", code: "inline_metadata", text: "Name, symbol and image live inside the mint itself, not in a Metaplex account, so the metadata authority is a Token-2022 authority." });

  return {
    program: "token-2022",
    types: types.map(nameOf),
    permanentDelegate: isDefault(pd) ? null : pd!.toBase58(),
    transferHookProgram: isDefault(hook) ? null : hook!.toBase58(),
    mintCloseAuthority: isDefault(close) ? null : close!.toBase58(),
    metadataPointer: pointer && !pointer.equals(PublicKey.default) ? pointer.toBase58() : null,
    transferFeeBps: fee ?? null,
    defaultFrozen: frozen,
    nonTransferable,
    risks,
  };
}

/**
 * Resolve the pump.fun creator field to who actually controls the role.
 *
 * Reads the curve's creator, or the canonical PumpSwap pool's coin creator once the coin
 * has graduated, since that is the account paying fees from then on. If the address it
 * finds is a fee-sharing config, the config is read and returned with it.
 */
export async function resolvePumpControl(mint: PublicKey, curve: NonNullable<ReturnType<typeof parseBondingCurve>>): Promise<PumpControl | null> {
  const conn = connection();
  let raw = curve.creator;
  let source: PumpControl["source"] = "bonding_curve";
  if (curve.complete) {
    const pool = await conn.getAccountInfo(canonicalPoolPda(mint, curve.quoteMint ?? WSOL_MINT), "confirmed").catch(() => null);
    const parsed = pool ? parsePool(pool.data) : null;
    if (parsed) { raw = parsed.coinCreator; source = "pool"; }
  }
  if (!raw) return null;
  const configPdaAddr = sharingConfigPda(mint);
  if (!raw.equals(configPdaAddr)) return { raw: raw.toBase58(), source, kind: "wallet", config: null };
  const info = await conn.getAccountInfo(configPdaAddr, "confirmed").catch(() => null);
  const config = info ? parseSharingConfig(info.data) : null;
  if (config) config.address = configPdaAddr.toBase58();
  return { raw: raw.toBase58(), source, kind: "sharing_config", config };
}

export async function fetchTokenInfo(mintStr: string): Promise<TokenInfo> {
  const mint = new PublicKey(mintStr);
  const conn = connection();

  // One fetch of the mint account, not two. `tokenProgramFor` read it to learn the owning
  // program and `getMint` then read the identical account again to parse it; unpacking the
  // bytes we already have saves a round trip on every token page.
  const mintInfo = await conn.getAccountInfo(mint, "confirmed");
  if (!mintInfo) throw new Error("Mint account not found");
  const program = tokenProgramOf(mintInfo.owner);
  const m = unpackMint(mint, mintInfo, program);

  const extensions = inspectExtensions(m, program);
  const info: TokenInfo = {
    mint: mintStr,
    decimals: m.decimals,
    supply: m.supply.toString(),
    mintAuthority: m.mintAuthority?.toBase58() ?? null,
    freezeAuthority: m.freezeAuthority?.toBase58() ?? null,
    updateAuthority: null,
    extensions,
    metadataSource: null,
    pump: null,
  };

  // Started now and awaited at the very end, so it overlaps the metadata read and the
  // off-chain image fetch instead of running after them. On public devnet this single call
  // spends eight seconds in rate-limit backoff, which is why it is also time-boxed: a
  // missing holder table is a far smaller problem than a page nobody waits for.
  const largestPromise = withTimeout(conn.getTokenLargestAccounts(mint), 2500);

  const [meta, curve] = await conn.getMultipleAccountsInfo([metadataPda(mint), bondingCurvePda(mint)]);
  if (meta) {
    const p = parseMetadata(meta.data);
    info.updateAuthority = p.updateAuthority.toBase58();
    info.metadataSource = "metaplex";
    info.name = p.name; info.symbol = p.symbol; info.uri = p.uri;
  } else if (extensions.metadataPointer === mintStr) {
    // Metadata inside the mint. Its update authority is a Token-2022 authority, which the
    // escrow program (a Metaplex CPI) cannot hold, so it is reported but never sold.
    const tm = await withTimeout(getTokenMetadata(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID), 2500);
    if (tm) {
      info.updateAuthority = tm.updateAuthority?.toBase58() ?? null;
      info.metadataSource = "token-2022";
      info.name = tm.name; info.symbol = tm.symbol; info.uri = tm.uri;
    }
  }
  {
    const uri = info.uri;
    if (uri) {
      try {
        const res = await fetch(uri, { signal: AbortSignal.timeout(2500) });
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
    const control = c ? await resolvePumpControl(mint, c).catch(() => null) : null;
    info.pump = {
      bondingCurve: bondingCurvePda(mint).toBase58(),
      creator: c?.creator?.toBase58() ?? null,
      control,
      complete: c?.complete ?? null,
      priceSol,
      marketCapSol: priceSol !== null ? priceSol * supply : null,
      solRaised,
      // pump.fun has moved this threshold before, so treat it as a hint, not a fact.
      progress: solRaised !== null ? Math.min(1, solRaised / GRADUATION_SOL) : null,
    };
  }
  const largest = await largestPromise;
  if (largest) {
    const top = largest.value.map((a) => ({ address: a.address.toBase58(), amount: a.amount }));
    const supply = Number(m.supply);
    const top10 = top.slice(0, 10).reduce((acc, a) => acc + Number(a.amount), 0);
    info.holders = { top, top10Share: supply > 0 ? top10 / supply : 0 };
  } else {
    // Timed out or rate-limited. The page renders; the holder table simply says nothing.
    info.holders = null;
  }
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


/**
 * For pump.fun listings: does `wallet` now hold the creator role outright?
 *
 * Reads the live chain, never the listing's snapshot, and looks through a fee-sharing
 * config rather than at it. This is what a buyer should see before releasing escrow.
 */
export async function pumpHandover(mintStr: string, wallet: string) {
  const mint = new PublicKey(mintStr);
  const info = await connection().getAccountInfo(bondingCurvePda(mint), "confirmed");
  const curve = info ? parseBondingCurve(info.data) : null;
  const control = curve ? await resolvePumpControl(mint, curve) : null;
  const verdict = pumpControlOf(control, wallet);
  return { control, verdict, complete: curve?.complete ?? null };
}
