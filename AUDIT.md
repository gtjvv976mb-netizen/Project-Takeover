# Security review — takeover-escrow

**Program** `B6sQ8s6rikSPqwPhm6XPpy16mVuJ87raCcVFXMA6sSVG` (devnet)
**Commit** e903920 · **Reviewed** 2026-09-10 · **Fixes applied** 2026-09-11 · **Scope** `programs/takeover-escrow/src/`

## What this is, and what it is not

This is a self-review by the author of the code. That is worth something and it is
not worth an audit: the person who wrote a bug is the person least likely to see it,
and nothing here has been formally verified, fuzzed, or checked by anyone with an
adversarial incentive. Treat it as a map for a real auditor rather than a clean bill
of health. Nothing below should be read as clearance to hold real money.

Suggested firms for the real thing, all Solana-native: Neodyme, OtterSec, Sec3,
Halborn. Expect roughly $15–50k and two to four weeks.

---

## Findings

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| H-1 | High | A dispute permanently blocks the deadline refund | **Fixed** |
| H-2 | High | One key is upgrade authority, treasury and arbitrator | Open — deployment, not code |
| M-1 | Medium | `accept_offer` never passes the Metaplex program to its CPI | **Fixed** |
| M-2 | Medium | `accept_offer` does not pin `token_metadata_program` | **Fixed** |
| M-3 | Medium | `cancel` does not check the mint against the listing | **Fixed** |
| M-4 | Medium | Arbitrator power is unbounded and untimed | Bounded by H-1's timeout; still a single key |
| H-3 | High | The config authority could never be rotated | **Fixed** |
| L-1 | Low | `close_listing` sweeps donated lamports to the seller | Open |
| L-2 | Low | No events, so the index depends entirely on polling | Open |

---

### H-1 · A dispute permanently blocks the deadline refund — FIXED

`refund` is the mechanism that makes the escrow safe without an operator:

```rust
pub fn refund(mut ctx: Context<Settle>) -> Result<()> {
    require!(l.status == Status::Funded, EscrowError::BadStatus);
    require!(now >= l.deadline, EscrowError::DeadlineNotReached);
```

It is callable by **anyone** once the deadline passes, which is exactly right — a buyer
whose seller vanished never needs the site's cooperation.

But `dispute` is callable by **either party** and moves the listing out of `Funded`:

```rust
require!(l.status == Status::Funded, EscrowError::BadStatus);
require!(who == l.buyer || who == l.seller, EscrowError::NotBuyer);
l.status = Status::Disputed;
```

Once `Disputed`, `refund` can never be reached again. The only exit is `resolve`, which
only the arbitrator may call. So:

> A seller who has taken payment and delivered nothing calls `dispute` one minute before
> the deadline. The buyer's money is now frozen until the operator intervenes. If the
> arbitrator key is lost, unresponsive, or hostile, it is frozen permanently.

This costs the attacker one transaction fee and is available on every funded deal. It
inverts the property the design is built on: the escrow is supposed to be safe *because*
no human is required, and this hands any counterparty a switch that makes a human
required.

**Fix.** Give arbitration a clock. Record when the dispute was raised and let the
deadline refund resume if nobody resolves it within a fixed window:

```rust
// in Listing
pub disputed_at: i64,

// dispute
l.disputed_at = Clock::get()?.unix_timestamp;

// refund
let past_deadline = l.status == Status::Funded && now >= l.deadline;
let abandoned_dispute = l.status == Status::Disputed
    && l.disputed_at != 0
    && now >= l.disputed_at.checked_add(ARBITRATION_WINDOW).ok_or(MathOverflow)?;
require!(past_deadline || abandoned_dispute, EscrowError::DeadlineNotReached);
```

With `ARBITRATION_WINDOW` at, say, 14 days, the operator has a fair chance to rule and
the buyer is never locked in forever. Refunding to the buyer is the correct default: the
seller can always dispute again before the window closes if they really did deliver.

---

### H-2 · One key is upgrade authority, treasury and arbitrator

`F4SoR29Yitwun3hCLwdoKnUkiT47kSXY8eZJjgp7Ffof` is currently all three.

The upgrade authority is the serious half. Whoever holds it can deploy a replacement
program that reassigns every escrowed authority and drains every escrowed lamport, with
no warning and nothing on-chain to stop it. Every safety property in this document is
conditional on that one key.

