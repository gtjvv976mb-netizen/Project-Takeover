# Project: Takeover — escrowed marketplace for Solana projects

> Independent project. Not affiliated with, endorsed by, or connected to pump.fun or any other company.

**Mission:** give independent developers who build real projects and memecoins on Solana a place to show
their work and someone to sell it to. Builders list what they shipped (a full project, a token's authorities,
a pump.fun coin's creator role, a site or community), the chain proves they own it, and a buyer takes over
through escrow. Builders get paid; buyers get verified control; the work keeps living.

Builder profiles (`/builders/<wallet>`) show a wallet's shipped / sold / earned track record. Every token
listing carries a proof-of-work block read from chain (supply, authorities, holder concentration, pump.fun status).

## Asset types & escrow flows

| Type | What transfers | Flow |
| --- | --- | --- |
| `token_authority` | SPL mint authority, freeze authority, Metaplex metadata update authority | Seller moves authorities to the escrow wallet (verified on-chain) → buyer pays escrow → **one atomic tx** hands authorities to the buyer and pays the seller |
| `pump_creator` | pump.fun coin creator role (creator fees + fee-split control) | Listing verified against the bonding curve's on-chain `creator` → buyer pays escrow → seller transfers ownership on pump.fun → server verifies `creator == buyer` and auto-releases (buyer can also release manually) |
| `offchain` | Websites, domains, X/Telegram/Discord, "everything a wallet controls" bundles | Buyer pays escrow → seller delivers off-platform + leaves a note → buyer releases → disputes go to an admin who releases or refunds |

Private keys are never sold. A copied key is never truly transferred, so the app sells what a wallet
*controls* instead.

## The design

A light, colourful, card-based interface. White cards on a tinted lavender ground, soft
shadows, generous rounding, and one colour per asset category so the market is readable
at a glance: violet for token controls, tangerine for pump.fun coins, teal for whole
projects.

**Every project is visual.** Each card carries artwork, the name, a two-line description,
proof chips read from chain, and the price. If a token has a real image we use it;
otherwise `CoverArt` generates a gradient composition from a hash of the listing id, so
the art is unique per project, identical on every render, and the grid is colourful before
anyone uploads anything.

**Motion is light.** Three slow blurred colour fields drift behind the hero, cards lift
toward their category colour on hover, sections fade up on scroll, and the activity strip
scrolls and pauses on hover. The Solana slot height in the header and footer is real,
polled every two seconds. Everything respects `prefers-reduced-motion`.

## Live on devnet

| | |
| --- | --- |
| Program | [`B6sQ8s6rikSPqwPhm6XPpy16mVuJ87raCcVFXMA6sSVG`](https://explorer.solana.com/address/B6sQ8s6rikSPqwPhm6XPpy16mVuJ87raCcVFXMA6sSVG?cluster=devnet) |
| Config account | `EsfWYLtLBDA9DxGfCMm6rrxRJ2SJ41xbRiPSmVMHonJV` |
| Fee | 200 bps (2%), capped at 500 bps in the program |

Unaudited. Devnet only — do not point this at mainnet funds.

## Who holds the money

Nobody. The buyer's SOL and the seller's token authorities live in accounts owned by the
`takeover-escrow` program, and no private key exists for them. The web server reads the
chain and cannot sign anything; every action that moves money or ownership is signed by
the user's own wallet.

That means a compromise of this server gets an attacker a defaced website, not a treasury.

- **Token sales never escrow money at all.** `buy_token` pays the seller and moves every
  authority to the buyer in one instruction, so there is no window where one side holds both.
- **Escrowed deals cannot strand a buyer.** `refund` is permissionless once the delivery
  deadline passes, so nobody needs the operator's cooperation to get their money back.
- **The arbitrator is bounded.** On a disputed deal it may only choose "pay the seller" or
  "refund the buyer". It cannot redirect funds or touch an undisputed deal.
- **The fee is frozen at listing time** and hard-capped at 5% in the program itself.

## Stack

- Next.js 16 (App Router, TypeScript, Tailwind v4), React 19
- No animation, charting or 3D dependencies. Motion is CSS plus two small hooks
  (an `IntersectionObserver` reveal and a one-shot rAF count-up)
- `@solana/web3.js` v1, `@solana/spl-token`, Solana Wallet Adapter (Wallet Standard: Phantom, Solflare, Backpack…)
- SQLite via Node's built-in `node:sqlite` (Node ≥ 22.13 / 24) — no native deps
- Wallet-signature auth for every mutating API call (`tweetnacl` verify, 5-minute window)

## Run the program locally

```bash
npm run program:build                       # compile + regenerate the IDL
solana-test-validator --reset \
  --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s tests/fixtures/mpl_token_metadata.so
solana program deploy target/deploy/takeover_escrow.so \
  --program-id target/deploy/takeover_escrow-keypair.json
node scripts/init-program.mjs --fee-bps 200 # create the config account
npm run program:test                        # 21 adversarial tests
node scripts/e2e-program.mjs                # drives the real site against the program
```

Point the app at it with `RPC_URL` and `NEXT_PUBLIC_RPC_URL` in `.env.local`, and set
`TREASURY_PUBKEY` to the wallet that should receive fees.

## The coin

If a pump.fun coin is ever launched for this project, set `NEXT_PUBLIC_TOKEN_MINT` and
`NEXT_PUBLIC_TOKEN_SYMBOL` and a `/coin` page and a footer ticker appear. Leave them
unset and every piece of token UI hides itself rather than showing a placeholder.

Price, market cap and curve progress are derived from the bonding curve account on
chain, not from an API — validated against live mainnet coins and pump.fun's own
figures, which agree to within 0.2% (the outliers are coins mid-trade, where their
cached number lags the chain and ours does not).

The page states plainly that the coin is not a share, carries no revenue entitlement,
and is not required to use the marketplace. Keep it that way: the escrow's credibility
rests on being verifiable, and a token that appears to capture platform revenue invites
a different set of questions entirely.

## Deploying

The repo carries a Render blueprint (`render.yaml`). The service runs on a paid instance
with a 1&nbsp;GB persistent disk mounted at `/var/data`, because the descriptive layer is a
SQLite file and Render only offers disks on paid plans. Money and ownership are on chain,
so losing that disk would cost titles and images, never funds.

1. On Render: **New → Blueprint**, point it at this repo, and apply.
2. It reads `render.yaml` for the build, the disk, the health check and every environment
   variable, so there is nothing to type in by hand.
3. `/api/health` is the health check. It returns 503 unless the app can reach the cluster
   **and** finds the escrow program deployed there, so a bad `RPC_URL` fails the deploy
   rather than serving a broken site.

Two notes before this takes real traffic:

- `RPC_URL` points at the public devnet endpoint, which is heavily rate-limited. Swap in a
  dedicated RPC provider.
- The service is pinned to one instance. SQLite allows a single writer, so it must not be
  scaled out without moving the index to a hosted database first.

## Run it

```bash
npm install
cp .env.example .env        # defaults to devnet
npm run dev                 # http://localhost:3000
```

On the first request (open http://localhost:3000, or hit `/api/config`) an escrow keypair is generated at
`data/escrow-keypair.json` and its pubkey is logged to the server console.
**Fund it with a little SOL** — it pays the fees for settlement / cancel / refund transactions.
For production set `ESCROW_SECRET_KEY` from a secret manager instead and back it up.

Set `ADMIN_PUBKEYS` to the wallet(s) allowed to resolve disputes via `POST /api/admin/resolve`.

## End-to-end test

`scripts/e2e-devnet.mjs` drives the full token-authority and off-chain flows with two throwaway keypairs
(created in `data/test/`). Devnet's faucet is often rate-limited, so the reliable way is a local validator
with the Metaplex program loaded:

```bash
solana program dump metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s mpl.so -u mainnet-beta
solana-test-validator --reset --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s mpl.so
```

Then, with `RPC_URL=http://127.0.0.1:8899` in `.env.local` and the dev server running:

```bash
RPC_URL=http://127.0.0.1:8899 node scripts/e2e-devnet.mjs
```

It checks: draft → escrow → active, non-seller cancel rejected, bogus/replayed payment signatures rejected,
atomic settlement (buyer holds authorities, seller paid price minus fee), off-chain pay/release, and a
late payment to an already-sold listing being auto-refunded.

## API

All `POST`s take `{ ...body, auth: { pubkey, signature, timestamp } }` where `signature` is the wallet's
ed25519 signature over `Takeover\naction: <action>\nlisting: <id|->\nts: <timestamp>`.

| Route | Action | Who |
| --- | --- | --- |
| `GET /api/config` | escrow pubkey, network, browser RPC endpoint, fee | — |
| `GET /api/token/:mint` | authorities, metadata, pump.fun bonding curve | — |
| `GET /api/listings?status=&type=&wallet=` | browse (`status` defaults to `active`) | — |
| `GET /api/listings/:id` | one listing plus its event log | — |
| `GET /api/activity` | the last 20 market events, for the ticker | — |
| `GET /api/builders` | builder leaderboard | — |
| `GET /api/builders/:wallet` | builder profile, track record and listings | — |
| `POST /api/builders/:wallet` | `profile` — edit your own builder page | that wallet |
| `POST /api/listings` | `create` | seller |
| `POST /api/listings/:id/verify-escrow` | `verify-escrow` — confirms authorities are in escrow, goes live | seller |
| `POST /api/listings/:id/pay` | `pay` — verify SOL transfer, settle or hold | buyer |
| `POST /api/listings/:id/settle` | `settle` — retry token settlement | buyer/seller |
| `POST /api/listings/:id/verify-handoff` | `verify-handoff` — pump.fun on-chain check + delivery note | buyer/seller |
| `POST /api/listings/:id/release` | `release` — buyer releases escrowed SOL | buyer |
| `POST /api/listings/:id/cancel` | `cancel` — returns authorities to seller | seller |
| `POST /api/listings/:id/dispute` | `dispute` | buyer/seller |
| `POST /api/admin/resolve` | `admin-resolve` `{listingId, outcome: release\|refund}` — resolves a **disputed** listing | admin |

## Dev tooling

`node scripts/shots.mjs [outDir] [baseUrl]` screenshots the home page and `/sell` headlessly (needs Google Chrome
installed; `playwright-core` is a devDependency). Output defaults to the gitignored `data/shots`.

`node scripts/seed-demo.mjs` inserts demo listings into the local database so the site can be reviewed with
content in it; `node scripts/seed-demo.mjs --clear` removes them again. Never run it against a real database.

## Environment

`RPC_URL` is the **server** endpoint and may carry an API key: it is used only by route handlers and never sent to a
browser. `NEXT_PUBLIC_RPC_URL` is the **browser** endpoint returned by `/api/config` and handed to the wallet adapter,
so it must be keyless and CORS-open. Node 22.13 or newer is required for the built-in `node:sqlite`.

## The on-chain escrow (`programs/takeover-escrow`)

An Anchor program that replaces the custodial escrow wallet. Funds sit in accounts the
program owns and nobody holds a key for, so neither the operator nor an attacker who
takes the server can move a user's money.

| Instruction | Who | What it does |
| --- | --- | --- |
| `create_listing` | seller | Records the terms. The fee is frozen here, so it can never be raised on a live deal. |
| `escrow_authority` | seller | Moves one token authority into the program's custody. The listing goes live once all promised authorities are in. |
| `buy_token` | buyer | Pays the seller and transfers every authority to the buyer **in a single instruction**. No escrow window at all. |
| `fund` | buyer | Deposits SOL for a pump.fun or project sale and starts the delivery clock. |
| `release` | buyer | Confirms delivery and pays the seller. |
| `refund` | **anyone** | Returns the deposit to the buyer once the deadline passes. |
| `cancel` | seller | Withdraws an unsold listing; escrowed authorities go back. |
| `dispute` / `resolve` | parties / arbitrator | Freeze, then pick a winner. |
| `close_listing` | seller | Reclaims rent from a finished listing. |

Three properties the tests pin down:

- **A token sale cannot half-happen.** Payment and the authority transfer are one
  instruction, so either both land or neither does.
- **A buyer cannot be stranded.** `refund` is permissionless after the deadline, so a
  vanished seller does not trap anyone's money and no operator has to intervene.
- **The arbitrator cannot steal.** On a disputed deal it may only pay the seller or
  refund the buyer, and it cannot touch an undisputed one.

```bash
npm run program:build   # builds the .so and regenerates the IDL
npm run program:test    # 21 adversarial tests against solana-bankrun
```

The build script pins the Solana 4.2.2 toolchain deliberately; see the comment at the
top of `scripts/build-program.sh` for why. Building needs Rust, the Anza toolchain and
Anchor 0.31.1 (via `avm`).

> **Unaudited.** This program is devnet-only. Do not put mainnet funds through it until
> it has been independently reviewed.

## Before mainnet

1. **Paid RPC** (Helius/Triton/QuickNode) for both `RPC_URL` and `NEXT_PUBLIC_RPC_URL`.
2. **Escrow key custody**: the Anchor program in `programs/takeover-escrow` now exists and is tested; what remains is
   an independent audit and rewiring the API routes to build program transactions for the browser to sign, rather
   than signing with a server-held key.
3. **Postgres** instead of SQLite once you have more than one server instance.
4. **pump.fun creator handoff**: the bonding-curve `creator` read at byte offset 49 is best-effort. Verify against
   pump.fun's current program layout (they shipped fee-splitting across up to 10 wallets and ownership transfer in
   Jan 2026) and consider reading the graduated PumpSwap pool's `coin_creator` too.
5. Terms of service, KYC/AML posture, and a dispute-resolution policy for the off-chain asset class.
6. Rate limiting on the API and a job that auto-refunds `paid` off-chain listings with no delivery after N days.
