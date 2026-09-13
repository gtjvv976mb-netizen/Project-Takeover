/**
 * The pump.fun creator field is no longer a wallet. These pin down that the parsers read
 * pump.fun's published layouts correctly and that "does this wallet hold the coin" is
 * answered by looking through a fee-sharing config rather than at it.
 *
 * Pure unit tests: no validator, no network. Run with `npm run test:unit`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  canonicalPoolPda, parseBondingCurve, parsePool, parseSharingConfig, pumpControlOf, sharingConfigPda, squadsVaultPda,
  PUMP_AMM_PROGRAM_ID, PUMP_FEES_PROGRAM_ID, SQUADS_V4_PROGRAM_ID, WSOL_MINT,
} from "../src/lib/solana-shared";
import type { PumpControl } from "../src/lib/types";

const k = () => Keypair.generate().publicKey;
const u64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };

/** BondingCurve as pump.fun lays it out today, including the fields appended in 2025-26. */
function bondingCurve(o: { complete?: boolean; creator: PublicKey; quoteMint?: PublicKey }) {
  return Buffer.concat([
    Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]),
    u64(1_000_000_000_000), u64(30_000_000_000), u64(800_000_000_000), u64(0), u64(1_000_000_000_000),
    Buffer.from([o.complete ? 1 : 0]),
    o.creator.toBuffer(),
    Buffer.from([0, 0]), // is_mayhem_mode, is_cashback_coin
    (o.quoteMint ?? WSOL_MINT).toBuffer(),
    u64(30), Buffer.from([1, 0]), // creator_fee_bps, can_edit_creator_fee, is_holder_reward
  ]);
}

function sharingConfig(o: { admin: PublicKey; revoked?: boolean; status?: number; shares: [PublicKey, number][] }) {
  return Buffer.concat([
    Buffer.from([216, 74, 9, 0, 56, 140, 93, 75]),
    Buffer.from([254, 2, o.status ?? 1]), // bump, version, status
    k().toBuffer(), // mint
    o.admin.toBuffer(),
    Buffer.from([o.revoked ? 1 : 0]),
    u32(o.shares.length),
    ...o.shares.map(([a, bps]) => Buffer.concat([a.toBuffer(), u16(bps)])),
  ]);
}

function pool(o: { coinCreator: PublicKey; baseMint: PublicKey; quoteMint: PublicKey }) {
  return Buffer.concat([
    Buffer.from([241, 154, 109, 4, 17, 177, 109, 188]),
    Buffer.from([255]), u16(0), k().toBuffer(), o.baseMint.toBuffer(), o.quoteMint.toBuffer(),
    k().toBuffer(), k().toBuffer(), k().toBuffer(), u64(1), o.coinCreator.toBuffer(),
    Buffer.from([0, 0]), Buffer.alloc(16), u64(30), Buffer.from([1, 0]),
  ]);
}

describe("bonding curve", () => {
  it("reads the creator and the quote mint", () => {
    const creator = k(); const usdc = k();
    const c = parseBondingCurve(bondingCurve({ creator, quoteMint: usdc }))!;
    assert.equal(c.creator!.toBase58(), creator.toBase58());
    assert.equal(c.quoteMint!.toBase58(), usdc.toBase58());
    assert.equal(c.complete, false);
  });
  it("reads the zero address as SOL", () => {
    const c = parseBondingCurve(bondingCurve({ creator: k(), quoteMint: PublicKey.default }))!;
    assert.equal(c.quoteMint, null);
  });
  it("tolerates the older, shorter layout", () => {
    const creator = k();
    const old = bondingCurve({ creator }).subarray(0, 81);
    const c = parseBondingCurve(old)!;
    assert.equal(c.creator!.toBase58(), creator.toBase58());
    assert.equal(c.quoteMint, null);
  });
});

