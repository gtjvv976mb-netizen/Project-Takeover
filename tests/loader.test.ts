/**
 * The hand-encoded loader instructions, run against the real BPF upgradeable loader.
 *
 * scripts/write-buffer.mjs uploads a program to a buffer without the Solana CLI, which
 * means it encodes the loader's bincode by hand. A wrong byte there does not fail
 * loudly — it produces a buffer that looks fine and holds the wrong program. So the
 * encoders are exercised here through bankrun, whose bank carries the genuine loader:
 * create and initialise a buffer, write it in chunks the way the script does, read the
 * bytes back, and hand the authority to a "vault". If this passes, the only thing the
 * script adds on top is a send loop.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { start, type ProgramTestContext } from "solana-bankrun";
import { Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
// The script's own module, so the test proves the bytes the script will send.
import { BPF_LOADER, BUFFER_HEADER, initializeBufferIx, setAuthorityIx, writeIx } from "../scripts/loader-ix.mjs";

let ctx: ProgramTestContext;
let payer: Keypair;
const vault = Keypair.generate().publicKey;

async function send(tx: Transaction, signers: Keypair[]) {
  tx.recentBlockhash = ctx.lastBlockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(...signers);
  await ctx.banksClient.processTransaction(tx);
}

before(async () => {
  ctx = await start([], []);
  payer = Keypair.generate();
  ctx.setAccount(payer.publicKey, {
    lamports: 100 * LAMPORTS_PER_SOL, data: new Uint8Array(0), owner: SystemProgram.programId, executable: false, rentEpoch: 0,
  });
});

describe("writing a program buffer by hand", () => {
  // Not a real program: the loader does not validate ELF on Write, only on Upgrade, and
  // what is under test is that bytes land where the script says they will. Random bytes
  // make an off-by-one in the offset visible where a repeated pattern would hide it.
  const program = crypto.randomBytes(2_950); // not a multiple of the chunk, so the tail is short
  const CHUNK = 900;
  const bufferKp = Keypair.generate();
  const buffer = bufferKp.publicKey;

  it("creates and initialises a buffer owned by the loader", async () => {
    const space = BUFFER_HEADER + program.length;
    const rent = Number((await ctx.banksClient.getRent()).minimumBalance(BigInt(space)));
    await send(new Transaction().add(
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: buffer, lamports: rent, space, programId: BPF_LOADER }),
      initializeBufferIx(buffer, payer.publicKey),
    ), [payer, bufferKp]);
    const acct = await ctx.banksClient.getAccount(buffer);
    assert.ok(acct && new PublicKey(acct.owner).equals(BPF_LOADER));
    // Buffer state: tag 1, then Some(authority)
    const d = Buffer.from(acct!.data);
    assert.equal(d.readUInt32LE(0), 1, "tag should be Buffer");
    assert.equal(d[4], 1, "authority should be Some");
    assert.equal(new PublicKey(d.subarray(5, 37)).toBase58(), payer.publicKey.toBase58());
  });

  it("writes every chunk to its offset, including a short last one", async () => {
    for (let offset = 0; offset < program.length; offset += CHUNK) {
      const bytes = program.subarray(offset, offset + CHUNK);
      await send(new Transaction().add(writeIx(buffer, payer.publicKey, offset, bytes)), [payer]);
    }
    const acct = await ctx.banksClient.getAccount(buffer);
    const onchain = Buffer.from(acct!.data).subarray(BUFFER_HEADER, BUFFER_HEADER + program.length);
    assert.equal(
      crypto.createHash("sha256").update(onchain).digest("hex"),
      crypto.createHash("sha256").update(program).digest("hex"),
      "the buffer should hold exactly the file",
    );
  });

  it("is idempotent: writing a chunk again changes nothing", async () => {
    // The same bytes to the same place, as two half-writes rather than one: bankrun's
    // blockhash never moves, so a byte-identical transaction would be rejected as a
    // duplicate before the loader saw it. What matters is that a re-run of the script
    // — which rewrites everything — leaves the buffer exactly as it was.
    const half = CHUNK / 2;
    await send(new Transaction().add(
      writeIx(buffer, payer.publicKey, CHUNK, program.subarray(CHUNK, CHUNK + half)),
      writeIx(buffer, payer.publicKey, CHUNK + half, program.subarray(CHUNK + half, 2 * CHUNK)),
    ), [payer]);
    const acct = await ctx.banksClient.getAccount(buffer);
    const onchain = Buffer.from(acct!.data).subarray(BUFFER_HEADER, BUFFER_HEADER + program.length);
    assert.ok(onchain.equals(program));
  });

  it("refuses a write from anyone but the authority", async () => {
    const stranger = Keypair.generate();
    ctx.setAccount(stranger.publicKey, { lamports: LAMPORTS_PER_SOL, data: new Uint8Array(0), owner: SystemProgram.programId, executable: false, rentEpoch: 0 });
    const tx = new Transaction().add(writeIx(buffer, stranger.publicKey, 0, Buffer.alloc(8, 0xff)));
    tx.recentBlockhash = ctx.lastBlockhash; tx.feePayer = stranger.publicKey; tx.sign(stranger);
    await assert.rejects(ctx.banksClient.processTransaction(tx));
    const acct = await ctx.banksClient.getAccount(buffer);
    assert.ok(Buffer.from(acct!.data).subarray(BUFFER_HEADER, BUFFER_HEADER + 8).equals(program.subarray(0, 8)), "nothing should have changed");
  });

  it("hands the buffer's authority to the vault", async () => {
    await send(new Transaction().add(setAuthorityIx(buffer, payer.publicKey, vault)), [payer]);
    const acct = await ctx.banksClient.getAccount(buffer);
    const d = Buffer.from(acct!.data);
    assert.equal(new PublicKey(d.subarray(5, 37)).toBase58(), vault.toBase58());
    // and the old authority can no longer write
    const tx = new Transaction().add(writeIx(buffer, payer.publicKey, 0, Buffer.alloc(8, 0xff)));
    tx.recentBlockhash = ctx.lastBlockhash; tx.feePayer = payer.publicKey; tx.sign(payer);
    await assert.rejects(ctx.banksClient.processTransaction(tx));
  });
});