The site says, in its largest type, *"Nobody holds the keys. Not even us."* That is not
true while the program is upgradeable by a single wallet. It is a marketing claim the
deployment contradicts.

**Fix, in order of strength.**

1. Set the upgrade authority to `None` once the program is stable. The claim becomes
   true, permanently, and anyone can verify it with `solana program show`. The cost is
   that bugs can never be patched — which is why this comes *after* an audit, not before.
2. Otherwise move it to a Squads multisig with a timelock, so an upgrade is visible
   before it lands.

Separately, split the three roles. They have nothing to do with each other, and today a
single compromise means total loss *and* the ability to rule every dispute in the
attacker's favour.

---

### M-1 · `accept_offer` never passes the Metaplex program to its CPI — FIXED

`transfer_authorities` (used by `buy_token` and `cancel`) passes the program account:

```rust
invoke_signed(&ix, &[md.clone(), listing.clone(), md_program.clone()], signer_seeds)
```

`transfer_authorities_from_signer` (used by `accept_offer`) does not:

```rust
invoke(&ix, &[md.clone(), seller.to_account_info()])
```

Any offer that includes the metadata update authority is likely to fail at this CPI.
This path has **no test coverage** — `e2e-offers.mjs` exercises mint and freeze only —
which is why it has not been noticed.

**Fix.** Thread `token_metadata_program` into the helper and include it, exactly as the
sibling does. Then extend the offers e2e to cover a metadata-bearing offer.

---

### M-2 · `accept_offer` does not pin `token_metadata_program` — FIXED

Every other context constrains it:

```rust
#[account(address = METADATA_PROGRAM_ID @ EscrowError::BadMetadataAccount)]
pub token_metadata_program: Option<AccountInfo<'info>>,
```

`AcceptOffer` does not. It is not currently exploitable, because
`update_metadata_authority_ix` hard-codes `program_id: METADATA_PROGRAM_ID`, so the CPI
goes to the real Metaplex program whatever account is supplied. It is a latent hazard: the
moment anyone refactors that helper to use the passed account, it becomes an
arbitrary-program CPI. Pin it now.

---

### M-3 · `cancel` does not check the mint against the listing — FIXED

`escrow_authority` and `buy_token` both assert `require_keys_eq!(l.mint, mint.key())`.
`cancel` does not, and passes whatever mint it is given straight to
`transfer_authorities`.

Not exploitable today: the CPI is signed by the listing PDA, so it fails unless that PDA
genuinely holds authority on the supplied mint, and the whole instruction reverts. But it
is the one place in the program where a mint is used unchecked, and defence in depth is
cheap. Add the assertion.

---

### M-4 · Arbitrator power is unbounded and untimed

`resolve` lets the arbitrator send a disputed deal's entire balance to either party, at
any time, with no bond, no appeal, no timelock and no on-chain record of why. A
compromised or dishonest arbitrator can collude with a fake seller to take any disputed
buyer's money.

This is inherent to having arbitration at all, and it is a reasonable trade for the
off-chain asset classes where no other option exists. It should be stated plainly on the
site rather than left implicit, and it should at minimum be a multisig. H-1's timeout
also bounds the damage: an arbitrator who does nothing can no longer freeze funds
forever, only delay them.

---

### L-1 · `close_listing` sweeps donated lamports to the seller

`close = seller` returns the account's whole balance. `escrowed_lamports == 0` is
checked, but that is the program's own accounting, not the account's real balance — so
any lamports transferred to the PDA by a third party go to the seller. Griefing at worst,
and it costs the griefer money. Noted for completeness.

### L-2 · No events, so the index depends entirely on polling

The program emits nothing. The site rebuilds its view by polling `getProgramAccounts` and
a per-listing `/sync`. That is why the index can lag the chain, and why a missed poll is
invisible rather than loud. `emit!` on create / escrow / buy / fund / release / refund /
resolve would let the indexer follow the chain instead of interrogating it.

---

## What was checked and found sound

- **Atomic settlement.** `buy_token` pays the seller and moves every authority in one
  instruction. There is no interleaving where one side holds both.
- **Custody.** Escrowed authorities sit on a PDA with no private key. Confirmed on chain:
  the mint authority reads as the listing PDA between listing and sale.
- **`accept_offer` needs no custody.** The holder signs, so the token program and Metaplex
  verify authority themselves. A forged seller simply fails the CPI.
