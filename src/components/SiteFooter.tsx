"use client";
import Link from "next/link";
import type { AppConfig } from "@/lib/types";
import { SlotHeight } from "./SlotHeight";
import { Button } from "./ui";
import { Logo } from "./Logo";
import { TokenStrip } from "./TokenStrip";

export function SiteFooter({ config }: { config: AppConfig }) {
  return (
    <footer className="mt-4 border-t border-line bg-surface">
      <div className="wrap py-14">
        {/* The same two doors as the top of the front page, for whoever scrolled past
            them. Both audiences, both named. */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card flex flex-col gap-4 p-7" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--color-teal) 12%, var(--color-surface)), var(--color-surface))" }}>
            <div className="kicker" style={{ color: "var(--color-teal)" }}>Need something built?</div>
            <h2 className="title-md">Post it. Developers come to you.</h2>
            <p className="text-[14.5px] text-muted">Free to post, nothing moves until you pick someone, and your SOL stays in escrow until the work lands.</p>
            <Link href="/requests#post" className="mt-auto"><Button className="w-full sm:w-auto">Post a request</Button></Link>
          </div>
          <div className="card flex flex-col gap-4 p-7" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--color-brand) 12%, var(--color-surface)), var(--color-surface))" }}>
            <div className="kicker" style={{ color: "var(--color-brand)" }}>Built something?</div>
            <h2 className="title-md">Get paid for it.</h2>
            <p className="text-[14.5px] text-muted">List it in a couple of minutes. You pay a fee only when it sells, and the buyer&rsquo;s money is locked before you hand anything over.</p>
            <Link href="/sell" className="mt-auto"><Button className="w-full sm:w-auto">List a project</Button></Link>
          </div>
        </div>

        <div className={`mt-12 grid gap-8 text-[14px] sm:grid-cols-2 ${config.tokenMint ? "lg:grid-cols-6" : "lg:grid-cols-5"}`}>
          <div className="sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2">
              <Logo size={28} />
              <span className="font-bold text-ink">Project: Takeover</span>
            </div>
            <p className="mt-3 text-muted">You dream it. Devs build it.</p>
          </div>
          <div className="space-y-2">
            <div className="kicker">For buyers</div>
            <Link className="block text-muted hover:text-ink" href="/requests#post">Post a request</Link>
            <Link className="block text-muted hover:text-ink" href="/builders">Find a builder</Link>
            <Link className="block text-muted hover:text-ink" href="/#market">Projects for sale</Link>
            <Link className="block text-muted hover:text-ink" href="/how-it-works">How escrow works</Link>
          </div>
          <div className="space-y-2">
            <div className="kicker">For builders</div>
            <Link className="block text-muted hover:text-ink" href="/sell">List a project</Link>
            <Link className="block text-muted hover:text-ink" href="/requests">Open requests</Link>
            <Link className="block text-muted hover:text-ink" href="/wanted">Coins people want</Link>
            <Link className="block text-muted hover:text-ink" href="/dashboard">My deals</Link>
          </div>
          {config.tokenMint && (
            <div className="space-y-2">
              <div className="kicker">Coin</div>
              <TokenStrip />
            </div>
          )}
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
