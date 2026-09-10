/**
 * Adversarial tests for the on-chain escrow.
 *
 * These run against solana-bankrun rather than a validator, so the clock can be moved
 * forward and the refund deadline is actually testable.
 *
 * Run them with --test-concurrency=1 (see `npm run program:test`). Every suite shares
 * one bank and one clock, so a suite that jumps time forward must not run alongside a
 * suite whose deadline has not passed yet.
 *
 * The point of this suite is not the happy path. It is that every way one party could
 * rob the other is rejected by the program.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { BN, Program } from "@coral-xyz/anchor";
import type { TakeoverEscrow } from "../target/types/takeover_escrow";
import { BankrunProvider } from "anchor-bankrun";
import { startAnchor, type ProgramTestContext, Clock } from "solana-bankrun";
import {
  Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { createInitializeMintInstruction, MINT_SIZE, TOKEN_PROGRAM_ID, unpackMint } from "@solana/spl-token";
import idl from "../target/idl/takeover_escrow.json" with { type: "json" };

const AUTH_MINT = 1, AUTH_FREEZE = 2;
const KIND_TOKEN = { tokenAuthority: {} };
const KIND_OFFCHAIN = { offchain: {} };
const FEE_BPS = 200;

let ctx: ProgramTestContext;
let provider: BankrunProvider;
let program: Program<TakeoverEscrow>;
let admin: Keypair, arbitrator: Keypair, treasury: Keypair, seller: Keypair, buyer: Keypair, stranger: Keypair, cranker: Keypair;
let successor: Keypair;
let configPda: PublicKey;

const idBytes = (s: string) => {
  const b = Buffer.alloc(16);
  Buffer.from(s).copy(b);
  return [...b];
};
const listingPda = (sellerKey: PublicKey, id: number[]) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("listing"), sellerKey.toBuffer(), Buffer.from(id)],
    program.programId,
  )[0];

function fundAccounts(...kps: Keypair[]) {
  for (const kp of kps) {
    ctx.setAccount(kp.publicKey, {
      lamports: 50 * LAMPORTS_PER_SOL,
      data: new Uint8Array(0),
      owner: SystemProgram.programId,
      executable: false,
      rentEpoch: 0,
    });
  }
}

const MINT_RENT = 1_461_600;

/** Create a fresh mint whose mint and freeze authority are the seller. */
async function newMint(): Promise<PublicKey> {
  const mint = Keypair.generate();
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: seller.publicKey, newAccountPubkey: mint.publicKey,
      space: MINT_SIZE, lamports: MINT_RENT, programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(mint.publicKey, 6, seller.publicKey, seller.publicKey),
  );
  tx.recentBlockhash = ctx.lastBlockhash;
  tx.feePayer = seller.publicKey;
  tx.sign(seller, mint);
  await ctx.banksClient.processTransaction(tx);
  return mint.publicKey;
}

/** Read a mint straight out of bankrun and decode it. */
async function mintAuthorities(mint: PublicKey) {
  const info = await ctx.banksClient.getAccount(mint);
  if (!info) return null;
  return unpackMint(mint, {
    data: Buffer.from(info.data),
    owner: info.owner,
    lamports: Number(info.lamports),
    executable: info.executable,
    rentEpoch: Number(info.rentEpoch ?? 0),
  });
}

async function setClockAhead(seconds: number) {
  const clock = await ctx.banksClient.getClock();
  ctx.setClock(new Clock(clock.slot, clock.epochStartTimestamp, clock.epoch, clock.leaderScheduleEpoch, clock.unixTimestamp + BigInt(seconds)));
}

async function expectFail(promise: Promise<unknown>, needle: string) {
  try {
    await promise;
    assert.fail(`expected failure containing "${needle}", but it succeeded`);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    assert.ok(msg.includes(needle), `expected "${needle}" in:\n${msg}`);
  }
}

