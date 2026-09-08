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

## The site

Project: Takeover is a light, warm-newsprint trade paper that settles Solana handovers
through escrow. Anton headlines, 1px hairlines, no border radius, one vermillion, one
highlighter, one verification blue.

**The signature move.** Every listing is a full-width index row on a rule. Point at one,
or tab to it, and a solid black bar wipes across in 380ms and inverts it: the title goes
to paper, the price to vermillion, an arrow slides in. On leave the bar retracts to the
right, so it reads as a physical bar passing over the row rather than a fill animating
out. That single gesture is the product, repeated down the page. It is one pseudo-element
and one `scaleX`, it works on keyboard focus, and under reduced motion it becomes
instantaneous rather than absent.

**What makes it feel alive.** The masthead carries the real Solana slot height, polled
every 2s and advanced locally between polls, so a nine-digit number is always physically
rolling even with zero listings. Counters count up once on reveal, the activity tape runs
as a marquee that pauses on hover, status squares pulse out of phase so the page twinkles
instead of ticking like a metronome, and headline lines rise out of a mask on scroll.

**Motion rules.** Loops animate `transform` and `opacity` only. `box-shadow`, `filter`,
`width`/`height` and `background-position` are never animated. At most two rAF loops are
alive at once. `prefers-reduced-motion` is honoured in one authoritative block and the JS
loops never start under it.

## Stack

- Next.js 16 (App Router, TypeScript, Tailwind v4), React 19
- No animation or 3D dependencies. Everything moves with CSS plus three small hooks
  (`IntersectionObserver` reveal, a one-shot rAF count-up, an interval word roll)
- `@solana/web3.js` v1, `@solana/spl-token`, Solana Wallet Adapter (Wallet Standard: Phantom, Solflare, Backpack…)
- SQLite via Node's built-in `node:sqlite` (Node ≥ 22.13 / 24) — no native deps
- Wallet-signature auth for every mutating API call (`tweetnacl` verify, 5-minute window)

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

## Before mainnet

1. **Paid RPC** (Helius/Triton/QuickNode) for both `RPC_URL` and `NEXT_PUBLIC_RPC_URL`.
2. **Escrow key custody**: hardware-backed or KMS-held key, never on the web box's disk. Better still, replace the
   custodial escrow wallet with an Anchor escrow program (listing PDA holds authorities + SOL; settlement is a
   single permissionless instruction). The route handlers are already shaped for that swap.
3. **Postgres** instead of SQLite once you have more than one server instance.
4. **pump.fun creator handoff**: the bonding-curve `creator` read at byte offset 49 is best-effort. Verify against
   pump.fun's current program layout (they shipped fee-splitting across up to 10 wallets and ownership transfer in
   Jan 2026) and consider reading the graduated PumpSwap pool's `coin_creator` too.
5. Terms of service, KYC/AML posture, and a dispute-resolution policy for the off-chain asset class.
6. Rate limiting on the API and a job that auto-refunds `paid` off-chain listings with no delivery after N days.
