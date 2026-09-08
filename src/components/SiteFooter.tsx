"use client";
import { usePathname } from "next/navigation";
import type { AppConfig } from "@/lib/types";

/** Hidden on the harbour, which is a full-viewport world with no page chrome below it. */
export function SiteFooter({ config }: { config: AppConfig }) {
  const path = usePathname();
  if (path === "/") return null;
  return (
    <footer className="relative z-10 mx-auto max-w-6xl break-all bg-ink px-4 py-10 text-xs text-mute">
      <div className="label mb-2">Project: Takeover · independent · not affiliated with pump.fun or any company</div>
      <span className="font-mono">escrow {config.escrowPubkey}</span> · fee {config.feeBps / 100}% · {config.network}
    </footer>
  );
}
