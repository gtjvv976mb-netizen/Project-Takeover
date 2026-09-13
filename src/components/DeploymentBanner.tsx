"use client";
import { useConfig } from "./ConfigContext";

/**
 * Says so, loudly, when this deployment is pointed at a cluster where the escrow program
 * does not exist.
 *
 * This happened: `SOLANA_NETWORK` was switched to mainnet before the program was deployed
 * there, and the site went on looking like a working marketplace. Somebody listed a real
 * project for 100 SOL on it. Nothing warned them, because every page renders from the
 * local index and only a purchase would have failed — by which point the person had
 * already believed the site.
 *
 * The preflight refuses a deploy in this state, but the site's network is an environment
 * variable and nothing gated it. So the site now checks the one thing that makes it a
 * marketplace at all, and admits it when the answer is no.
 *
 * Null means the RPC did not answer in time, which is not the same as missing and is not
 * shown: a slow endpoint must never make the site accuse itself.
 */
export function DeploymentBanner() {
  const cfg = useConfig();
  if (cfg.programDeployed !== false) return null;
  return (
    <div
      role="alert"
      className="border-b px-4 py-3 text-center text-[14px] leading-relaxed"
      style={{
        borderColor: "color-mix(in srgb, var(--color-rose) 45%, transparent)",
        background: "color-mix(in srgb, var(--color-rose) 12%, var(--color-tint-base))",
        color: "var(--color-ink)",
      }}
    >
      <strong>This site is misconfigured and nothing can be bought or sold.</strong>{" "}
      It is pointed at <span className="mono">{cfg.network}</span>, where the escrow program{" "}
      <span className="mono break-all">{cfg.programId}</span> is not deployed. Do not list anything
      or send anyone money until this line is gone.
    </div>
  );
}
