"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { TokenInfo } from "@/lib/types";

type Coin = { configured: boolean; mint: string | null; symbol: string | null; token: TokenInfo | null };

/**
 * A quiet live line for the project's own coin. Renders nothing at all until a mint is
 * configured, so the site never shows a placeholder ticker.
 */
export function TokenStrip() {
  const [coin, setCoin] = useState<Coin | null>(null);

  useEffect(() => {
    let off = false;
    const load = () => fetch("/api/coin").then((r) => r.json()).then((c) => { if (!off) setCoin(c); }).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => { off = true; clearInterval(id); };
  }, []);

  if (!coin?.configured || !coin.token) return null;
  const p = coin.token.pump;
  const sym = coin.symbol ? `$${coin.symbol}` : "the coin";

  return (
    <Link
      href="/coin"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-line bg-surface px-3.5 py-2 text-[13px] transition-colors hover:border-brand/40"
    >
      <span className="font-bold text-ink">{sym}</span>
      {p?.priceSol != null && (
        <span className="text-muted">
          <span className="mono text-ink">{p.priceSol < 0.000001 ? p.priceSol.toExponential(2) : p.priceSol.toPrecision(3)}</span> SOL
        </span>
      )}
      {p?.marketCapSol != null && (
        <span className="text-muted">mcap <span className="mono text-ink">{Math.round(p.marketCapSol).toLocaleString()}</span> SOL</span>
      )}
      {p?.complete ? (
        <span className="pill" style={{ ["--tint" as string]: "var(--color-blue)" }}>graduated</span>
      ) : p?.progress != null ? (
        <span className="flex items-center gap-2 text-muted">
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-bg-2">
            <span className="block h-full rounded-full" style={{ width: `${Math.round(p.progress * 100)}%`, background: "linear-gradient(90deg,var(--color-brand),var(--color-teal))" }} />
          </span>
          {Math.round(p.progress * 100)}%
        </span>
      ) : null}
    </Link>
  );
}
