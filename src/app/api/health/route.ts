import { connection, chainConfig } from "@/lib/solana";
import { json } from "@/lib/api-utils";
import { PROGRAM_ID } from "@/lib/program";

export const dynamic = "force-dynamic";

/** Never let a slow third party hold the health check open. */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), ms)),
  ]);
}

/**
 * The same, but distinguishing "the account is not there" from "the RPC did not answer".
 *
 * `getAccountInfo` returns null for both, so this check spent its life reporting a
 * program that was genuinely absent as merely unverifiable — which is how a site pointed
 * at the wrong cluster went on looking fine.
 */
async function settled<T>(p: Promise<T>, ms: number): Promise<{ ok: true; value: T } | { ok: false }> {
  const marker = Symbol("timeout");
  const r = await Promise.race([
    p.then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const })),
    new Promise<typeof marker>((res) => setTimeout(() => res(marker), ms)),
  ]);
  return r === marker ? { ok: false } : r;
}

/**
 * Liveness for the host. Answers one question: is this process able to serve?
 *
 * It used to answer a different question — "can I reach Solana and is the program
 * deployed?" — and return 503 when it could not. That is a readiness check wearing a
 * liveness check's clothes, and it is what Render polls to decide whether to kill the
 * instance. A slow or misconfigured RPC endpoint therefore took down a web server that was
 * working perfectly: 503, killed, restarted, briefly healthy, 503 again. A crash loop
 * caused entirely by asking an unrelated service for permission to stay alive.
 *
 * The chain's reachability is still reported, because it is genuinely useful to see. It is
 * reported as data. Losing Solana means listings cannot be bought until it comes back; it
 * does not mean this server should be destroyed, and the site still serves everything it
 * holds locally in the meantime.
 */
export async function GET() {
  const cfg = await within(chainConfig(), 2000);

  const [slot, program] = await Promise.all([
    within(connection().getSlot("confirmed"), 2000),
    settled(connection().getAccountInfo(PROGRAM_ID), 3000),
  ]);
  const programDeployed = program.ok ? Boolean(program.value?.executable) : null;

  return json({
    // The process answered, so it is alive. This is the only thing the platform should
    // ever act on, and it is deliberately not conditional on anything external.
    ok: true,
    network: cfg?.network ?? "unknown",
    programId: cfg?.programId ?? PROGRAM_ID.toBase58(),
    // Informational. Null means the RPC did not answer within two seconds — worth an
    // alert, never worth a restart.
    rpcReachable: slot !== null,
    slot,
    programDeployed,
    // Explicitly false, not merely unreachable, means the site is claiming a cluster the
    // program was never deployed to. The process is still healthy — restarting it fixes
    // nothing — so this stays a 200 with a flag a human can alert on.
    misconfigured: programDeployed === false,
  });
}
