"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useConfig } from "./ConfigContext";

const WalletMultiButton = dynamic(async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton, { ssr: false });

const LINKS = [
  { href: "/", label: "Browse" },
  { href: "/wanted", label: "Wanted" },
  { href: "/sell", label: "Sell" },
  { href: "/dashboard", label: "My deals" },
  { href: "/how-it-works", label: "How it works" },
];

export function Nav() {
  const cfg = useConfig();
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="wrap flex h-16 items-center gap-4">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <span className="h-8 w-8 rounded-xl" style={{ background: "linear-gradient(135deg, var(--color-brand), var(--color-teal))" }} aria-hidden />
          <span className="text-[17px] font-bold tracking-tight text-ink">Project: Takeover</span>
        </Link>

        <nav className="ml-2 hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}
              className={`rounded-lg px-3 py-2 text-[14px] font-semibold transition-colors ${path === l.href ? "bg-bg-2 text-ink" : "text-muted hover:bg-bg-2 hover:text-ink"}`}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {cfg.network !== "mainnet-beta" && (
            <span className="pill hidden sm:inline-flex" style={{ ["--tint" as string]: "var(--color-amber)" }}>{cfg.network}</span>
          )}
          <WalletMultiButton />
        </div>
      </div>

      {/* mobile nav */}
      <nav className="flex gap-1 overflow-x-auto border-t border-line px-4 py-2 md:hidden">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold ${path === l.href ? "bg-bg-2 text-ink" : "text-muted"}`}>
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
