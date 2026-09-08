"use client";
import Link from "next/link";
import type { AppConfig } from "@/lib/types";
import { SlotHeight } from "./press/Vitals";

export function SiteFooter({ config }: { config: AppConfig }) {
  return (
    <footer className="relative z-[2] mt-24 border-t border-rule bg-ink text-paper">
      <div className="mx-auto max-w-[1400px] px-4 py-12 sm:px-6">
        <div className="grid gap-8 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="font-display text-[clamp(30px,4vw,52px)] uppercase leading-[0.86]">
              Built something?<br /><span className="text-flare">Get paid for it.</span>
            </div>
            <Link href="/sell" className="takeover takeover-flare mt-5 inline-flex border border-paper px-5 py-3 font-mono text-[11px] uppercase tracking-[0.16em]">
              <span className="t-title">List your work</span>
            </Link>
          </div>
          <div className="space-y-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper/60">
            <Link className="block hover:text-paper" href="/">Market</Link>
            <Link className="block hover:text-paper" href="/how-it-works">How escrow works</Link>
            <Link className="block hover:text-paper" href="/dashboard">My deals</Link>
          </div>
          <div className="space-y-2 font-mono text-[11px] text-paper/60">
            <div className="uppercase tracking-[0.14em] text-paper/40">Solana slot</div>
            <div className="text-[15px] text-paper"><SlotHeight /></div>
            <div className="pt-3 uppercase tracking-[0.14em] text-paper/40">Escrow wallet</div>
            <div className="break-all text-paper/80">{config.escrowPubkey}</div>
            <div>fee {config.feeBps / 100}% · {config.network}</div>
          </div>
        </div>
        <p className="mt-10 border-t border-paper/15 pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper/40">
          Independent project. Not affiliated with, endorsed by, or connected to pump.fun or any other company.
        </p>
      </div>
    </footer>
  );
}
