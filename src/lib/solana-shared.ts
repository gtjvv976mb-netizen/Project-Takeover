// Code shared by the browser and the server: program ids, PDAs, raw instruction builders.
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import type { PumpControl, PumpControlVerdict } from "./types";

export const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
export const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
/** pump.fun's fee program: owns every creator-fee sharing config. */
export const PUMP_FEES_PROGRAM_ID = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
/** PumpSwap, where a coin trades after graduating. Its pool carries the creator role then. */
export const PUMP_AMM_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
/** Squads v4, the multisig the upgrade and config authorities are meant to live in. */
export const SQUADS_V4_PROGRAM_ID = new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");

export function metadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  )[0];
}

export function bondingCurvePda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mint.toBuffer()], PUMP_PROGRAM_ID)[0];
}

/** Seeds ["sharing-config", mint] on the fee program, per pump.fun's published interface. */
export function sharingConfigPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("sharing-config"), mint.toBuffer()], PUMP_FEES_PROGRAM_ID)[0];
}

/** The pump program's signer for the pool it creates at graduation. */
export function poolAuthorityPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("pool-authority"), mint.toBuffer()], PUMP_PROGRAM_ID)[0];
}

/**
 * The canonical PumpSwap pool for a graduated coin: index 0, created by the pump
 * program's pool authority, quoted in whatever the curve was quoted in (SOL, or USDC
 * since pump.fun added USDC curves).
 */
export function canonicalPoolPda(mint: PublicKey, quoteMint: PublicKey = WSOL_MINT): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), Buffer.from([0, 0]), poolAuthorityPda(mint).toBuffer(), mint.toBuffer(), quoteMint.toBuffer()],
    PUMP_AMM_PROGRAM_ID,
  )[0];
}

/** Parse the on-chain Metaplex Token Metadata account (v1 layout). */
export function parseMetadata(data: Uint8Array) {
  const buf = Buffer.from(data);
  let o = 1; // key
  const updateAuthority = new PublicKey(buf.subarray(o, o + 32)); o += 32;
  const mint = new PublicKey(buf.subarray(o, o + 32)); o += 32;
  const readStr = () => {
    const len = buf.readUInt32LE(o); o += 4;
    const s = buf.subarray(o, o + len).toString("utf8").replace(/\0+$/g, "").trim(); o += len;
    return s;
  };
  const name = readStr();
  const symbol = readStr();
  const uri = readStr();
  return { updateAuthority, mint, name, symbol, uri };
}

/**
 * Parse the pump.fun BondingCurve account.
 *
 * Layout after the 8-byte discriminator: virtual_token_reserves, virtual_sol_reserves,
 * real_token_reserves, real_sol_reserves and token_total_supply as u64s, then a
 * `complete` flag at byte 48. `creator` was appended after that in 2025.
 *
 * The virtual reserves are what set the price; the real ones are what has actually been
 * put in and taken out.
 */
export function parseBondingCurve(data: Uint8Array) {
  const buf = Buffer.from(data);
  if (buf.length < 49) return null;
  const u64 = (o: number) => buf.readBigUInt64LE(o);
  const virtualTokenReserves = u64(8);
  const virtualSolReserves = u64(16);
  const realTokenReserves = u64(24);
  const realSolReserves = u64(32);
  const tokenTotalSupply = u64(40);
  const complete = buf[48] === 1;
  const creator = buf.length >= 81 ? new PublicKey(buf.subarray(49, 81)) : null;
  // Appended later still: is_mayhem_mode (81), is_cashback_coin (82), then the quote mint
  // at 83, because curves can now be quoted in USDC as well as SOL. Older accounts stop
  // before it, in which case SOL is the only thing a curve could have been quoted in.
  // SOL curves store the all-zero address there, so "no quote mint" means SOL either way.
  const quoteRaw = buf.length >= 115 ? new PublicKey(buf.subarray(83, 115)) : null;
  const quoteMint = quoteRaw && !quoteRaw.equals(PublicKey.default) ? quoteRaw : null;
  return {
    complete,
    creator,
    quoteMint,
    virtualTokenReserves,
    virtualSolReserves,
    realTokenReserves,
    realSolReserves,
    tokenTotalSupply,
  };
}

/** SOL per token from the virtual reserves. SOL carries 9 decimals, pump.fun mints 6. */
export function priceFromCurve(c: { virtualSolReserves: bigint; virtualTokenReserves: bigint }, decimals = 6): number | null {
  if (c.virtualTokenReserves === BigInt(0)) return null;
  const sol = Number(c.virtualSolReserves) / 1e9;
  const tokens = Number(c.virtualTokenReserves) / 10 ** decimals;
  return tokens > 0 ? sol / tokens : null;
}

/**
 * Metaplex `UpdateMetadataAccountV2` with only new_update_authority set.
 * Data layout: u8 discriminator (15) | Option<DataV2> = None (0) | Option<Pubkey> = Some(1)+32 bytes
 *              | Option<bool> primary_sale_happened = None (0) | Option<bool> is_mutable = None (0)
 */
