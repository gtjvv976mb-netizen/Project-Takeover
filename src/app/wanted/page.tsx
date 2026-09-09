"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { formatSol, shortKey, type WantedRow } from "@/lib/types";
import { Alert, Button, Chip, inputCls } from "@/components/ui";
import { CoverArt } from "@/components/CoverArt";
import { useReveal } from "@/lib/motion";

/**
 * The demand side of the market. Anyone can put a token here; its owner does not need
 * an account, or to have heard of this site. It turns an empty marketplace into a
 * signal a dev can find by searching their own ticker.
 */
export default function WantedPage() {
  const router = useRouter();
  const [board, setBoard] = useState<WantedRow[] | null>(null);
  const [mint, setMint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useReveal<HTMLDivElement>(0.05);

  useEffect(() => {
    let off = false;
    fetch("/api/wanted").then((r) => r.json()).then((b) => { if (!off) setBoard(b); }).catch(() => { if (!off) setBoard([]); });
    return () => { off = true; };
  }, []);

  function go() {
    const v = mint.trim();
    try {
      router.push(`/token/${new PublicKey(v).toBase58()}`);
    } catch {
      setError("That does not look like a Solana mint address.");
    }
  }

  return (
    <div className="wrap py-10">
      <div className="mx-auto max-w-2xl text-center">
        <div className="kicker">The demand side</div>
        <h1 className="title-lg mt-2">Want a project nobody&apos;s selling?</h1>
        <p className="lead mx-auto mt-3">
          Paste any Solana token. We&apos;ll pull everything the chain knows about it and give it a
          page, whether or not its owner has ever been here. Then say what you&apos;d pay.
        </p>

        <div className="mx-auto mt-7 flex max-w-xl flex-col gap-3 sm:flex-row">
          <input
            className={`${inputCls} flex-1 !py-3.5 font-mono text-[14px]`}
            placeholder="Paste a mint address…"
            value={mint}
            onChange={(e) => { setMint(e.target.value); setError(null); }}
            onKeyDown={(e) => e.key === "Enter" && go()}
            aria-label="Token mint address"
          />
          <Button className="!py-3.5" onClick={go} disabled={!mint.trim()}>Look it up</Button>
        </div>
        {error && <div className="mx-auto mt-3 max-w-xl"><Alert kind="error">{error}</Alert></div>}
        <p className="mt-3 text-[13px] text-faint">
          Works for any SPL token or pump.fun coin. Nothing is spent, and nobody is messaged.
        </p>
      </div>

      <section className="mt-14">
        <div className="mb-5 flex flex-wrap items-baseline gap-3">
          <h2 className="text-[22px] font-bold text-ink">Most wanted</h2>
          {board && <span className="kicker">{board.length} {board.length === 1 ? "project" : "projects"}</span>}
        </div>

        {board === null ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="card h-64 overflow-hidden"><div className="skeleton h-full !rounded-none" /></div>)}
          </div>
        ) : board.length === 0 ? (
          <div className="card grid place-items-center px-6 py-16 text-center">
            <div className="text-5xl" aria-hidden>🔎</div>
            <h3 className="mt-4 text-[20px] font-bold text-ink">Nobody&apos;s asked for anything yet</h3>
            <p className="mt-2 max-w-sm text-[15px] text-muted">
              Paste a mint above and be the first to put a project on the board.
            </p>
          </div>
        ) : (
          <div ref={ref} data-reveal className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {board.map((row, i) => (
              <Link
                key={row.mint}
                href={`/token/${row.mint}`}
                style={{ ["--i" as string]: i, ["--accent" as string]: "var(--color-brand)" }}
                className="card card-hover group flex flex-col overflow-hidden"
              >
                <CoverArt seed={row.mint} image={row.token?.image} symbol={row.token?.symbol} className="aspect-[16/10] w-full" />
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip tint="var(--color-brand)">{row.interest} {row.interest === 1 ? "buyer" : "buyers"}</Chip>
                    {row.token?.pump && <Chip tint="var(--color-tangerine)">pump.fun</Chip>}
                  </div>
                  <div>
                    <h3 className="text-[18px] font-bold leading-snug text-ink group-hover:text-brand">
                      {row.token?.name ?? shortKey(row.mint, 5)}
                    </h3>
                    {row.token?.symbol && <p className="mt-0.5 text-[14px] text-muted">${row.token.symbol}</p>}
                  </div>
                  <div className="mt-auto flex items-end justify-between border-t border-line pt-3">
                    <div>
                      <div className="kicker mb-1">Best indication</div>
                      <div className="text-[19px] font-bold text-ink">
                        {row.topIndicativeLamports > 0 ? `~${formatSol(row.topIndicativeLamports)} SOL` : "—"}
                      </div>
                    </div>
                    <span className="text-[13px] font-semibold text-brand transition-all group-hover:pr-1">View →</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
