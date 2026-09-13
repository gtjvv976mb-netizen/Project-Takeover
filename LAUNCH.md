# Launch checklist and roadmap

**Reviewed** 2026-09-13 · **Commit** 3e80a51 plus this change · **Scope** the web app, the deploy, and the on-chain program as deployed on devnet

This is the state of the site the day it was declared ready to launch, what was verified,
what still stands between it and mainnet money, and what the market research says is
worth building next. Sources are linked so every claim can be checked.

---

## What was verified

| Check | Result |
| --- | --- |
| `npm ci` on Node 22 | Clean install |
| TypeScript (`tsc --noEmit`) | 0 errors |
| ESLint | 0 errors, 10 warnings, all in `scripts/preflight.mjs` (ternaries used as statements, cosmetic) |
| `next build` | 24 routes compile; `/robots.txt` static, everything else dynamic |
| Every page at 1280 px and 390 px in headless Chromium | Renders, no JavaScript errors, no horizontal overflow |
| Every API route | Correct status codes; `/api/listings/:id` returns 404 for an unknown id |
| On-chain program tests (`npm run program:test`) | **46 of 46 pass**, run against the binary actually deployed on devnet (downloaded from the program-data account) rather than a local build |
| `scripts/preflight.mjs` against devnet | Program deployed, fee 5% within cap, config authority / arbitrator / treasury are three distinct keys; program still upgradeable by `F4So…Ffof` |
| `/api/health` | Reports honestly; the public devnet RPC returns 429 under load, which is why `rpcReachable` flips to false from a sandbox |

The program tests could not be run against a fresh local build because the Anza and
Anchor toolchains are not installed in this environment. Running them against the
deployed bytes is the stronger check for launch anyway: it proves what is on chain, not
what is on a laptop.

### Fixed in this change

- **Security headers.** HSTS, `X-Frame-Options: DENY`, `nosniff`, a referrer policy and a
  permissions policy on every response; the `X-Powered-By` header is gone.
- **`robots.txt` and `sitemap.xml`.** The sitemap lists every public page, every live
  listing and every builder with a track record, read from the index on each request.
- **Footer coin column.** The "Coin" heading rendered above nothing until a coin is
  configured. The whole column now hides, as the README promises.
- **One source for the site URL.** `src/lib/site.ts` feeds the layout, robots and sitemap.

---

## Before mainnet money (blocking)

These change what a buyer is actually buying, or who controls the program. Do them before
the first mainnet listing, in this order.