export function updateMetadataAuthorityIx(mint: PublicKey, currentAuthority: PublicKey, newAuthority: PublicKey) {
  const data = Buffer.concat([Buffer.from([15, 0, 1]), newAuthority.toBuffer(), Buffer.from([0, 0])]);
  return new TransactionInstruction({
    programId: METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadataPda(mint), isSigner: false, isWritable: true },
      { pubkey: currentAuthority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

/** Anchor discriminator of pump.fun's SharingConfig account, from its published interface. */
const SHARING_CONFIG_DISCRIMINATOR = Buffer.from([216, 74, 9, 0, 56, 140, 93, 75]);
/** Anchor discriminator of PumpSwap's Pool account. */
const POOL_DISCRIMINATOR = Buffer.from([241, 154, 109, 4, 17, 177, 109, 188]);

/**
 * Parse a pump.fun fee-sharing config.
 *
 * Layout after the discriminator: bump u8, version u8, status (a one-byte enum: 0 Paused,
 * 1 Active), mint, admin, admin_revoked bool, then a Borsh vec of {address, share_bps u16}.
 * Returns null for anything that is not a sharing config, so a caller can pass whatever
 * the creator field pointed at and let the answer say what it was.
 */
export function parseSharingConfig(data: Uint8Array): PumpControl["config"] {
  const buf = Buffer.from(data);
  if (buf.length < 80 || !buf.subarray(0, 8).equals(SHARING_CONFIG_DISCRIMINATOR)) return null;
  const version = buf[9];
  const statusByte = buf[10];
  const mint = new PublicKey(buf.subarray(11, 43));
  const admin = new PublicKey(buf.subarray(43, 75));
  const adminRevoked = buf[75] === 1;
  const count = buf.readUInt32LE(76);
  const shareholders: { address: string; shareBps: number }[] = [];
  let o = 80;
  for (let i = 0; i < count && o + 34 <= buf.length; i++) {
    shareholders.push({ address: new PublicKey(buf.subarray(o, o + 32)).toBase58(), shareBps: buf.readUInt16LE(o + 32) });
    o += 34;
  }
  void mint;
  return {
    address: "", // filled in by the caller, which knows the account's address
    admin: admin.toBase58(),
    adminRevoked,
    status: statusByte === 1 ? "active" : statusByte === 0 ? "paused" : "unknown",
    version,
    shareholders,
  };
}

/**
 * Parse a PumpSwap pool far enough to read who collects its creator fees.
 *
 * Layout after the discriminator: pool_bump u8, index u16, creator, base_mint, quote_mint,
 * lp_mint, pool_base_token_account, pool_quote_token_account, lp_supply u64, coin_creator.
 */
export function parsePool(data: Uint8Array) {
  const buf = Buffer.from(data);
  if (buf.length < 243 || !buf.subarray(0, 8).equals(POOL_DISCRIMINATOR)) return null;
  return {
    baseMint: new PublicKey(buf.subarray(43, 75)),
    quoteMint: new PublicKey(buf.subarray(75, 107)),
    coinCreator: new PublicKey(buf.subarray(211, 243)),
  };
}

/**
 * Does `wallet` hold the creator role outright?
 *
 * "Outright" means every basis point of the creator fee and the power to change that.
 * A wallet that is admin but shares the fee has not been handed the coin; a wallet that
 * collects all the fee but is not admin can lose it tomorrow; and a revoked config can
 * never be handed to anyone, so nothing about it is sellable.
 */
export function pumpControlOf(control: PumpControl | null | undefined, wallet: string): PumpControlVerdict {
  if (!control) return { full: false, shareBps: 0, isAdmin: false, revoked: false, reason: "The coin's creator could not be read from the chain." };
  if (control.kind === "wallet") {
    const full = control.raw === wallet;
    return {
      full, shareBps: full ? 10_000 : 0, isAdmin: full, revoked: false,
      reason: full ? "This wallet is the on-chain creator." : `The on-chain creator is ${control.raw}, not this wallet.`,
    };
  }
  const cfg = control.config;
  if (!cfg) return { full: false, shareBps: 0, isAdmin: false, revoked: false, reason: "The creator field points at a fee-sharing config that could not be read." };
  const shareBps = cfg.shareholders.filter((s) => s.address === wallet).reduce((a, s) => a + s.shareBps, 0);
  const isAdmin = cfg.admin === wallet && !cfg.adminRevoked;
  if (cfg.adminRevoked) {
    return { full: false, shareBps, isAdmin: false, revoked: true, reason: "Fee sharing on this coin has been permanently locked. The creator role can no longer be transferred to anyone." };
  }
  if (isAdmin && shareBps === 10_000) {
    return { full: true, shareBps, isAdmin, revoked: false, reason: "This wallet is the fee-sharing admin and receives the entire creator fee." };
  }
  const others = cfg.shareholders.filter((s) => s.address !== wallet && s.shareBps > 0).length;
  const parts: string[] = [];
  parts.push(isAdmin ? "This wallet is the fee-sharing admin" : `The fee-sharing admin is ${cfg.admin}`);
  parts.push(`this wallet receives ${(shareBps / 100).toFixed(2)}% of the creator fee`);
  if (others) parts.push(`${others} other wallet${others > 1 ? "s" : ""} share the rest`);
  return { full: false, shareBps, isAdmin, revoked: false, reason: parts.join("; ") + "." };
}
