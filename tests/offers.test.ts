/**
 * Adversarial tests for funded offers — unsolicited, escrowed bids on tokens nobody
 * has listed.
 *
 * The thing that must hold: a bid is real money that only the genuine authority holder
 * can take, and that the buyer can always get back.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { BN, Program, type Idl } from "@coral-xyz/anchor";
import { BankrunProvider } from "anchor-bankrun";
import { startAnchor, type ProgramTestContext, Clock } from "solana-bankrun";
import { Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createInitializeMintInstruction, MINT_SIZE, TOKEN_PROGRAM_ID, unpackMint } from "@solana/spl-token";
import idl from "../src/idl/takeover_escrow.json" with { type: "json" };

const AUTH_MINT = 1, AUTH_FREEZE = 2;
const FEE_BPS = 200;
const PRICE = 3 * LAMPORTS_PER_SOL;

let ctx: ProgramTestContext;
let program: Program<Idl>;
let admin: Keypair, arbitrator: Keypair, treasury: Keypair;
let owner: Keypair, bidder: Keypair, stranger: Keypair;
let configPda: PublicKey;

const idBytes = (s: string) => { const b = Buffer.alloc(16); Buffer.from(s).copy(b); return [...b]; };
const offerPda = (buyer: PublicKey, id: number[]) =>
  PublicKey.findProgramAddressSync([Buffer.from("offer"), buyer.toBuffer(), Buffer.from(id)], program.programId)[0];

function fund(...kps: Keypair[]) {
  for (const kp of kps) {
    ctx.setAccount(kp.publicKey, {
      lamports: 60 * LAMPORTS_PER_SOL, data: Buffer.alloc(0),
      owner: SystemProgram.programId, executable: false,
    });
  }
}

/** A mint whose mint and freeze authority belong to `owner` — nobody has listed it. */
async function newMint(): Promise<PublicKey> {
  const mint = Keypair.generate();
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: owner.publicKey, newAccountPubkey: mint.publicKey,
      space: MINT_SIZE, lamports: 1461600, programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(mint.publicKey, 6, owner.publicKey, owner.publicKey),
  );
  tx.recentBlockhash = ctx.lastBlockhash;
  tx.feePayer = owner.publicKey;
  tx.sign(owner, mint);
  await ctx.banksClient.processTransaction(tx);
  return mint.publicKey;
}

async function readMint(mint: PublicKey) {
  const info = await ctx.banksClient.getAccount(mint);
  return unpackMint(mint, { ...info!, data: Buffer.from(info!.data) } as never);
}

async function jump(seconds: number) {
  const c = await ctx.banksClient.getClock();
  ctx.setClock(new Clock(c.slot, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, c.unixTimestamp + BigInt(seconds)));
}

async function expectFail(p: Promise<unknown>, needle: string) {
  try { await p; assert.fail(`expected "${needle}" but it succeeded`); }
  catch (e) {
    const m = String((e as Error).message ?? e);
    assert.ok(m.includes(needle), `expected "${needle}" in:\n${m}`);
  }
}

before(async () => {
  admin = Keypair.generate(); arbitrator = Keypair.generate(); treasury = Keypair.generate();
  owner = Keypair.generate(); bidder = Keypair.generate(); stranger = Keypair.generate();

  ctx = await startAnchor(".", [], []);
  // The provider's own wallet (bankrun's funded payer) covers transaction fees.
  // Every party below signs as an extra signer, which is what the program checks.
  const provider = new BankrunProvider(ctx);
  program = new Program(idl as Idl, provider);
  fund(admin, arbitrator, treasury, owner, bidder, stranger);

  configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];
  await program.methods.initialize(FEE_BPS, arbitrator.publicKey, treasury.publicKey)
    .accounts({ config: configPda, authority: admin.publicKey, systemProgram: SystemProgram.programId })
    .signers([admin]).rpc();
});

