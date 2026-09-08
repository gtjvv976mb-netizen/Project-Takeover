"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/client/api";
import type { Listing } from "@/lib/types";

const World = dynamic(() => import("@/components/world/World"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-0 flex items-center justify-center bg-ink">
      <div className="label animate-pulse">making way into the harbour…</div>
    </div>
  ),
});

export default function Home() {
  const [listings, setListings] = useState<Listing[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Everything that is moored or has sailed: active, funded, and taken over.
    api.listings({ status: "all" })
      .then((l) => { if (!cancelled) setListings(l); })
      .catch(() => { if (!cancelled) setListings([]); });
    return () => { cancelled = true; };
  }, []);

  if (!listings) {
    return (
      <div className="fixed inset-0 z-0 flex items-center justify-center bg-ink">
        <div className="label animate-pulse">making way into the harbour…</div>
      </div>
    );
  }
  return <World listings={listings} />;
}
