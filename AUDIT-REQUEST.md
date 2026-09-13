# Audit request — takeover-escrow

Send this to several firms at once. Quotes and lead times vary by more than the price
difference is worth agonising over, and a firm that is booked for six weeks is a fact you
want early rather than late.

**Who to send it to**

| Firm | Contact | Notes |
| --- | --- | --- |
| Neodyme | https://neodyme.io/en/contact | Solana-native, wrote the Token-2022 guidance this project follows |
| OtterSec | https://osec.io/ | Solana-native, audits most of the ecosystem's escrow and AMM code |
| Sec3 | https://sec3.dev/audits | Solana-native, also sells the scanner used on many Anchor programs |
| Accretion | https://accretion.xyz/ | Smaller, quotes single-purpose programs at the low end |
| Zellic | https://zellic.io/ | Broader than Solana; useful as a price comparison |

Expect roughly $7–20k and about a week for a program this size, more if the schedule is
rushed. Freeze the code before you send this: a moving target is billed as a moving target.

---

## The email

> **Subject:** Audit request — 1,100 nSLOC Anchor escrow program (Solana), pre-mainnet
>
> Hello,
>
> I'm looking for a quote and available dates to audit a single Anchor program before it
> goes to mainnet. It has not been audited before.
>
> **What it does.** Project: Takeover is a marketplace where Solana builders sell what
> they shipped — a token's authorities, a pump.fun coin's creator role, or an off-chain
> project — and the escrow program settles those trades. Funds and escrowed authorities
> sit in program-owned PDAs with no private key. The web server reads chain state and
> cannot sign anything; every action that moves money or ownership is signed by the
> user's own wallet.
>
> **Scope.** One program, `programs/takeover-escrow/`:
>
> - ~1,100 nSLOC of Rust across three files (`lib.rs` 908, `state.rs` 107, `errors.rs` 72)
> - Anchor 0.31.1, Anza toolchain 4.2.2, no other on-chain dependencies
> - 19 instructions, 4 account types, 11 events, 34 error codes
> - CPIs into SPL Token (`set_authority`) and Metaplex Token Metadata
>   (`UpdateMetadataAccountV2`), plus System Program transfers
> - Currently deployed to devnet at
>   `B6sQ8s6rikSPqwPhm6XPpy16mVuJ87raCcVFXMA6sSVG`
>
> **The three properties I most want challenged:**
>
> 1. **A token sale cannot half-happen.** `buy_token` pays the seller and moves every
>    escrowed authority to the buyer in one instruction, so there is no window where one
>    side holds both the money and the asset.
> 2. **A buyer cannot be stranded.** `refund` is permissionless once the delivery
>    deadline passes, and also once a dispute has gone 14 days unresolved, so a vanished
>    seller or an absent arbitrator cannot trap anyone's funds.
> 3. **The arbitrator cannot steal.** On a disputed deal it may only pay the seller or
>    refund the buyer. It cannot redirect funds, take a cut, or touch an undisputed deal.
>
> **What already exists**, so you are not starting cold:
>
> - 46 adversarial tests against `solana-bankrun`, including clock manipulation for the
>   deadline and refund paths (`npm run program:test`)
> - A written self-review at `AUDIT.md` listing findings H-1 through L-2 with the fixes
>   applied and the two items knowingly left open. It is a self-review by the author, so
>   please treat it as a map rather than as prior assurance.
>
> **Known open items** I would rather you knew up front than discovered:
>
> - `close_listing` sweeps any lamports a third party donated to the PDA to the seller
>   (L-1; griefing at the griefer's expense, judged not worth the code)
> - The arbitrator is a single role, now bounded in both directions and on a 14-day
>   clock, but still a trusted party for the off-chain asset class
>
> **Timeline.** The code is frozen as of this request. The upgrade authority, config
> authority and arbitrator will all be held by a 2-of-4 Squads multisig before mainnet,
> and the intention is to burn the upgrade authority with `--final` once your findings
> are fixed.
>
> Could you let me know your availability, an estimated cost, and what you'd want from me
> to scope it properly? Happy to give repository access immediately.
>
> Thanks,
> [name]
> [links: repo, project-takeover.com]

---

## Before you send

- **Freeze the code.** Decide now whether milestone escrow for off-chain deals and
  USDC-denominated listings are in scope. Both change the program and both are on the
  roadmap; adding either after the audit means paying for a re-review.
- **Give read access to the repository** rather than a zip. Firms want the history.
- **Do not shop on price alone.** Two quotes at the same number are rarely the same
  scope. Ask each what they would exclude.
