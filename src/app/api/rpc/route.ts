import { RPC_URL } from "@/lib/solana";
import { handleError, HttpError } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

/**
 * The browser's way to reach Solana.
 *
 * Wallets and this site's own transaction code need an RPC endpoint they can call from a
 * web page, and the obvious one does not work: api.mainnet-beta.solana.com is documented
 * as not for production applications and answers dapp traffic with `403 Access
 * forbidden`. With no NEXT_PUBLIC_RPC_URL set that is exactly where the browser went, so
 * every on-chain action failed at "failed to get recent blockhash" and even the slot
 * counter on the front page sat at a dash.
 *
 * The alternative is putting a provider's URL in a NEXT_PUBLIC_ variable, which publishes
 * whatever key it carries to everyone who loads the page. So instead the browser talks to
 * this route on our own origin and the server forwards to the endpoint it already uses.
 * The key stays server-side, and there is no CORS to negotiate because it is same-origin.
 *
 * Forwarding anything at all would make this an open proxy to a metered endpoint, so it
 * carries the two restrictions that matter: a list of methods a wallet or this site
 * actually calls, and a ceiling on how often one address may call them.
 */

/**
 * Read-only methods, plus the two writes a signed transaction needs. Nothing here can act
 * on an account: `sendTransaction` forwards bytes the user's own wallet has signed, and
 * this server holds no key that could sign anything.
 */
const ALLOWED = new Set([
  // building and sending a transaction
  "getLatestBlockhash", "getLatestBlockhashAndContext", "isBlockhashValid", "getFeeForMessage",
  "sendTransaction", "simulateTransaction", "getSignatureStatuses", "getSignatureStatus",
  // reading state: Anchor's account fetches, balances, rent
  "getAccountInfo", "getMultipleAccounts", "getBalance", "getMinimumBalanceForRentExemption",
  "getTokenAccountBalance", "getTokenAccountsByOwner", "getTokenSupply",
  // chain position, used by confirmation and by the slot counter
  "getSlot", "getBlockHeight", "getEpochInfo", "getRecentPrioritizationFees",
  // identity checks wallets make on connect
  "getVersion", "getGenesisHash", "getHealth",
  // the error path: Anchor re-fetches a failed transaction for its logs
  "getTransaction",
]);

/** Enough for a large batch or a transaction at the wire limit, and no more. */
const MAX_BODY = 1024 * 1024;

/**
 * A ceiling per address. The front page polls the slot every two seconds, so this has to
 * sit well above a browsing tab; it exists to stop a script from turning our endpoint
 * into free bandwidth, not to ration ordinary use. In memory, so it resets on deploy —
 * a persistent counter for this would cost a write per call.
 */
const RATE = { windowMs: 60_000, max: 600 };
const hits = new Map<string, number[]>();

function rateLimit(who: string) {
  const now = Date.now();
  const recent = (hits.get(who) ?? []).filter((t) => now - t < RATE.windowMs);
  if (recent.length >= RATE.max) throw new HttpError(429, "Too many RPC requests. Wait a moment.");
  recent.push(now);
  hits.set(who, recent);
  if (hits.size > 10_000) for (const [k, v] of hits) if (v[v.length - 1] < now - RATE.windowMs) hits.delete(k);
}

/** Best effort: behind a proxy the first hop is the client. Spoofable, and only a bound. */
function caller(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0] : null)?.trim() || req.headers.get("x-real-ip") || "unknown";
}

type Call = { method?: unknown; id?: unknown };

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) throw new HttpError(413, "RPC request too large");

    let body: Call | Call[];
    try { body = JSON.parse(raw) as Call | Call[]; }
    catch { throw new HttpError(400, "Malformed JSON-RPC request"); }

    // web3.js batches some reads, so a body may be an array of calls. Every one of them
    // has to be allowed — a single unlisted method rejects the batch.
    const calls = Array.isArray(body) ? body : [body];
    if (calls.length === 0 || calls.length > 100) throw new HttpError(400, "Bad JSON-RPC batch");
    for (const c of calls) {
      if (typeof c?.method !== "string") throw new HttpError(400, "Bad JSON-RPC request");
      if (!ALLOWED.has(c.method)) throw new HttpError(403, `Method not available here: ${c.method}`);
    }

    rateLimit(caller(req));

    const upstream = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
      // A slow validator should surface as an error rather than holding the connection.
      signal: AbortSignal.timeout(30_000),
    });

    const text = await upstream.text();
    // Pass the answer through untouched — including an upstream error, which the caller
    // needs to see as JSON-RPC rather than as a rewritten HTTP failure. The upstream URL
    // is never echoed: that is the one thing here worth keeping to ourselves.
    return new Response(text, {
      status: upstream.ok ? 200 : 502,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (e) {
    return handleError(e);
  }
}