describe("a funded offer on a token nobody listed", () => {
  const id = idBytes("offer-happy");
  let mint: PublicKey, offer: PublicKey;

  it("locks the bidder's money when the offer is made", async () => {
    mint = await newMint();
    offer = offerPda(bidder.publicKey, id);
    const before = await ctx.banksClient.getBalance(bidder.publicKey);

    await program.methods.makeOffer(id, new BN(PRICE), AUTH_MINT | AUTH_FREEZE, 14)
      .accounts({ config: configPda, offer, buyer: bidder.publicKey, mint, systemProgram: SystemProgram.programId })
      .signers([bidder]).rpc();

    const after = await ctx.banksClient.getBalance(bidder.publicKey);
    assert.ok(before - after >= BigInt(PRICE), "the bid really left the bidder's wallet");
    const o = await program.account.offer.fetch(offer);
    assert.equal(o.escrowedLamports.toString(), String(PRICE));
    assert.deepEqual(o.status, { open: {} });
  });

  it("cannot be taken by someone who does not hold the authorities", async () => {
    await expectFail(
      program.methods.acceptOffer()
        .accounts({ config: configPda, offer, seller: stranger.publicKey, buyer: bidder.publicKey,
          treasury: treasury.publicKey, mint, metadata: null, tokenMetadataProgram: null, tokenProgram: TOKEN_PROGRAM_ID })
        .signers([stranger]).rpc(),
      "Error",
    );
  });

  it("cannot be taken by the bidder to launder their own money out", async () => {
    await expectFail(
      program.methods.acceptOffer()
        .accounts({ config: configPda, offer, seller: bidder.publicKey, buyer: bidder.publicKey,
          treasury: treasury.publicKey, mint, metadata: null, tokenMetadataProgram: null, tokenProgram: TOKEN_PROGRAM_ID })
        .signers([bidder]).rpc(),
      "Error",
    );
  });

  it("pays the owner and moves the controls in one instruction", async () => {
    const before = await ctx.banksClient.getBalance(owner.publicKey);
    await program.methods.acceptOffer()
      .accounts({ config: configPda, offer, seller: owner.publicKey, buyer: bidder.publicKey,
        treasury: treasury.publicKey, mint, metadata: null, tokenMetadataProgram: null, tokenProgram: TOKEN_PROGRAM_ID })
      .signers([owner]).rpc();
    const after = await ctx.banksClient.getBalance(owner.publicKey);

    const expected = BigInt(PRICE) - (BigInt(PRICE) * BigInt(FEE_BPS)) / 10_000n;
    assert.equal(after - before, expected, "owner is paid the bid minus the fee");

    const m = await readMint(mint);
    assert.equal(m.mintAuthority?.toBase58(), bidder.publicKey.toBase58(), "bidder now holds mint authority");
    assert.equal(m.freezeAuthority?.toBase58(), bidder.publicKey.toBase58(), "bidder now holds freeze authority");
  });

  it("cannot be accepted twice", async () => {
    await expectFail(
      program.methods.acceptOffer()
        .accounts({ config: configPda, offer, seller: owner.publicKey, buyer: bidder.publicKey,
          treasury: treasury.publicKey, mint, metadata: null, tokenMetadataProgram: null, tokenProgram: TOKEN_PROGRAM_ID })
        .signers([owner]).rpc(),
      "OfferNotOpen",
    );
  });
});

describe("a bidder can always get their money back", () => {
  const id = idBytes("offer-cancel");
  let mint: PublicKey, offer: PublicKey;

  before(async () => {
    mint = await newMint();
    offer = offerPda(bidder.publicKey, id);
    await program.methods.makeOffer(id, new BN(PRICE), AUTH_MINT, 1)
      .accounts({ config: configPda, offer, buyer: bidder.publicKey, mint, systemProgram: SystemProgram.programId })
      .signers([bidder]).rpc();
  });

  it("will not let a stranger withdraw someone else's bid before it expires", async () => {
    await expectFail(
      program.methods.cancelOffer()
        .accounts({ offer, signer: stranger.publicKey, buyer: bidder.publicKey })
        .signers([stranger]).rpc(),
      "OfferNotExpired",
    );
  });

  it("lets the bidder withdraw at any time, and returns the whole bid", async () => {
    const before = await ctx.banksClient.getBalance(bidder.publicKey);
    await program.methods.cancelOffer()
      .accounts({ offer, signer: bidder.publicKey, buyer: bidder.publicKey })
      .signers([bidder]).rpc();
    const after = await ctx.banksClient.getBalance(bidder.publicKey);
    assert.ok(after - before >= BigInt(PRICE) - 10_000n, "the full bid came back");
    const o = await program.account.offer.fetch(offer);
    assert.deepEqual(o.status, { cancelled: {} });
  });
});

describe("expiry", () => {
  const id = idBytes("offer-expire");
  let mint: PublicKey, offer: PublicKey;

  before(async () => {
    mint = await newMint();
    offer = offerPda(bidder.publicKey, id);
    await program.methods.makeOffer(id, new BN(PRICE), AUTH_MINT, 1)
      .accounts({ config: configPda, offer, buyer: bidder.publicKey, mint, systemProgram: SystemProgram.programId })
      .signers([bidder]).rpc();
  });

  it("cannot be accepted once it has expired", async () => {
    await jump(86_400 + 60);
    await expectFail(
      program.methods.acceptOffer()
        .accounts({ config: configPda, offer, seller: owner.publicKey, buyer: bidder.publicKey,
          treasury: treasury.publicKey, mint, metadata: null, tokenMetadataProgram: null, tokenProgram: TOKEN_PROGRAM_ID })
        .signers([owner]).rpc(),
      "OfferExpired",
    );
  });

  it("can be cleaned up by anyone once expired, returning the money to the bidder", async () => {
    const before = await ctx.banksClient.getBalance(bidder.publicKey);
    await program.methods.cancelOffer()
      .accounts({ offer, signer: stranger.publicKey, buyer: bidder.publicKey })
      .signers([stranger]).rpc();
    const after = await ctx.banksClient.getBalance(bidder.publicKey);
    assert.equal(after - before, BigInt(PRICE), "the bidder got it all back, without lifting a finger");
  });

  it("refuses a bid whose window is out of range", async () => {
    const bad = idBytes("offer-bad");
    await expectFail(
      program.methods.makeOffer(bad, new BN(PRICE), AUTH_MINT, 9999)
        .accounts({ config: configPda, offer: offerPda(bidder.publicKey, bad), buyer: bidder.publicKey, mint, systemProgram: SystemProgram.programId })
        .signers([bidder]).rpc(),
      "BadOfferWindow",
    );
  });
});
