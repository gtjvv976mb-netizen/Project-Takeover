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
curl -s https://project-takeover.com/api/config | python3 -m json.tool

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

## The program keypair

`target/deploy/takeover_escrow-keypair.json` is not a build artifact. It **is** the
program's address: the address is its public key, and the private half is the only thing
that can ever deploy to or upgrade that address. It is gitignored, so it exists only
where it was generated. Lose it and the address is dead — not transferable, not
recoverable, not by anyone.

The devnet program `B6sQ8s6rik…` was deployed from a machine that no longer exists, so
its keypair is gone. That address can never be upgraded again, which costs nothing since
devnet is disposable, and means mainnet needs a fresh address:

```bash
node scripts/new-program-id.mjs            # show what changes
node scripts/new-program-id.mjs --yes      # generate, and rewrite all three places
```

Three places have to agree or the site builds transactions the program rejects: Anchor's
`declare_id!` inside the binary, the IDL the website reads, and `Anchor.toml`. The script
writes all three from one keypair and deletes any binary built for the old address, since
deploying that would be refused by its own id check after the rent was already paid.

**Back the keypair up before deploying**, somewhere that is not the laptop that made it.

---

## Runbook: moving the three powers to a Squads multisig

Everything below is signed on the machine that holds the deploy key. Nothing in this
repository can do it for you, and that is the point.

**0. Create the multisig.** At app.squads.so, create a Squads v4 multisig with at least
three members on separate devices and a 2-of-3 threshold. **A 1-of-1 multisig is not a
multisig.** One key still proposes, approves and executes alone, so moving a power into
it changes the diagram and not the trust; the scripts here refuse it and the site says
so in words. Note also that the Squads app puts the **vault** address in its URL, so the
multisig address has to be read off the page, not the address bar.

Check what you built before trusting it with anything:

```bash
node scripts/squads.mjs <MULTISIG_OR_VAULT>     # either address works
```

It fails a threshold below 2 and warns on a missing time lock. **Four members at a
threshold of 1 is worse than one wallet, not better**: any one of the four can approve
and execute alone, so it is four single points of failure instead of one. The count of
members is not the security; the threshold is. Add a time lock (a day is
plenty) so any upgrade is visible before it lands. Note two addresses: the **multisig**
(the account with the members) and its **vault 0** (the address it acts through, shown
as the "vault" on the home tab). The vault is what receives the powers; the multisig is
what the site and the preflight are told about. Fund the vault with a little SOL; the
arbitrator pays its own transaction fees.

**1. Upgrade authority → vault.** One transaction, signed by the deploy key.

```bash
node scripts/upgrade-authority.mjs status
node scripts/upgrade-authority.mjs transfer <VAULT> --multisig <MULTISIG>        # dry run
node scripts/upgrade-authority.mjs transfer <VAULT> --multisig <MULTISIG> --yes
```

`--multisig` is not decoration, and the transfer also refuses a multisig whose threshold
is 1: it would be a single key with extra steps. A Squads vault can only be signed for on the network
where its multisig account lives, so a vault created in the app on mainnet is inert on
devnet: handing a devnet program to it would leave nobody able to upgrade it, ever. The
script therefore refuses any destination off the ed25519 curve unless the named multisig
exists **on the network being written to** and the destination really is one of its
vaults. The dry run needs no key at all, so the destination can be checked from any
machine before the real thing is attempted.

**2. Config authority → vault.** Two steps, because a one-step transfer to a mistyped
address would freeze the fee, treasury and arbitrator forever. Nominate with the deploy
key, then accept *from the vault* by executing the printed instruction in the Squads app.

```bash
node scripts/authority.mjs nominate <VAULT>
node scripts/authority.mjs accept --print <VAULT>   # prints program id, accounts, base58 data
```

In the Squads app: Developers → Transaction builder → custom instruction, paste the
three fields, propose, have the members approve, execute. `node scripts/authority.mjs
status` then shows the vault as authority. Until it executes, the deploy key keeps every
power and can `cancel`.

**3. Arbitrator → vault, treasury → cold key.** Signed by the config authority, which
after step 2 is the vault, so this is another custom instruction from the Squads app:
`update_config(fee_bps, arbitrator, treasury)`. Do it *before* step 2 instead if you
would rather sign it with the deploy key:

```bash
node scripts/init-program.mjs --fee-bps 500 --arbitrator <VAULT> --treasury <HARDWARE_WALLET>
```

**4. Tell the site and the preflight.** A vault is an empty address; on its own it cannot
be told from a wallet. Set `NEXT_PUBLIC_SQUADS_MULTISIG=<MULTISIG>` in the Render
dashboard (the blueprint leaves it unsynced) and pass the same to the preflight:

```bash
node scripts/preflight.mjs --mainnet --multisig <MULTISIG> --site https://project-takeover.com
```

`--mainnet` **fails** while the upgrade authority, the config authority or the arbitrator
is a plain wallet, and passes only for a vault of the declared multisig or an immutable
program. `/api/config` reports `upgradeCustody` ("wallet", "squads", "program" or null
for immutable) and `squadsMultisig`, and /how-it-works links the multisig so a buyer can
check the members and the time lock themselves.

**5. After the audit: burn.**

```bash
node scripts/upgrade-authority.mjs burn --yes   # from the vault, so via the Squads app: loader SetAuthority with no new authority
```

Once the vault holds the upgrade authority, the burn is also a Squads transaction; the
script's `burn` is for the case where the deploy key still holds it.

**What is deliberately not done here.** Moving the upgrade authority to a second key on the
same laptop would look like progress and would not be any. An attacker with the disk gets
both. The only changes that mean anything are a multisig or `--final`, and both need
signatures this machine should not be able to produce alone.

**Decision, 2026-09-11: burn it after the audit, not before.** Four real defects were found
and fixed in a single day — a dispute that froze a buyer's funds forever, a config
authority that could never be rotated, a site that silently desynced from the on-chain
treasury and broke every purchase, and a migration that could not deserialise its own
account. A codebase discovering bugs at that rate is not one to freeze permanently. The
sequence is audit, fix what they find, then `--final`.

Until then the site says so itself, and says it from chain data rather than from prose: the
"what you are still trusting" section on /how-it-works reads the ProgramData account and
names whoever currently holds the upgrade authority. The day it is burned, that paragraph
changes on its own to say the program is immutable. Nobody has to remember to update the
copy, and nobody has to take our word for the current state.

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
