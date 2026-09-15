/**
 * The BPF upgradeable loader's instructions, hand-encoded.
 *
 * The loader speaks bincode: a u32 little-endian instruction tag, then the fields. Kept in
 * one place so the script that writes a buffer and the test that proves the encoding
 * against the real loader are looking at the same bytes. web3.js 1.x has no helper for
 * this loader — its `BpfLoader` is the old, non-upgradeable one.
 */
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

export const BPF_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

/** `UpgradeableLoaderState::Buffer` header: u32 tag + Option<Pubkey> authority (1 + 32). */
export const BUFFER_HEADER = 37;

const tag = (n) => { const d = Buffer.alloc(4); d.writeUInt32LE(n); return d; };

/** `InitializeBuffer` (0). Accounts: buffer (writable), authority. */
export const initializeBufferIx = (buffer, authority) => new TransactionInstruction({
  programId: BPF_LOADER,
  keys: [
    { pubkey: buffer, isSigner: false, isWritable: true },
    { pubkey: authority, isSigner: false, isWritable: false },
  ],
  data: tag(0),
});

/** `Write { offset: u32, bytes: Vec<u8> }` (1). A bincode Vec is a u64 length then the bytes. */
export const writeIx = (buffer, authority, offset, bytes) => {
  const d = Buffer.alloc(4 + 4 + 8 + bytes.length);
  d.writeUInt32LE(1, 0);
  d.writeUInt32LE(offset, 4);
  d.writeBigUInt64LE(BigInt(bytes.length), 8);
  Buffer.from(bytes).copy(d, 16);
  return new TransactionInstruction({
    programId: BPF_LOADER,
    keys: [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: d,
  });
};

/**
 * `SetAuthority` (4). Accounts: the buffer or program-data account (writable), its current
 * authority (signer), the new authority. The same instruction moves a program's upgrade
 * authority; scripts/upgrade-authority.mjs uses it that way.
 */
export const setAuthorityIx = (account, current, next) => new TransactionInstruction({
  programId: BPF_LOADER,
  keys: [
    { pubkey: account, isSigner: false, isWritable: true },
    { pubkey: current, isSigner: true, isWritable: false },
    { pubkey: next, isSigner: false, isWritable: false },
  ],
  data: tag(4),
});
