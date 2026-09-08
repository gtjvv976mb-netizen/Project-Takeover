"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useConfig } from "./ConfigContext";
import { Logo } from "./Logo";

const WalletMultiButton = dynamic(async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton, { ssr: false });

export function Nav() {
  const cfg = useConfig();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-ink/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 overflow-x-auto px-4 py-3">
        <Link href="/" className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
          <Logo />
          {cfg.appName}
        </Link>
        <nav className="flex items-center gap-4 whitespace-nowrap text-sm text-mute">
          <Link href="/" className="hover:text-white">Browse</Link>
          <Link href="/sell" className="hover:text-white">List your work</Link>
          <Link href="/dashboard" className="hover:text-white">My deals</Link>
          <Link href="/how-it-works" className="hover:text-white">How it works</Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {cfg.network !== "mainnet-beta" && (
            <span className="label rounded-sm border border-amber/40 px-2 py-1 !text-amber"><span className="blink mr-1">●</span>{cfg.network}</span>
          )}
          <WalletMultiButton />
        </div>
      </div>
    </header>
  );
}