describe("sharing config", () => {
  it("parses admin, revocation and every shareholder", () => {
    const admin = k(); const a = k(); const b = k();
    const cfg = parseSharingConfig(sharingConfig({ admin, shares: [[a, 9000], [b, 1000]] }))!;
    assert.equal(cfg.admin, admin.toBase58());
    assert.equal(cfg.adminRevoked, false);
    assert.equal(cfg.status, "active");
    assert.equal(cfg.version, 2);
    assert.deepEqual(cfg.shareholders, [{ address: a.toBase58(), shareBps: 9000 }, { address: b.toBase58(), shareBps: 1000 }]);
  });
  it("refuses anything that is not a sharing config", () => {
    assert.equal(parseSharingConfig(bondingCurve({ creator: k() })), null);
    assert.equal(parseSharingConfig(Buffer.alloc(10)), null);
  });
  it("derives the PDA on the fee program", () => {
    const mint = k();
    const [expected] = PublicKey.findProgramAddressSync([Buffer.from("sharing-config"), mint.toBuffer()], PUMP_FEES_PROGRAM_ID);
    assert.equal(sharingConfigPda(mint).toBase58(), expected.toBase58());
  });
});

describe("pool", () => {
  it("reads the coin creator at the published offset", () => {
    const cc = k(); const base = k();
    const p = parsePool(pool({ coinCreator: cc, baseMint: base, quoteMint: WSOL_MINT }))!;
    assert.equal(p.coinCreator.toBase58(), cc.toBase58());
    assert.equal(p.baseMint.toBase58(), base.toBase58());
  });
  it("derives the canonical pool under the AMM program", () => {
    const mint = k();
    assert.equal(PublicKey.isOnCurve(canonicalPoolPda(mint).toBytes()), false);
    assert.notEqual(canonicalPoolPda(mint).toBase58(), canonicalPoolPda(mint, k()).toBase58());
    void PUMP_AMM_PROGRAM_ID;
  });
});

describe("who holds the creator role", () => {
  const me = k().toBase58(); const other = k().toBase58();
  const wallet = (raw: string): PumpControl => ({ raw, source: "bonding_curve", kind: "wallet", config: null });
  const config = (c: Partial<NonNullable<PumpControl["config"]>>): PumpControl => ({
    raw: "cfg", source: "bonding_curve", kind: "sharing_config",
    config: { address: "cfg", admin: me, adminRevoked: false, status: "active", version: 2, shareholders: [{ address: me, shareBps: 10_000 }], ...c },
  });

  it("a plain wallet creator is the creator", () => {
    assert.equal(pumpControlOf(wallet(me), me).full, true);
    assert.equal(pumpControlOf(wallet(other), me).full, false);
  });
  it("admin with the whole fee holds the coin", () => {
    const v = pumpControlOf(config({}), me);
    assert.equal(v.full, true); assert.equal(v.shareBps, 10_000);
  });
  it("the 90% trick is not a handover", () => {
    // Seller "transfers" admin to the buyer but keeps 9,000 bps of the fee.
    const v = pumpControlOf(config({ admin: me, shareholders: [{ address: other, shareBps: 9000 }, { address: me, shareBps: 1000 }] }), me);
    assert.equal(v.full, false); assert.equal(v.isAdmin, true); assert.equal(v.shareBps, 1000);
    assert.match(v.reason, /10\.00%/);
  });
  it("all the fee but not admin is not control either", () => {
    const v = pumpControlOf(config({ admin: other }), me);
    assert.equal(v.full, false); assert.equal(v.shareBps, 10_000); assert.equal(v.isAdmin, false);
  });
  it("a revoked config can never be sold", () => {
    const v = pumpControlOf(config({ adminRevoked: true }), me);
    assert.equal(v.full, false); assert.equal(v.revoked, true);
  });
  it("an unreadable creator is never a yes", () => {
    assert.equal(pumpControlOf(null, me).full, false);
    assert.equal(pumpControlOf({ raw: "cfg", source: "pool", kind: "sharing_config", config: null }, me).full, false);
  });
});

describe("squads vault", () => {
  it("derives the vault the way the Squads SDK does", () => {
    const ms = k();
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("multisig"), ms.toBuffer(), Buffer.from("vault"), Buffer.from([0])], SQUADS_V4_PROGRAM_ID);
    assert.equal(squadsVaultPda(ms).toBase58(), expected.toBase58());
    assert.notEqual(squadsVaultPda(ms, 1).toBase58(), expected.toBase58());
    // A vault is off the curve: nobody can hold its private key.
    assert.equal(PublicKey.isOnCurve(squadsVaultPda(ms).toBytes()), false);
  });
});
