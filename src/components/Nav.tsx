"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useConfig } from "./ConfigContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Logo } from "./Logo";

const WalletMultiButton = dynamic(async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton, { ssr: false });

/**
 * Five places, not eight. The old row listed every page at the same weight, which
 * is how a header ends up telling a newcomer nothing. These are the four rooms and
 * the map; "Sell" became the one button on the right, since it is the thing a
 * builder came to do, and "Wanted" moved to the footer because it overlaps with
 * Requests and was confusing people who had not read the difference.
 */
const LINKS = [
  { href: "/", label: "Projects" },
  { href: "/requests", label: "Requests" },
  { href: "/builders", label: "Builders" },
  { href: "/forum", label: "Board" },
  { href: "/how-it-works", label: "How it works" },
];

export function Nav() {
  const cfg = useConfig();
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="wrap flex h-16 items-center gap-4">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5" aria-label="Project: Takeover — home">
          <span className="logo-fill"><Logo size={30} /></span>
          <span className="hidden text-[17px] font-bold tracking-tight text-ink sm:inline">Project: Takeover</span>
        </Link>

        <nav className="ml-3 hidden items-center gap-0.5 lg:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={active(l.href) ? "page" : undefined}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-[14px] font-semibold transition-colors ${active(l.href) ? "bg-bg-2 text-ink" : "text-muted hover:bg-bg-2 hover:text-ink"}`}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Link href="/dashboard" className="hidden whitespace-nowrap rounded-lg px-3 py-2 text-[14px] font-semibold text-muted transition-colors hover:bg-bg-2 hover:text-ink md:inline-block">
            My deals
          </Link>
          <ThemeToggle />
          {cfg.network !== "mainnet-beta" && (
            <span className="pill hidden sm:inline-flex" style={{ ["--tint" as string]: "var(--color-amber)" }}>{cfg.network}</span>
          )}
          <Link href="/sell" className="btn btn-primary hidden whitespace-nowrap !px-4 !py-2 text-[14px] md:inline-flex">List a project</Link>
          <WalletMultiButton />
        </div>
      </div>

      {/* mobile nav: the same rooms, plus the two things the buttons above carry on desktop */}
      <nav className="flex gap-1 overflow-x-auto border-t border-line px-4 py-2 lg:hidden">
        {[...LINKS, { href: "/sell", label: "Sell" }, { href: "/dashboard", label: "My deals" }].map((l) => (
          <Link key={l.href} href={l.href} aria-current={active(l.href) ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold ${active(l.href) ? "bg-bg-2 text-ink" : "text-muted"}`}>
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