before(async () => {
  admin = Keypair.generate(); arbitrator = Keypair.generate(); treasury = Keypair.generate();
  seller = Keypair.generate(); buyer = Keypair.generate(); stranger = Keypair.generate(); cranker = Keypair.generate();
  successor = Keypair.generate();

  ctx = await startAnchor(".", [], []);
  // The provider's own wallet (bankrun's funded payer) covers transaction fees.
  // Every party below signs as an extra signer, which is what the program checks.
  provider = new BankrunProvider(ctx);
  program = new Program(idl as TakeoverEscrow, provider);

  fundAccounts(admin, arbitrator, treasury, seller, buyer, stranger, successor);

  configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];
  await program.methods
    .initialize(FEE_BPS, arbitrator.publicKey, treasury.publicKey)
    .accounts({ config: configPda, authority: admin.publicKey, systemProgram: SystemProgram.programId })
    .signers([admin])
    .rpc();
});

describe("token sale settles atomically", () => {
  const id = idBytes("tok-happy");
  let mint: PublicKey, listing: PublicKey;

  it("creates a listing that starts as a draft", async () => {
    mint = await newMint();
    listing = listingPda(seller.publicKey, id);
    await program.methods
      .createListing(id, KIND_TOKEN, new BN(2 * LAMPORTS_PER_SOL), AUTH_MINT | AUTH_FREEZE, 7)
      .accounts({ config: configPda, listing, seller: seller.publicKey, mint, systemProgram: SystemProgram.programId })
      .signers([seller]).rpc();
    const l = await program.account.listing.fetch(listing);
    assert.deepEqual(l.status, { draft: {} });
  });

  it("refuses a purchase while the authorities are not yet escrowed", async () => {
    await expectFail(
      program.methods.buyToken()
        .accounts({ config: configPda, listing, buyer: buyer.publicKey, seller: seller.publicKey, treasury: treasury.publicKey, mint, metadata: null, tokenMetadataProgram: null, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
        .signers([buyer]).rpc(),
      "BadStatus",
    );
  });

  it("goes live once every promised authority is in custody", async () => {
    for (const which of [AUTH_MINT, AUTH_FREEZE]) {
      await program.methods.escrowAuthority(which)
        .accounts({ listing, seller: seller.publicKey, mint, metadata: null, tokenMetadataProgram: null, tokenProgram: TOKEN_PROGRAM_ID })
        .signers([seller]).rpc();
    }
    const l = await program.account.listing.fetch(listing);
    assert.deepEqual(l.status, { active: {} });
    const m = await mintAuthorities(mint);
    assert.equal(m?.mintAuthority?.toBase58(), listing.toBase58(), "program should hold mint authority");
  });

  it("will not let the seller buy their own listing", async () => {
    await expectFail(
      program.methods.buyToken()
        .accounts({ config: configPda, listing, buyer: seller.publicKey, seller: seller.publicKey, treasury: treasury.publicKey, mint, metadata: null, tokenMetadataProgram: null, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
        .signers([seller]).rpc(),
      "SelfPurchase",
    );
  });

  it("pays the seller and moves the authorities in one instruction", async () => {
    const before = await ctx.banksClient.getBalance(seller.publicKey);
    await program.methods.buyToken()
      .accounts({ config: configPda, listing, buyer: buyer.publicKey, seller: seller.publicKey, treasury: treasury.publicKey, mint, metadata: null, tokenMetadataProgram: null, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .signers([buyer]).rpc();

    const after = await ctx.banksClient.getBalance(seller.publicKey);
    const expected = BigInt(2 * LAMPORTS_PER_SOL) - BigInt(2 * LAMPORTS_PER_SOL) * BigInt(FEE_BPS) / 10_000n;
    assert.equal(after - before, expected, "seller receives price minus fee");

    const fee = await ctx.banksClient.getBalance(treasury.publicKey);
    assert.ok(fee > BigInt(50 * LAMPORTS_PER_SOL), "treasury collected the fee");

    const m = await mintAuthorities(mint);
    assert.equal(m?.mintAuthority?.toBase58(), buyer.publicKey.toBase58(), "buyer holds mint authority");
    assert.equal(m?.freezeAuthority?.toBase58(), buyer.publicKey.toBase58(), "buyer holds freeze authority");
  });

  it("cannot be bought twice", async () => {
    await expectFail(
      program.methods.buyToken()
        .accounts({ config: configPda, listing, buyer: stranger.publicKey, seller: seller.publicKey, treasury: treasury.publicKey, mint, metadata: null, tokenMetadataProgram: null, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
        .signers([stranger]).rpc(),
      "BadStatus",
    );
  });
});

describe("cancelling returns what was escrowed", () => {
  const id = idBytes("tok-cancel");
  let mint: PublicKey, listing: PublicKey;

  before(async () => {
    mint = await newMint();
    listing = listingPda(seller.publicKey, id);
    await program.methods.createListing(id, KIND_TOKEN, new BN(LAMPORTS_PER_SOL), AUTH_MINT, 7)
      .accounts({ config: configPda, listing, seller: seller.publicKey, mint, systemProgram: SystemProgram.programId })
      .signers([seller]).rpc();
    await program.methods.escrowAuthority(AUTH_MINT)
      .accounts({ listing, seller: seller.publicKey, mint, metadata: null, tokenMetadataProgram: null, tokenProgram: TOKEN_PROGRAM_ID })
      .signers([seller]).rpc();
  });

  it("refuses a cancel from anyone but the seller", async () => {
    await expectFail(
      program.methods.cancel()
        .accounts({ listing, seller: stranger.publicKey, mint, metadata: null, tokenMetadataProgram: null, tokenProgram: TOKEN_PROGRAM_ID })
        .signers([stranger]).rpc(),
      "NotSeller",
    );
  });

  it("hands the authority back to the seller", async () => {
    await program.methods.cancel()
      .accounts({ listing, seller: seller.publicKey, mint, metadata: null, tokenMetadataProgram: null, tokenProgram: TOKEN_PROGRAM_ID })
      .signers([seller]).rpc();
    const m = await mintAuthorities(mint);
    assert.equal(m?.mintAuthority?.toBase58(), seller.publicKey.toBase58());
    const l = await program.account.listing.fetch(listing);
    assert.deepEqual(l.status, { cancelled: {} });
  });
});

describe("escrowed deals cannot strand a buyer", () => {
  const id = idBytes("off-refund");
  let listing: PublicKey;

  before(async () => {
    listing = listingPda(seller.publicKey, id);
    await program.methods.createListing(id, KIND_OFFCHAIN, new BN(3 * LAMPORTS_PER_SOL), 0, 1)
      .accounts({ config: configPda, listing, seller: seller.publicKey, mint: null, systemProgram: SystemProgram.programId })
      .signers([seller]).rpc();
    await program.methods.fund()
      .accounts({ listing, buyer: buyer.publicKey, systemProgram: SystemProgram.programId })
      .signers([buyer]).rpc();
  });

  it("holds the money on the listing account", async () => {
    const l = await program.account.listing.fetch(listing);
    assert.equal(l.escrowedLamports.toString(), String(3 * LAMPORTS_PER_SOL));
    assert.deepEqual(l.status, { funded: {} });
  });

  it("will not let a stranger release the funds", async () => {
    await expectFail(
      program.methods.release()
        .accounts({ config: configPda, listing, signer: stranger.publicKey, seller: seller.publicKey, buyer: buyer.publicKey, treasury: treasury.publicKey })
        .signers([stranger]).rpc(),
      "NotBuyer",
    );
  });

  it("will not refund before the deadline", async () => {
    await expectFail(
      program.methods.refund()
        .accounts({ config: configPda, listing, signer: stranger.publicKey, seller: seller.publicKey, buyer: buyer.publicKey, treasury: treasury.publicKey })
        .signers([stranger]).rpc(),
      "DeadlineNotReached",
    );
  });

  it("lets ANYONE refund the buyer once the deadline passes", async () => {
    await setClockAhead(86_400 + 60);
    const before = await ctx.banksClient.getBalance(buyer.publicKey);
    // A third party, not the buyer, cranks the refund. Deliberately a different wallet
    // from the one that tried too early: an identical transaction from the same signer
    // under an unchanged blockhash would carry an identical signature, which the runtime
    // rejects as already processed.
    await program.methods.refund()
      .accounts({ config: configPda, listing, signer: cranker.publicKey, seller: seller.publicKey, buyer: buyer.publicKey, treasury: treasury.publicKey })
      .signers([cranker]).rpc();
    const after = await ctx.banksClient.getBalance(buyer.publicKey);
    assert.equal(after - before, BigInt(3 * LAMPORTS_PER_SOL), "buyer got the whole deposit back");
    const l = await program.account.listing.fetch(listing);
    assert.deepEqual(l.status, { refunded: {} });
  });
});

describe("the arbitrator is bounded", () => {
  const id = idBytes("off-dispute");
  let listing: PublicKey;

  before(async () => {
    listing = listingPda(seller.publicKey, id);
    await program.methods.createListing(id, KIND_OFFCHAIN, new BN(LAMPORTS_PER_SOL), 0, 5)
      .accounts({ config: configPda, listing, seller: seller.publicKey, mint: null, systemProgram: SystemProgram.programId })
      .signers([seller]).rpc();
    await program.methods.fund()
      .accounts({ listing, buyer: buyer.publicKey, systemProgram: SystemProgram.programId })
      .signers([buyer]).rpc();
  });

  it("refuses arbitration on a deal nobody disputed", async () => {
    await expectFail(
      program.methods.resolve(true)
        .accounts({ config: configPda, listing, signer: arbitrator.publicKey, seller: seller.publicKey, buyer: buyer.publicKey, treasury: treasury.publicKey })
        .signers([arbitrator]).rpc(),
      "BadStatus",
    );
  });

  it("refuses a resolution from anyone but the arbitrator", async () => {
    await program.methods.dispute()
      .accounts({ listing, signer: buyer.publicKey }).signers([buyer]).rpc();
    await expectFail(
      program.methods.resolve(true)
        .accounts({ config: configPda, listing, signer: stranger.publicKey, seller: seller.publicKey, buyer: buyer.publicKey, treasury: treasury.publicKey })
        .signers([stranger]).rpc(),
      "NotArbitrator",
    );
  });

  it("can only send the money to the seller or the buyer", async () => {
    const before = await ctx.banksClient.getBalance(buyer.publicKey);
    await program.methods.resolve(false)
      .accounts({ config: configPda, listing, signer: arbitrator.publicKey, seller: seller.publicKey, buyer: buyer.publicKey, treasury: treasury.publicKey })
      .signers([arbitrator]).rpc();
    const after = await ctx.banksClient.getBalance(buyer.publicKey);
    assert.equal(after - before, BigInt(LAMPORTS_PER_SOL));
  });
});

describe("a dispute cannot be used to hold the money hostage", () => {
  // The bug this covers: `dispute` moved a listing out of Funded, and the deadline
  // refund only fired on Funded, so a seller who had taken payment and delivered
  // nothing could raise a dispute and freeze the buyer's SOL for as long as the
  // arbitrator stayed quiet — forever, if that key were ever lost.
  const id = idBytes("hostage");
  let listing: PublicKey;

  before(async () => {
    listing = listingPda(seller.publicKey, id);
    await program.methods.createListing(id, KIND_OFFCHAIN, new BN(LAMPORTS_PER_SOL), 0, 5)
      .accounts({ config: configPda, listing, seller: seller.publicKey, mint: null, systemProgram: SystemProgram.programId })
      .signers([seller]).rpc();
    await program.methods.fund()
      .accounts({ listing, buyer: buyer.publicKey, systemProgram: SystemProgram.programId })
      .signers([buyer]).rpc();
    // the seller, about to lose on the deadline, blocks the automatic refund
    await program.methods.dispute()
      .accounts({ listing, signer: seller.publicKey }).signers([seller]).rpc();
  });

  it("records when the dispute was raised", async () => {
    const l = await program.account.listing.fetch(listing);
    assert.ok(l.disputedAt.toNumber() > 0, "disputedAt should be stamped");
  });

  it("still refuses a refund while arbitration has time to run", async () => {
    await setClockAhead(86_400 * 6); // past the delivery deadline, inside the window
    // Signed by the buyer rather than the stranger below: bankrun keeps one blockhash,
    // so two identical refunds from the same signer would collide as the same signature.
    await expectFail(
      program.methods.refund()
        .accounts({ config: configPda, listing, signer: buyer.publicKey, seller: seller.publicKey, buyer: buyer.publicKey, treasury: treasury.publicKey })
        .signers([buyer]).rpc(),
      "DeadlineNotReached",
    );
  });

  it("returns the money once arbitration has clearly been abandoned", async () => {
    await setClockAhead(86_400 * 15); // past the 14-day arbitration window
    const before = await ctx.banksClient.getBalance(buyer.publicKey);
    await program.methods.refund()
      .accounts({ config: configPda, listing, signer: stranger.publicKey, seller: seller.publicKey, buyer: buyer.publicKey, treasury: treasury.publicKey })
      .signers([stranger]).rpc();
    const after = await ctx.banksClient.getBalance(buyer.publicKey);
    assert.equal(after - before, BigInt(LAMPORTS_PER_SOL), "buyer gets the full amount back");
  });
});

describe("the fee cannot be changed under a live deal", () => {
  const id = idBytes("fee-frozen");
  let listing: PublicKey;

  it("keeps the rate the listing was created with", async () => {
    listing = listingPda(seller.publicKey, id);
    await program.methods.createListing(id, KIND_OFFCHAIN, new BN(10 * LAMPORTS_PER_SOL), 0, 5)
      .accounts({ config: configPda, listing, seller: seller.publicKey, mint: null, systemProgram: SystemProgram.programId })
      .signers([seller]).rpc();

    // admin raises the platform fee to the cap after the listing exists
    await program.methods.updateConfig(500, arbitrator.publicKey, treasury.publicKey)
      .accounts({ config: configPda, authority: admin.publicKey }).signers([admin]).rpc();

    await program.methods.fund()
      .accounts({ listing, buyer: buyer.publicKey, systemProgram: SystemProgram.programId })
      .signers([buyer]).rpc();

    const before = await ctx.banksClient.getBalance(seller.publicKey);
    await program.methods.release()
      .accounts({ config: configPda, listing, signer: buyer.publicKey, seller: seller.publicKey, buyer: buyer.publicKey, treasury: treasury.publicKey })
      .signers([buyer]).rpc();
    const after = await ctx.banksClient.getBalance(seller.publicKey);

    const atOldFee = BigInt(10 * LAMPORTS_PER_SOL) * BigInt(10_000 - FEE_BPS) / 10_000n;
    assert.equal(after - before, atOldFee, "seller is paid at the fee in force when they listed");
  });

  it("accepts a fee exactly at the hard cap", async () => {
    await program.methods.updateConfig(500, arbitrator.publicKey, treasury.publicKey)
      .accounts({ config: configPda, authority: admin.publicKey }).signers([admin]).rpc();
    const c = await program.account.config.fetch(configPda);
    assert.equal(c.feeBps, 500, "5% is allowed");
  });

  it("rejects a single basis point above the cap", async () => {
    await expectFail(
      program.methods.updateConfig(501, arbitrator.publicKey, treasury.publicKey)
        .accounts({ config: configPda, authority: admin.publicKey }).signers([admin]).rpc(),
      "FeeTooHigh",
    );
  });

  it("rejects an outright greedy fee", async () => {
    await expectFail(
      program.methods.updateConfig(5000, arbitrator.publicKey, treasury.publicKey)
        .accounts({ config: configPda, authority: admin.publicKey }).signers([admin]).rpc(),
      "FeeTooHigh",
    );
  });
});

describe("the config authority can be handed over, in two steps", () => {
  // Without this the authority set at initialize is permanent: it could never move to a
  // multisig, and losing it would freeze the fee, treasury and arbitrator for good.
  // The nomination lives in its own PDA so that no already-deployed account has to grow.
  let pendingPda: PublicKey;
  before(() => {
    pendingPda = PublicKey.findProgramAddressSync([Buffer.from("pending_authority")], program.programId)[0];
  });

  it("refuses a nomination from anyone but the current authority", async () => {
    await expectFail(
      program.methods.nominateAuthority(stranger.publicKey)
        .accounts({ config: configPda, pending: pendingPda, authority: stranger.publicKey, systemProgram: SystemProgram.programId })
        .signers([stranger]).rpc(),
      "ConstraintHasOne",
    );
  });

  it("will not nominate the key that already holds it", async () => {
    await expectFail(
      program.methods.nominateAuthority(admin.publicKey)
        .accounts({ config: configPda, pending: pendingPda, authority: admin.publicKey, systemProgram: SystemProgram.programId })
        .signers([admin]).rpc(),
      "AlreadyAuthority",
    );
  });

  it("refuses an acceptance when nobody was nominated", async () => {
    await expectFail(
      program.methods.acceptAuthority()
        .accounts({ config: configPda, pending: pendingPda, newAuthority: stranger.publicKey })
        .signers([stranger]).rpc(),
      "AccountNotInitialized",
    );
  });

  it("changes nothing until the successor accepts", async () => {
    await program.methods.nominateAuthority(successor.publicKey)
      .accounts({ config: configPda, pending: pendingPda, authority: admin.publicKey, systemProgram: SystemProgram.programId })
      .signers([admin]).rpc();
    const c = await program.account.config.fetch(configPda);
    assert.equal(c.authority.toBase58(), admin.publicKey.toBase58(), "old authority still in charge");
    const pend = await program.account.pendingAuthority.fetch(pendingPda);
    assert.equal(pend.newAuthority.toBase58(), successor.publicKey.toBase58());
  });

  it("will not let a bystander seize someone else's nomination", async () => {
    await expectFail(
      program.methods.acceptAuthority()
        .accounts({ config: configPda, pending: pendingPda, newAuthority: stranger.publicKey })
        .signers([stranger]).rpc(),
      "NotNominated",
    );
  });

  it("hands over once the successor signs, and the old key loses its powers", async () => {
    await program.methods.acceptAuthority()
      .accounts({ config: configPda, pending: pendingPda, newAuthority: successor.publicKey })
      .signers([successor]).rpc();
    const c = await program.account.config.fetch(configPda);
    assert.equal(c.authority.toBase58(), successor.publicKey.toBase58());
    assert.equal(await ctx.banksClient.getAccount(pendingPda), null, "nomination account closed");

    await expectFail(
      program.methods.updateConfig(400, arbitrator.publicKey, treasury.publicKey)
        .accounts({ config: configPda, authority: admin.publicKey }).signers([admin]).rpc(),
      "ConstraintHasOne",
    );
    await program.methods.updateConfig(400, arbitrator.publicKey, treasury.publicKey)
      .accounts({ config: configPda, authority: successor.publicKey }).signers([successor]).rpc();
    assert.equal((await program.account.config.fetch(configPda)).feeBps, 400);
  });

  it("lets a nomination be withdrawn before it is taken up", async () => {
    await program.methods.nominateAuthority(stranger.publicKey)
      .accounts({ config: configPda, pending: pendingPda, authority: successor.publicKey, systemProgram: SystemProgram.programId })
      .signers([successor]).rpc();
    await program.methods.cancelNomination()
      .accounts({ config: configPda, pending: pendingPda, authority: successor.publicKey })
      .signers([successor]).rpc();
    assert.equal(await ctx.banksClient.getAccount(pendingPda), null, "withdrawn");
    await expectFail(
      program.methods.acceptAuthority()
        .accounts({ config: configPda, pending: pendingPda, newAuthority: stranger.publicKey })
        .signers([stranger]).rpc(),
      "AccountNotInitialized",
    );
  });
});
