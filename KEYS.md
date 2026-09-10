# Keys and who can do what

Four separate powers sit behind this program. They used to be one wallet, which meant a
single compromised key was total loss. Two are now split; two are not, and this document
says plainly which is which.

Nothing here is a key. Nothing here belongs in the repository — `data/`, `.env*` and every
keypair are gitignored, and the working keys live under `~/.config/solana/takeover/` at
mode 600.

## The four powers

| Power | What it can do | What it cannot do | Devnet holder |
|---|---|---|---|
| **Upgrade authority** | Replace the program with anything at all | — | `F4SoR29…` ⚠️ |
| **Config authority** | Rotate the treasury, arbitrator and fee, and hand itself over | Exceed 5%. Touch a listing, a deal, or anyone's money | `F4SoR29…` ⚠️ |
| **Treasury** | Receive fees | Nothing else. It is only a destination | `DwjNBeS7…` |
| **Arbitrator** | Pick a winner on a **disputed** deal | Touch an undisputed deal. Change a price. Redirect funds anywhere but to the buyer or the seller | `DtRSnE1D…` |

⚠️ marks the two still held by the deploy wallet.

### The upgrade authority is the one that matters

Everything else is bounded by code. The upgrade authority is not: it can deploy a new
program that reassigns every escrowed authority and drains every escrowed lamport, with no
warning and nothing on chain to stop it. **Every safety property this project claims is
conditional on that key.**

Check who holds it at any time:

```bash
solana program show B6sQ8s6rikSPqwPhm6XPpy16mVuJ87raCcVFXMA6sSVG --url devnet
```

### The arbitrator is bounded, and now also timed

`resolve` only works on a listing somebody has disputed, and can only send the money to
the buyer or the seller — it cannot pay a third party or take a cut. Since the H-1 fix it
is also on a clock: if nobody rules within 14 days, the buyer can simply take their money
back, so an absent or hostile arbitrator can delay a refund but never prevent one.

It still needs a small SOL balance to pay its own transaction fees.

## Verify the split yourself

```bash
# treasury and arbitrator, as the program has them
curl -s https://project-takeover.onrender.com/api/config | python3 -m json.tool

# who can replace the program
solana program show B6sQ8s6rikSPqwPhm6XPpy16mVuJ87raCcVFXMA6sSVG --url devnet
```

If the treasury and arbitrator fields show the same address, the split has been undone.

The site reads both from the program rather than from its own environment, so rotating a
role on chain is enough — there is no env var to remember to update, and no way for the
two to disagree. That was not always true: the first version of this split desynced the
site from the chain and would have made every purchase fail with `BadTreasury`.

## Handing over the config authority

Until 2026-09-11 this was impossible. `initialize` wrote `authority` once and no
instruction ever changed it, so the key that set up the program was the permanent owner of
the fee, the treasury and the arbitrator — it could never move to a multisig, and losing it
would have frozen all three for good. The "config authority — a multisig" step below was
not achievable with the program as written.

It is now a two-step handover, because a one-step transfer typed slightly wrong would hand
the authority to an address nobody controls:

```bash
node scripts/authority.mjs status
node scripts/authority.mjs nominate <MULTISIG_PUBKEY>   # signed by the current authority
node scripts/authority.mjs accept --keypair <PATH>      # signed by the successor
node scripts/authority.mjs cancel                       # withdraw before acceptance
```

Nothing changes until the successor accepts. Until then the old authority keeps every
power, a bystander cannot seize a nomination meant for someone else, and the nomination can
be withdrawn. The pending nomination lives in its own PDA that exists only mid-handover,
so no already-deployed account has to be migrated.

Verified on devnet by handing the authority to a throwaway key and back again: the old key
was refused the moment the successor accepted, and the successor was refused before it.

## Rotating the treasury or arbitrator

```bash
RPC_URL=https://api.devnet.solana.com node scripts/init-program.mjs \
  --treasury <PUBKEY> --arbitrator <PUBKEY> --fee-bps 500
```

Signed by the config authority. It cannot move existing escrowed funds, and the fee is
capped at 5% by the program regardless of what is passed.

---

## Before mainnet

**The devnet keys above were generated on a laptop and must not be reused.** They are hot
keys on a developer machine, which is the correct level of care for play money and the
wrong level for real money.

**1. Treasury — do not generate a key for it.**

The treasury only ever *receives*. It should be an address whose private key is under the
strongest custody available: a hardware wallet, or a Squads multisig. Never a hot key on a
machine that also runs a web server.

**2. Arbitrator — a multisig, not a person.**

It has to sign, so it needs a usable key, but it should not be one individual acting
alone. A 2-of-3 Squads multisig means no single compromised laptop can rule a dispute.

**3. Config authority — a multisig.**

It cannot steal, but it can point the treasury at an attacker's address and collect every
future fee. Nominate the multisig, then accept from it.

**4. Upgrade authority — the real decision.**

Two honest options, in descending order of how much they are worth:

- **Make it immutable.** `solana program set-upgrade-authority --final`. The claim on the
  home page becomes permanently, publicly true and anybody can verify it in one command.
  The cost is absolute: a bug found afterwards can never be fixed, and the only remedy is
  a new program and a migration. Do this only after a real audit.
- **Move it to a Squads multisig with a timelock.** An upgrade becomes visible before it
  lands, so users can exit. Weaker, but reversible, and the sane step while the code is
  still young.

Doing neither, and shipping to mainnet with one laptop key able to replace the program, is
not a middle path. It is the thing the site tells people is impossible.

**What is deliberately not done here.** Moving the upgrade authority to a second key on the
same laptop would look like progress and would not be any. An attacker with the disk gets
both. The only changes that mean anything are a multisig or `--final`, and both need
signatures this machine should not be able to produce alone.

## What users are trusting today

Worth being able to say out loud, because a marketplace built on "don't trust us" should
be able to state its own trust assumptions:

- **Not trusted:** that we hold escrowed authorities honestly. We cannot — they sit on a
  program-derived address with no private key.
- **Not trusted:** that we pay sellers. Payment and handover are one instruction.
- **Not trusted:** that we permit a refund. Anyone can trigger it once the deadline, or an
  abandoned arbitration, has passed.
- **Trusted:** that the upgrade authority does not replace the program with a malicious one.
- **Trusted:** that the arbitrator rules honestly on disputes — bounded, since it can only
  choose between the two parties, and since a refusal to rule expires after 14 days.
- **Trusted, for off-chain listings only:** that the seller actually delivers the repo, the
  domain, the accounts. No blockchain can check this, and the escrow does not pretend to.