- **Arithmetic.** Every add, subtract and multiply on money uses `checked_*`. The fee
  split was verified across 28,500 prices with no lamport created or destroyed.
- **Replay and double-spend.** Every state transition is gated on `status`, so `fund`,
  `buy_token`, `release`, `refund` and `cancel` cannot run twice.
- **Self-dealing.** `SelfPurchase` and `SelfAccept` block a seller buying their own
  listing or a buyer accepting their own offer.
- **Fee immutability.** `fee_bps` is frozen onto each listing and offer at creation, so a
  config change cannot alter a live deal.
- **Fee ceiling.** `MAX_FEE_BPS = 500` is enforced in `initialize` and `update_config`,
  so the marketplace cannot raise its own fee above 5% even if it wants to.
- **PDA derivation.** All seeds are canonical and all bumps stored and reused; no
  user-supplied bumps anywhere.
- **Token-2022.** Explicitly rejected at listing rather than half-supported.
- **Metaplex PDA.** `verify_metadata_pda` checks the metadata account is the canonical
  derivation for the mint before any authority is moved.

## On the tests themselves

Two defects this week were invisible to a full, green test suite, and both for the same
reason: the tests built their own transactions instead of using the code the browser runs.

- Rotating the treasury desynced the site from the chain. Every purchase would have failed
  with `BadTreasury`. Every e2e script passed, because each read the treasury from the
  config account directly — a path no browser takes.
- The first `pending_authority` design could not deserialise an already-deployed config
  account. The bankrun suite passed, because it starts from a fresh account that is already
  the new size.

`scripts/e2e-browser-paths.mts` closes that gap. It imports `src/lib/client/program.ts` —
the actual browser module — and takes the treasury from the site's own `/api/config`, the
way the listing page does. The only thing faked is the wallet adapter object, which cannot
exist outside a browser.

It was verified against the bug it exists for: re-pointing the site's treasury at the old
address makes three of its four flows fail immediately.

## Not in scope

Off-chain delivery for `PumpCreator` and `Offchain` listings cannot be verified by any
program, and the escrow does not claim to. Those flows rest on the buyer's confirmation
and, failing that, on arbitration. The web app, its wallet-signature auth and its SQLite
index were not reviewed here.


---

## Fixes applied 2026-09-11

**H-1.** `Listing` gained `disputed_at`, stamped by `dispute`. `refund` now accepts a
`Disputed` listing once `ARBITRATION_WINDOW` (14 days) has passed since the dispute was
raised, so an unanswered arbitration can no longer hold a buyer's money forever. Listings
written before the field existed read it back as 0 and fall back to the delivery deadline,
so nothing is stranded by the upgrade.

Covered by three regression tests in `tests/escrow.test.ts` under *"a dispute cannot be
used to hold the money hostage"*, using bankrun's clock control to walk past both the
delivery deadline and the arbitration window. The middle test asserts the refund is still
correctly refused inside the window, so the fix cannot silently become "refund always
works".

**M-1.** `transfer_authorities_from_signer` now takes the Metaplex program account and
includes it in the CPI, matching its sibling. `accept_offer` passes it through.

**M-2.** `AcceptOffer.token_metadata_program` is pinned with
`#[account(address = METADATA_PROGRAM_ID)]`, as every other context already was.

**M-3.** `cancel` asserts `listing.mint == mint.key()` before moving anything.

All 36 tests across the three suites pass. Redeployed to devnet and the handover
re-proved end to end afterwards.

**H-3, found while acting on H-2.** `initialize` wrote `Config.authority` once and no
instruction ever changed it. The key that ran setup was therefore the permanent owner of
the fee, the treasury and the arbitrator: it could never be moved to a multisig, and if it
were lost all three were frozen forever. This also made the mainnet plan in `KEYS.md`
unachievable as written — "move the config authority to a multisig" was not a thing the
program could do.

Fixed with a two-step handover, `nominate_authority` then `accept_authority`, so the
successor must sign before the old key loses anything. Six tests cover it, including that
a bystander cannot seize a nomination and that the old authority really does lose its
powers afterwards. Config grew a `pending_authority` field; the account reallocs on first
nomination, so existing deployments migrate without intervention.

**Still open: H-2.** It is a property of the deployment, not the code, and no commit can
close it. One wallet remains upgrade authority, treasury and arbitrator.
