import { connection, chainConfig } from "@/lib/solana";
import { json } from "@/lib/api-utils";
import { PROGRAM_ID } from "@/lib/program";

export const dynamic = "force-dynamic";

/**
 * Liveness for the host, and a genuine readiness check: the site is only useful if it
 * can reach the cluster and the escrow program is actually deployed there.
 */
export async function GET() {
  const cfg = await chainConfig();
  try {
    const [slot, program] = await Promise.all([
      connection().getSlot("confirmed"),
      connection().getAccountInfo(PROGRAM_ID),
    ]);
    const ok = Boolean(program?.executable);
    return json(
      {
        ok,
        network: cfg.network,
        slot,
        programId: cfg.programId,
        programDeployed: ok,
      },
      ok ? 200 : 503,
    );
  } catch (e) {
    return json({ ok: false, network: cfg.network, error: (e as Error).message }, 503);
  }
}
