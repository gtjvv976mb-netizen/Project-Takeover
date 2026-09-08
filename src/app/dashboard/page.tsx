"use client";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { api } from "@/lib/client/api";
import type { Listing } from "@/lib/types";
import { ListingCard, Button } from "@/components/ui";
import Link from "next/link";

export default function Dashboard() {
  const wallet = useWallet();
  const [data, setData] = useState<{ wallet: string; items: Listing[] } | null>(null);
  const me = wallet.publicKey?.toBase58();
  const items = me && data?.wallet === me ? data.items : null;
  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    api.listings({ status: "all", wallet: me }).then((items) => { if (!cancelled) setData({ wallet: me, items }); });
    return () => { cancelled = true; };
  }, [me]);

  if (!me) return <p className="page text-mute">Connect your wallet to see your listings and purchases.</p>;
  if (!items) return <p className="page text-mute">Loading…</p>;
  const selling = items.filter((l) => l.seller === me);
  const buying = items.filter((l) => l.buyer === me);
  const needsAction = items.filter((l) => l.status === "draft" || l.status === "paid" || l.status === "disputed");
  return (
    <div className="page space-y-12">
      <div className="flex flex-wrap items-center gap-3 border border-rule-soft bg-paper-2 p-4">
        <div className="flex-1 text-sm text-mute">Your builder page is what buyers check before they trust a listing. Keep it current.</div>
        <Link href={`/builders/${me}`}><Button variant="secondary">View / edit builder profile</Button></Link>
        <Link href="/sell"><Button>List new work</Button></Link>
      </div>
      {needsAction.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-flare-ink">Needs your attention</h2>
          <div className="grid gap-4 md:grid-cols-2">{needsAction.map((l) => <ListingCard key={l.id} l={l} />)}</div>
        </section>
      )}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Selling ({selling.length})</h2>
        {selling.length ? <div className="grid gap-4 md:grid-cols-2">{selling.map((l) => <ListingCard key={l.id} l={l} />)}</div> : <p className="text-faint">No listings yet.</p>}
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">Buying ({buying.length})</h2>
        {buying.length ? <div className="grid gap-4 md:grid-cols-2">{buying.map((l) => <ListingCard key={l.id} l={l} />)}</div> : <p className="text-faint">No purchases yet.</p>}
      </section>
    </div>
  );
}
