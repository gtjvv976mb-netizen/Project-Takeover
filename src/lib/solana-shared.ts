// Code shared by the browser and the server: program ids, PDAs, raw instruction builders.
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

export const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
export const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

export function metadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  )[0];
}

export function bondingCurvePda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mint.toBuffer()], PUMP_PROGRAM_ID)[0];
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

/** Parse the pump.fun BondingCurve account. `creator` was appended to the layout in 2025. */
export function parseBondingCurve(data: Uint8Array) {
  const buf = Buffer.from(data);
  if (buf.length < 49) return null;
  const complete = buf[48] === 1;
  const creator = buf.length >= 81 ? new PublicKey(buf.subarray(49, 81)) : null;
  return { complete, creator };
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
