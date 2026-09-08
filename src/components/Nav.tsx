"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useConfig } from "./ConfigContext";

const WalletMultiButton = dynamic(async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton, { ssr: false });

const LINKS = [
  { href: "/", label: "Market" },
  { href: "/sell", label: "List your work" },
  { href: "/dashboard", label: "My deals" },
  { href: "/how-it-works", label: "How it works" },
];

export function Nav() {
  const cfg = useConfig();
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper">
      <div className="mx-auto flex max-w-[1400px] items-stretch gap-4 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 py-3.5">
          <span className="grid h-6 w-6 grid-cols-2 border border-rule" aria-hidden>
            <span className="bg-ink" /><span className="bg-flare" /><span className="bg-flare" /><span className="bg-ink" />
          </span>
          <span className="font-display text-[19px] uppercase leading-none tracking-tight">Project: Takeover</span>
        </Link>
        <nav className="ml-auto flex items-stretch overflow-x-auto">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={path === l.href ? "page" : undefined}
              className="takeover takeover-under relative flex shrink-0 items-center px-3 font-mono text-[11px] uppercase tracking-[0.16em] text-mute transition-colors hover:text-ink aria-[current=page]:text-ink"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-3 border-l border-rule pl-4">
          {cfg.network !== "mainnet-beta" && (
            <span className="hidden items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-flare-ink sm:flex">
              <span className="live-sq" />{cfg.network}
            </span>
          )}
          <WalletMultiButton />
        </div>
      </div>
    </header>
  );
}
