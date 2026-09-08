/**
 * The Metaplex path, tested separately because it needs the Token Metadata program
 * loaded into the test bank.
 *
 * This is the riskiest instruction in the program: the metadata update authority is
 * moved with a hand-built Metaplex instruction signed by the listing PDA. If the
 * account list or the byte layout is wrong, a seller could hand over a token whose
 * name and image the buyer cannot change.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { BN, Program } from "@coral-xyz/anchor";
import type { TakeoverEscrow } from "../target/types/takeover_escrow";
import { BankrunProvider } from "anchor-bankrun";
import { startAnchor, type ProgramTestContext } from "solana-bankrun";
import { Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createInitializeMintInstruction, MINT_SIZE, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import idl from "../target/idl/takeover_escrow.json" with { type: "json" };

const METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const AUTH_METADATA = 4;
const MINT_RENT = 1_461_600;

let ctx: ProgramTestContext;
let program: Program<TakeoverEscrow>;
let admin: Keypair, arbitrator: Keypair, treasury: Keypair, seller: Keypair, buyer: Keypair;
let configPda: PublicKey, mint: PublicKey, metadata: PublicKey, listing: PublicKey;

const id = (() => { const b = Buffer.alloc(16); Buffer.from("md-test").copy(b); return [...b]; })();

const fund = (kp: Keypair) => ctx.setAccount(kp.publicKey, {
  lamports: 50 * LAMPORTS_PER_SOL, data: new Uint8Array(0),
  owner: SystemProgram.programId, executable: false, rentEpoch: 0,
});

/** Metaplex CreateMetadataAccountV3 with a minimal DataV2. */
function createMetadataIx(metadataPda: PublicKey, mintKey: PublicKey, authority: PublicKey, payer: PublicKey) {
  const str = (s: string) => { const b = Buffer.from(s, "utf8"); const len = Buffer.alloc(4); len.writeUInt32LE(b.length); return Buffer.concat([len, b]); };
  const data = Buffer.concat([
    Buffer.from([33]),                        // CreateMetadataAccountV3
    str("Test Coin"), str("TEST"), str(""),   // name, symbol, uri
    Buffer.from([0, 0]),                      // seller_fee_basis_points u16
    Buffer.from([0]),                         // creators: None
    Buffer.from([0]),                         // collection: None
    Buffer.from([0]),                         // uses: None
    Buffer.from([1]),                         // is_mutable
    Buffer.from([0]),                         // collection_details: None
  ]);
  return {
    programId: METADATA_PROGRAM,
    keys: [
      { pubkey: metadataPda, isSigner: false, isWritable: true },
      { pubkey: mintKey, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },  // mint authority
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },  // update authority
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  };
}

/** Read the update authority straight out of the metadata account (byte 1..33). */
async function updateAuthority(): Promise<string> {
  const acct = await ctx.banksClient.getAccount(metadata);
  assert.ok(acct, "metadata account should exist");
  return new PublicKey(Buffer.from(acct.data).subarray(1, 33)).toBase58();
}

before(async () => {
  admin = Keypair.generate(); arbitrator = Keypair.generate(); treasury = Keypair.generate();
  seller = Keypair.generate(); buyer = Keypair.generate();

  ctx = await startAnchor(".", [{ name: "mpl_token_metadata", programId: METADATA_PROGRAM }], []);
  program = new Program(idl as TakeoverEscrow, new BankrunProvider(ctx));
  [admin, arbitrator, treasury, seller, buyer].forEach(fund);

  configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];
  await program.methods.initialize(200, arbitrator.publicKey, treasury.publicKey)
    .accounts({ config: configPda, authority: admin.publicKey, systemProgram: SystemProgram.programId })
    .signers([admin]).rpc();

  // a mint with metadata, both authorities held by the seller
  const mintKp = Keypair.generate();
  mint = mintKp.publicKey;
  metadata = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM.toBuffer(), mint.toBuffer()], METADATA_PROGRAM,
  )[0];

  const tx = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: seller.publicKey, newAccountPubkey: mint, space: MINT_SIZE, lamports: MINT_RENT, programId: TOKEN_PROGRAM_ID }),
    createInitializeMintInstruction(mint, 6, seller.publicKey, seller.publicKey),
    createMetadataIx(metadata, mint, seller.publicKey, seller.publicKey),
  );
  tx.recentBlockhash = ctx.lastBlockhash;
  tx.feePayer = seller.publicKey;
  tx.sign(seller, mintKp);
  await ctx.banksClient.processTransaction(tx);

  listing = PublicKey.findProgramAddressSync(
    [Buffer.from("listing"), seller.publicKey.toBuffer(), Buffer.from(id)], program.programId,
  )[0];
});

describe("metadata update authority changes hands", () => {
  it("starts with the seller holding it", async () => {
    assert.equal(await updateAuthority(), seller.publicKey.toBase58());
  });

  it("moves into the program's custody when escrowed", async () => {
    await program.methods.createListing(id, { tokenAuthority: {} }, new BN(LAMPORTS_PER_SOL), AUTH_METADATA, 7)
      .accounts({ config: configPda, listing, seller: seller.publicKey, mint, systemProgram: SystemProgram.programId })
      .signers([seller]).rpc();
    await program.methods.escrowAuthority(AUTH_METADATA)
      .accounts({ listing, seller: seller.publicKey, mint, metadata, tokenMetadataProgram: METADATA_PROGRAM, tokenProgram: TOKEN_PROGRAM_ID })
      .signers([seller]).rpc();

    assert.equal(await updateAuthority(), listing.toBase58(), "program holds the update authority");
    const l = await program.account.listing.fetch(listing);
    assert.deepEqual(l.status, { active: {} }, "listing goes live once the only promised authority is in");
  });

  it("rejects a forged metadata account", async () => {
    const fake = Keypair.generate().publicKey;
    try {
      await program.methods.buyToken()
        .accounts({ config: configPda, listing, buyer: buyer.publicKey, seller: seller.publicKey, treasury: treasury.publicKey, mint, metadata: fake, tokenMetadataProgram: METADATA_PROGRAM, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
        .signers([buyer]).rpc();
      assert.fail("should have rejected a metadata account that is not the canonical PDA");
    } catch (e) {
      assert.ok(String((e as Error).message).includes("BadMetadataAccount"), String((e as Error).message));
    }
  });

  it("lands on the buyer when the sale settles", async () => {
    await program.methods.buyToken()
      .accounts({ config: configPda, listing, buyer: buyer.publicKey, seller: seller.publicKey, treasury: treasury.publicKey, mint, metadata, tokenMetadataProgram: METADATA_PROGRAM, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .signers([buyer]).rpc();
    assert.equal(await updateAuthority(), buyer.publicKey.toBase58(), "buyer can now change name and image");
  });
});