1. **Fee-sharing-aware pump.fun verification.** Since pump.fun's January 2026 creator-fee
   update, the bonding curve's `creator` field can hold a *fee-sharing config* rather than a
   wallet, with an admin who can split fees across up to ten wallets, transfer authority,
   or revoke it permanently. For graduated coins the relevant field is the PumpSwap pool's
   `coinCreator`. `pumpCreatorIs` in `src/lib/solana.ts` compares the raw field to the
   buyer's wallet, so a seller can "hand over" a config in which they still hold 9,000 bps
   and the site would call the deal delivered. Resolve both shapes; if the creator is a
   config, require the buyer to be its admin holding 10,000 bps, or show the share table on
   the listing and refuse revoked configs.
   Sources: [pump.fun SDK fee-sharing doc](https://github.com/nirholas/pump-fun-sdk/blob/main/docs/fee-sharing.md),
   [pump.fun fee schedule](https://pump.fun/docs/fees).
2. **Token-2022 extension allowlist.** `fetchTokenInfo` and the client transaction builder
   only pick the token program id; nothing reads the mint's extensions. A mint with a
   permanent delegate can move any holder's tokens, a transfer hook runs arbitrary code on
   every transfer, and a mint-close authority lets the mint be closed and reinitialised at
   the same address. Refuse those, or show them as red chips on the listing. Metadata may
   also live in the mint itself via the metadata-pointer extension, in which case "update
   authority" is a different authority than the Metaplex one the site reads.
   Sources: [Neodyme on Token-2022](https://neodyme.io/en/blog/token-2022/),
   [Phantom docs](https://docs.phantom.com/developer-powertools/solana-token-extensions-token22).
3. **Squads timelocked multisig for the upgrade and config authorities.** Closes AUDIT.md
   H-2. Publish the multisig address on the site so a buyer can verify it.
   Sources: [Squads security practices](https://docs.squads.so/main/additional-resources/advanced-security-best-practices),
   [solana-upgrade-watch](https://github.com/simonvellin/solana-upgrade-watch).
4. **Independent audit.** Single-purpose programs of this size run roughly $7–20k over about
   a week; standard DeFi scope $20–60k over one to three weeks. Freeze the code first and
   decide on milestone escrow and USDC (below) before booking, since both widen the scope.
   Sources: [Accretion Labs on Solana audit cost](https://accretion.xyz/blog/solana-audit-cost),
   [Sec3](https://sec3.dev/audits), [OtterSec](https://osec.io/).
5. **Per-asset legal copy and a terms of service.** X prohibits buying or selling accounts
   and usernames; Discord bars transferring accounts and vanity URLs without written
   approval; Telegram sanctions username sales via Fragment. The sell form should warn per
   platform and the ToS should disclaim it. A creator-fee stream reads more like a revenue
   right than a collectible, so that asset class needs its own language.
   Sources: [X platform manipulation policy](https://help.twitter.com/en/rules-and-policies/platform-manipulation),
   [Discord terms](https://discord.com/terms),
   [SEC staff statement on meme coins](https://www.sec.gov/newsroom/speeches-statements/staff-statement-meme-coins).
6. **Paid RPC.** Helius Developer ($49/month, 50 rps, webhooks included) is the right first
   tier for `RPC_URL`; keep `NEXT_PUBLIC_RPC_URL` keyless or domain-restricted.
   Source: [Helius pricing](https://www.helius.dev/pricing).

## Launch window

7. **Rate limiting and error monitoring.** Render fronts the service with DDoS protection
   but no WAF; the signed POST routes need a token-bucket limit keyed on `x-forwarded-for`.
   Arcjet or Upstash both work without DNS changes. Sentry's free tier covers launch.
   Sources: [Render DDoS docs](https://render.com/docs/ddos-protection),
   [Upstash rate limiting](https://upstash.com/blog/nextjs-ratelimiting).
8. **Helius webhooks instead of polling.** The program now emits events; program-log
   webhooks let the index follow the chain instead of interrogating it, and they are the
   same plumbing alerts need.
   Source: [Helius webhooks](https://www.helius.dev/blog/webhook-to-email).
9. **Deadline refunds as an on-chain crank.** `refund` is permissionless, so a Tuktuk cron
   task can call it after the deadline. That keeps "the server cannot sign anything" true,
   where a server-side job would not.
   Source: [Tuktuk](https://www.tuktuk.fun/docs).
10. **Listing risk report.** RugCheck's free API (3 rps) returns a 0–100 score with
    authority, LP-lock and holder flags. Put it next to the proof chips: it is the
    Flippa "verified financials" badge at zero cost.
    Source: [RugCheck](https://rugcheck.xyz/).
11. **Per-listing Open Graph images.** `opengraph-image.tsx` with `ImageResponse` turns
    every shared listing link into a card with the art, name and price. Today every link
    shares the one brand card.
    Source: [Next.js metadata and OG images](https://nextjs.org/docs/app/getting-started/metadata-and-og-images).
12. **Content-Security-Policy.** Not shipped with the headers above because the wallet
    adapter and the theme script rely on inline code; a nonce threaded through the layout
    is needed first.
13. **Postgres before a second instance.** Render Postgres keeps everything in one
    blueprint ($6/month basic); Supabase if connection pooling matters.
    Source: [Render Postgres pricing](https://kuberns.com/blogs/render-postgres-pricing-setup-limits/).

## After launch: features the market research supports

Comparable markets studied: Flippa, Acquire.com, Empire Flippers, Escrow.com, Afternic,
Fragment (Telegram usernames on TON), SWAPD and Fameswap (Discord and social accounts),
AllDomains (`.sol` names). No dedicated Solana "community takeover" marketplace exists;
CTOs are still an informal Telegram and X ritual, which is the open lane.

| # | Feature | Why | Effort |
| --- | --- | --- | --- |
| 14 | Milestone escrow for off-chain deals | Escrow.com and Acquire pattern: buyer funds fully, releases per milestone (domain, X, Discord). Needs a program change, so decide before the audit. | L |
| 15 | Verified-seller badges via Solana Attestation Service and Reclaim | Consume an existing Civic or SAS KYC attestation instead of running KYC; zkTLS proofs of X follower counts or Discord ownership for off-chain listings. | M |
| 16 | Dispute settlement layer | Evidence window and a proposed-split negotiation before the arbitrator rules, as in Kleros Escrow V2. Reduces arbitrator load and matches the bounded-arbitrator design. | M |
| 17 | Timed auctions with a reserve | Fragment and Flippa model. Funded offers already exist on chain; add an end time and auto-accept of the highest. | M |
| 18 | Wallet alerts via Dialect or a Telegram bot | Funded, delivered, disputed, deadline-near, and "wanted" matches. Dialect gives email, Telegram and push from one integration. | S |
| 19 | Watchlists and saved searches | Standard on every comparable; feeds the alerts above. | S |
| 20 | Blinks for buy and fund | Transactions are already built client-side; register with Dialect for one-click purchase inside wallets. | S |
| 21 | Market data on listings | DexScreener (free, 300 req/min) or Birdeye for price, volume and holder trend, cached server-side. | S |
| 22 | Post-sale migration checklist | Empire Flippers' migration specialist, productised: per-asset transfer steps, DNS TXT check for domains, admin-role verification for communities. | M |
| 23 | `.sol` domains as an on-chain asset type | AllDomains names are NFTs; atomic settlement like `buy_token`. A natural fourth category. | M |
| 24 | USDC-denominated listings | Sellers price in dollars; pump.fun already runs USDC pools. Needs an SPL-transfer escrow path in the program. | L |
| 25 | Buyer funds-verification badge | Acquire's key seller-trust feature; funded offers already prove it on chain, so surface it on buyer profiles. | S |
| 26 | Referral payouts | A referrer pubkey on `create_listing`, paid from the fee. | M |

Sources for this section: [Flippa auctions](https://support.flippa.com/hc/en-us/articles/360001027595-How-does-an-Auction-work),
[Acquire Escrow Builder](https://blog.acquire.com/close-safely-and-easily-with-escrow-builder/),
[Escrow.com milestones](https://www.escrow.com/milestones/how-it-works),
[Fragment](https://www.theblock.co/learn/304420/what-is-fragment-and-how-can-you-buy-telegram-usernames-on-the-ton-blockchain),
[Kleros Escrow](https://docs.kleros.io/products/escrow),
[Solana Attestation Service](https://attest.solana.com/use-cases/civic),
[Reclaim on Solana](https://github.com/reclaimprotocol/reclaim-solana-example),
[Dialect alerts](https://docs.dialect.to/alerts),
[Solana Actions and Blinks](https://solana.com/docs/tools/actions),
[AllDomains](https://docs.alldomains.id/protocol/.sol-plus-domain-names),
[CTO explainer](https://coinmarketcap.com/academy/glossary/community-takeover-cto).

---

## Known, accepted, and why

- **`npm audit` reports 10 advisories**, all transitive through `@solana/web3.js` v1 and
  Anchor (`bigint-buffer`, `toml`, `stream-json`, `uuid`). None sits on a path fed by a
  request body: the site never parses TOML, and `bigint-buffer` only sees account bytes
  read from chain through spl-token's own layout parsers. Clearing them means the web3.js
  v2 migration, which is a rewrite of every transaction builder and not a launch task.
- **The wallet adapter's stylesheet imports DM Sans from Google Fonts.** One third-party
  request per page load. Harmless, but the site's own fonts are self-hosted through
  `next/font`, so this is the only external font left; override the adapter's font rule
  in `globals.css` when convenient.
- **Signed requests carry a 5-minute window and no nonce.** A captured signature could be
  replayed for the same action and listing inside that window. Every action is idempotent
  or state-guarded, so the damage is nil today; add a per-signature seen-set (the
  `used_signatures` table already exists for payments) if a non-idempotent action is ever
  added.
- **Missing listing pages return 200.** The page fetches client-side and shows the API's
  "not found" message. Crawlers see a 200 with no content; a server-side `notFound()` would
  be cleaner. Cosmetic until there are enough dead links to matter.
