"use client";
import Link from "next/link";
import { formatSol, shortKey, type BuilderProfile, type BuilderStats } from "@/lib/types";

export function BuilderChip({ wallet, profile }: { wallet: string; profile?: BuilderProfile | null }) {
  return (
    <Link href={`/builders/${wallet}`} className="inline-flex items-center gap-2 border border-line bg-bg-2 px-2.5 py-1 text-xs hover:border-blue">
      <span className="inline-block h-3 w-3 rotate-45 bg-brand" />
      <span className="font-medium">{profile?.name || shortKey(wallet, 4)}</span>
    </Link>
  );
}

export function StatTiles({ stats }: { stats: BuilderStats }) {
  const tiles = [
    { k: "Shipped", v: String(stats.listed) },
    { k: "Sold", v: String(stats.sold) },
    { k: "Earned", v: `${formatSol(stats.earnedLamports, 2)} SOL` },
    { k: "Building since", v: stats.firstListedAt ? new Date(stats.firstListedAt).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.k} className=" border border-line bg-bg-2 p-3">
          <div className="text-xs text-faint">{t.k}</div>
          <div className="mt-1 text-lg font-bold">{t.v}</div>
        </div>
      ))}
    </div>
  );
}
