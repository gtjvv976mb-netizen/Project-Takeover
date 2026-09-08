"use client";
import Link from "next/link";
import type { AppConfig } from "@/lib/types";
import { SlotHeight } from "./SlotHeight";
import { Button } from "./ui";

export function SiteFooter({ config }: { config: AppConfig }) {
  return (
    <footer className="mt-4 border-t border-line bg-surface">
      <div className="wrap py-14">
        <div className="card overflow-hidden">
          <div className="relative grid gap-6 p-8 md:grid-cols-[1.4fr_auto] md:items-center"
            style={{ background: "linear-gradient(120deg, color-mix(in srgb, var(--color-brand) 10%, white), color-mix(in srgb, var(--color-teal) 10%, white))" }}>
            <div>
              <h2 className="title-lg">Built something? Get paid for it.</h2>
              <p className="lead mt-2">List it in a couple of minutes. You only pay a fee when it sells.</p>
            </div>
            <Link href="/sell"><Button className="w-full md:w-auto">List your project</Button></Link>
          </div>
        </div>

        <div className="mt-10 grid gap-8 text-[14px] md:grid-cols-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-7 w-7 rounded-lg" style={{ background: "linear-gradient(135deg, var(--color-brand), var(--color-teal))" }} aria-hidden />
              <span className="font-bold text-ink">Project: Takeover</span>
            </div>
            <p className="mt-3 text-muted">A safer way to hand over what you built on Solana.</p>
          </div>
          <div className="space-y-2">
            <div className="kicker">Explore</div>
            <Link className="block text-muted hover:text-ink" href="/">Projects for sale</Link>
            <Link className="block text-muted hover:text-ink" href="/sell">List your project</Link>
            <Link className="block text-muted hover:text-ink" href="/dashboard">My deals</Link>
            <Link className="block text-muted hover:text-ink" href="/how-it-works">How it works</Link>
          </div>
          <div className="space-y-2">
            <div className="kicker">Network</div>
            <div className="text-muted">Solana slot <SlotHeight /></div>
            <div className="text-muted">Fee {config.feeBps / 100}% · {config.network}</div>
          </div>
          <div className="space-y-2">
            <div className="kicker">Escrow program</div>
            <div className="mono break-all text-[12px] text-faint">{config.programId}</div>
            <div className="text-[12px] text-faint">Funds sit in accounts this program owns. Nobody holds a key to them, including us.</div>
          </div>
        </div>

        <p className="mt-10 border-t border-line pt-6 text-[13px] text-faint">
          Independent project. Not affiliated with, endorsed by, or connected to pump.fun or any other company.
        </p>
      </div>
    </footer>
  );
}
